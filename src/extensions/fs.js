import chokidar from 'chokidar'
import fs from 'node:fs'
import path from 'node:path'

import * as random from 'lib0/random'
import * as promise from 'lib0/promise'
import * as array from 'lib0/array'
import * as observable from 'lib0/observable'
import * as error from 'lib0/error'
import * as Ystream from '@y/stream' // eslint-disable-line
import * as actions from '@y/stream/api/actions' // eslint-disable-line

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
        console.log('doc added to files to render', { docid: op.doc, type: op.op.type, op: op.op, opC: op.op.val?.toString?.().slice(0, 50) })
        this._filesToRender.push({ clock: op.localClock, docid: op.doc })
      }
      if (this._filesToRender.length === ops.length) {
        _renderFiles(this)
      }
    }
    // @todo start consuming starting at last checkpoint
    this.ystream.on('ops', this._opsObserver)

    this.chokidarWatch = chokidar.watch(observePath, { ignoreInitial: false, ignored: /\.ystream/ /*, awaitWriteFinish: true */ })
      .on('all', (type, cwdPath) => {
        const observeRelPath = path.relative(observePath, cwdPath)
        if (observeRelPath === '' || observeRelPath === '.' || observeRelPath.startsWith('..')) return
        let content = null
        if (type === 'add' || type === 'change') {
          content = fs.readFileSync(path.join(observePath, observeRelPath))
        }
        _eventsToCompute.push({ type, path: observeRelPath, content })
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
    await yfs.ystream.transact(async () => {
      // perform a max of 100 changes before creating a new transaction
      for (let i = 0; i < 100 && filesToRender.length > 0; i++) {
        const { docid, clock: opClock } = filesToRender[0]
        const ycontent = await getFileContent(yfs, docid)
        const docPath = await yfs.ycollection.getDocPath(docid, ycontent == null ? opClock - 1 : opClock)
        const docnamee = docPath[docPath.length - 1].docname
        const docdeleted = await yfs.ycollection.isDocDeleted(docid)
        console.log({ docnamee, docdeleted, docid, ycontent: /** @type {any} */ (ycontent)?.content?.toString?.().slice(0, 50) || ycontent, docPath, opClock })
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
          try {
            const stat = fs.statSync(strPath)
            if (stat.isDirectory()) {
              fs.rmdirSync(strPath)
            } else if (stat.isFile()) {
              fs.rmSync(strPath)
            } else {
              console.log('File doesnt exist anymore')
            }
          } catch (e) {
            console.log('error in fs.stat', e)
          }
        } else if (ycontent.type === 'binaryFile') {
          console.log('trying to read file', { strPath, docPath })
          const fileContent = fs.existsSync(strPath) ? fs.readFileSync(strPath) : null
          if (fileContent == null || !array.equalFlat(fileContent, ycontent.content)) {
            console.log('writing file', { docPath, strPath, ycontent: /** @type {any} */ (ycontent).content?.toString?.().slice(0, 50) || ycontent, fileContent: fileContent?.toString?.().slice(0, 50), ypath: docPath })
            fs.writeFileSync(strPath, ycontent.content)
            console.log('file written!', { strPath })
          }
        } else {
          console.log('checking if folder exists', { strPath })
          if (!fs.existsSync(strPath)) {
            console.log(strPath, ' does notexist , lets creat it..')
            fs.mkdirSync(strPath)
            console.log('folder exists now', {
              strPath, exists: fs.existsSync(strPath)
            })
          }
        }
        filesToRender.shift()
      }
    })
    await promise.wait(0)
  }
}

/**
 * Creates a document and creates parent documents as necessary. Works similarly to `mkdir -p`.
 *
 * @param {Ystream.Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} rootid
 * @param {Array<string>} path
 * @return {Promise<{ docid: string, isNew: boolean }>}
 */
export const mkPath = (ystream, owner, collection, rootid, path) => ystream.childTransaction(async tr => {
  let isNew = false
  if (path.length === 0) return { docid: rootid, isNew }
  let children = await tr.tables.childDocs.getValues({ prefix: { owner, collection, parent: rootid, docname: path[0] } }).then(cs => cs.map(c => c.v))
  if (children.length === 0) {
    const newChildId = random.uuidv4() + path.join('/')
    isNew = true
    actions.setDocParent(ystream, owner, collection, newChildId, rootid, path[0])
    if (path.length > 1) {
      // created doc is a directory
      actions.setLww(ystream, owner, collection, newChildId, {})
    }
    children = [newChildId]
  }
  if (path.length === 1) {
    return { docid: children[0], isNew }
  }
  return mkPath(ystream, owner, collection, children[0], path.slice(1))
})

/**
 * @type {Array<{ type: string, path: string, content: string|Buffer|null }>}}
 */
const _eventsToCompute = []
/**
 * @param {Yfs} yfs
 */
const _computeEvents = async yfs => {
  const ycollection = yfs.ycollection
  console.log('all events to compute', _eventsToCompute)
  while (_eventsToCompute.length > 0) {
    await yfs.ystream.transact(async () => {
      for (let iterations = 0; _eventsToCompute.length > 0 && iterations < 300; iterations++) {
        const event = _eventsToCompute[0]
        const arrPath = event.path.split(path.sep)
        const filePath = arrPath.slice(0, -1)
        const fileName = arrPath[arrPath.length - 1]
        console.log(event.type, { path: event.path, filePath, fileName, content: event.content?.toString?.().slice(0, 50) || event.content })
        switch (event.type) {
          case 'add':
          case 'change': {
            console.log('ids for path', {
              filePath,
              ids: await ycollection.getDocIdsFromPath('root', filePath)
            })
            const { docid, isNew } = await mkPath(ycollection.ystream, ycollection.ownerBin, ycollection.collection, 'root', arrPath)
            if (isNew) {
              console.log('created file', { filePath, eventContent: event.content?.toString().slice(0, 50) })
              await ycollection.setLww(docid, event.content)
            } else {
              const currContent = await ycollection.getLww(docid)
              console.log('updating file', { filePath, currContent: Buffer.from(currContent).toString().slice(0, 50), eventContent: event.content?.toString().slice(0, 50) })
              if (Buffer.isBuffer(event.content) && currContent instanceof Uint8Array && array.equalFlat(currContent, event.content)) {
                console.log('nop...')
                // nop
              } else {
                await ycollection.setLww(docid, event.content)
              }
            }
            break
          }
          case 'unlink':
          case 'unlinkDir': {
            const docid = await ycollection.getDocIdsFromPath('root', arrPath).then(ids => ids[0])
            if (docid) {
              await ycollection.deleteDoc(docid)
            }
            break
          }
          case 'addDir': {
            const { docid, isNew } = await mkPath(ycollection.ystream, ycollection.ownerBin, ycollection.collection, 'root', arrPath)
            if (isNew) {
              await ycollection.setLww(docid, {}) // regarding await: make sure that this document exists before continuing
            } else {
              const currContent = await ycollection.getLww(docid)
              if (currContent.constructor === Object) { // exists and is already a directory
                // nop
              } else {
                await ycollection.setLww(docid, {})
              }
            }
            break
          }
        }
        _eventsToCompute.shift()
      }
    })
  }
}
