import chokidar from 'chokidar'
import fs from 'node:fs'
import path from 'node:path'

import * as random from 'lib0/random'
import * as promise from 'lib0/promise'
import * as array from 'lib0/array'
import * as observable from 'lib0/observable'
import * as error from 'lib0/error'

/**
 * @extends {observable.ObservableV2<{}>}
 */
export default class Yfs extends observable.ObservableV2 {
  /**
   * @param {import('@y/stream').Collection} ycollection
   * @param {Object} opts
   * @param {string} opts.observePath
   */
  constructor (ycollection, { observePath = '.' }) {
    super()
    this.ycollection = ycollection
    this.ystream = ycollection.ystream
    this.observedPath = observePath
    /**
     * @type {Array<{ clock: number, docid: string }>}
     */
    this._filesToRender = []
    /**
     * @type {(ops: Array<any>, origin: any) => void}
     */
    this._opsObserver = (ops, _origin) => {
      console.log({ ops })
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i]
        console.log('doc added to files to render', { docid: op.doc, type: op.op.type, op: op.op })
        this._filesToRender.push({ clock: op.localClock, docid: op.doc })
      }
      if (this._filesToRender.length === ops.length) {
        _renderFiles(this)
      }
    }
    // @todo start consuming starting at last checkpoint
    this.ystream.on('ops', this._opsObserver)

    this.chokidarWatch = chokidar.watch(observePath, { ignoreInitial: false, ignored: /\.ystream/ })
      .on('all', (type, cwdPath) => {
        const observeRelPath = path.relative(observePath, cwdPath)
        if (observeRelPath === '' || observeRelPath === '.' || observeRelPath.startsWith('..')) return
        _eventsToCompute.push({ type, path: observeRelPath })
        if (_eventsToCompute.length === 1) _computeEvents(this)
      })
  }

  async destroy () {
    super.destroy()
    this.ystream.off('ops', this._opsObserver)
    await this.chokidarWatch.close()
  }
}

/**
 * @param {Yfs} yfs
 * @param {string} docid
 * @return {Promise<{ type: 'binaryFile', content: Buffer }|{ type: 'dir' }|null>}
 */
const getFileContent = async (yfs, docid) => {
  const lc = await yfs.ycollection.getLww(docid)
  if (lc == null) {
    return null
  }
  if (lc instanceof Uint8Array || typeof lc === 'string') {
    return { type: 'binaryFile', content: Buffer.from(lc) }
  }
  if (lc.constructor === Object) {
    return { type: 'dir' }
  }
  console.log({ lc })
  error.unexpectedCase()
}

/**
 * @param {Yfs} yfs
 */
const _renderFiles = async (yfs) => {
  const filesToRender = yfs._filesToRender
  while (yfs._filesToRender.length > 0) {
    await yfs.ystream.childTransaction(async () => {
      // perform a max of 100 changes before creating a new transaction
      for (let i = 0; i < 100 && filesToRender.length > 0; i++) {
        const { docid, clock: opClock } = filesToRender[0]
        const ycontent = await getFileContent(yfs, docid)
        const docPath = await yfs.ycollection.getDocPath(docid, ycontent == null ? opClock - 1 : opClock)
        const docnamee = docPath[docPath.length - 1].docname
        const docdeleted = await yfs.ycollection.isDocDeleted(docid)
        console.log({ docnamee, docdeleted, docid, ycontent, docPath, opClock })
        docPath.shift()
        const strPath = path.join(yfs.observedPath, docPath.map(p => p.docname).join('/'))
        if (docnamee == null) {
          console.log('docname should not be empty') // @todo
          filesToRender.shift()
          return
          // error.unexpectedCase()
        } else if (ycontent == null) {
          console.log('removing file/dir ', { strPath })
          if (strPath === 'tmp/init' || docnamee == null || docPath.length === 0) {
            const docPath2 = await yfs.ycollection.getDocPath(docid, ycontent == null ? opClock - 1 : opClock)
            console.log({ docPath2 })
          }
          const stat = fs.statSync(strPath)
          if (stat.isDirectory()) {
            fs.rmdirSync(strPath)
          } else if (stat.isFile()) {
            fs.rmSync(strPath)
          } else {
            console.log('File doesnt exist anymore')
          }
        } else if (ycontent.type === 'binaryFile') {
          console.log('trying to read file', { strPath, docPath })
          const fileContent = fs.existsSync(strPath) ? fs.readFileSync(strPath) : null
          if (fileContent == null || !array.equalFlat(fileContent, ycontent.content)) {
            console.log('writing file', { docPath, strPath, ycontent, ypath: docPath })
            fs.writeFileSync(strPath, ycontent.content)
            console.log('file written!', { strPath })
          }
        } else {
          if (!fs.existsSync(strPath)) {
            fs.mkdirSync(strPath)
          }
        }
        filesToRender.shift()
      }
    })
    await promise.wait(0)
  }
}

/**
 * @type {Array<{ type: string, path: string }>}}
 */
const _eventsToCompute = []
/**
 * @param {Yfs} yfs
 */
const _computeEvents = async yfs => {
  const ycollection = yfs.ycollection
  while (_eventsToCompute.length > 0) {
    await yfs.ystream.childTransaction(async () => {
      for (let iterations = 0; _eventsToCompute.length > 0 && iterations < 30; iterations++) {
        const event = _eventsToCompute[0]
        const arrPath = event.path.split('/')
        const filePath = arrPath.slice(0, -1)
        const fileName = arrPath[arrPath.length - 1]

        console.log(event.type, { path: event.path, filePath, fileName })
        switch (event.type) {
          case 'add': {
            const parentDocId = filePath.length === 0 ? 'root' : await ycollection.getDocIdsFromNamePath('root', filePath).then(ids => ids[0])
            const newChildId = random.uuidv4() + '-file-' + event.path
            ycollection.setDocParent(newChildId, parentDocId, fileName)
            ycollection.setLww(newChildId, fs.readFileSync(path.join(yfs.observedPath, event.path)))
            break
          }
          case 'change': {
            const docid = await ycollection.getDocIdsFromNamePath('root', arrPath).then(ids => ids[0])
            ycollection.setLww(docid, fs.readFileSync(path.join(yfs.observedPath, event.path)))
            break
          }
          case 'unlink': {
            const docid = await ycollection.getDocIdsFromNamePath('root', arrPath).then(ids => ids[0])
            ycollection.deleteDoc(docid)
            break
          }
          case 'unlinkDir': {
            const docid = await ycollection.getDocIdsFromNamePath('root', arrPath).then(ids => ids[0])
            ycollection.deleteDoc(docid)
            break
          }
          case 'addDir': {
            const parentDocId = filePath.length === 0 ? 'root' : await ycollection.getDocIdsFromNamePath('root', filePath).then(ids => ids[0])
            const newChildId = random.uuidv4() + '-dir-' + event.path
            console.log({ parentDocId })
            ycollection.setDocParent(newChildId, parentDocId, fileName)
            ycollection.setLww(newChildId, {})
            break
          }
        }
        _eventsToCompute.shift()
      }
    })
  }
}
