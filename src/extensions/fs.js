import chokidar from 'chokidar'
import fs from 'node:fs'
import path from 'node:path'

import * as random from 'lib0/random'
import * as array from 'lib0/array'
import * as observable from 'lib0/observable'
import * as error from 'lib0/error'
import * as Ystream from '@y/stream' // eslint-disable-line
import * as actions from '@y/stream/api/actions' // eslint-disable-line
import * as logging from 'lib0/logging'

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
     * @type {Set<string>}
     */
    this._filesToRenderDocNames = new Set()
    /**
     * @type {(ops: Array<any>, origin: any) => void}
     */
    this._opsObserver = (ops, _origin) => {
      const shouldStartRender = this._filesToRender.length === 0
      // console.log({ ops })
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i]
        if (!this._filesToRenderDocNames.has(op.doc)) {
          // console.log('doc added to files to render', { docid: op.doc, type: op.op.type, op: op.op, opC: op.op.val?.toString?.().slice(0, 50) })
          this._filesToRender.push({ clock: op.localClock, docid: op.doc })
          this._filesToRenderDocNames.add(op.doc)
        }
      }
      if (shouldStartRender) {
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
 * @param {import('@y/stream').YTransaction} tr
 * @param {Yfs} yfs
 * @param {string} docid
 * @return {Promise<{ type: 'binaryFile', content: Buffer }|{ type: 'dir' }|{ type: 'skip' }|null>}
 */
const getFileContent = async (tr, yfs, docid) => {
  const fi = await yfs.ycollection.getFileInfo(tr, docid)
  if (fi == null) {
    return null
  }
  if (fi.ftype === 'binary') {
    const content = await yfs.ycollection.getLww(tr, docid)
    if (content == null) {
      // skip for now, until content arrives
      return { type: 'skip' }
    }
    return { type: 'binaryFile', content }
  }
  if (fi.ftype === 'dir') {
    return { type: 'dir' }
  }
  error.unexpectedCase()
}

/**
 * @param {Yfs} yfs
 */
const _renderFiles = async (yfs) => {
  let shouldBreak = false
  let filesrendered = 0
  const filesToRender = yfs._filesToRender
  while (filesToRender.length > 0 && !shouldBreak) {
    await yfs.ystream.transact(async tr => {
      // perform a max of 100 changes before creating a new transaction
      for (let i = 0; i < 300 && filesToRender.length > 0; i++) {
        const { docid, clock: opClock } = filesToRender[0]
        const ycontent = await getFileContent(tr, yfs, docid)
        const docPath = await actions.getDocPath(tr, yfs.ystream, yfs.ycollection.ownerBin, yfs.ycollection.collection, docid, ycontent == null ? opClock - 1 : undefined)
        // console.log('getting file content', { docid, ycontent, docPath })
        const docnamee = docPath?.[docPath.length - 1].docname
        // const docdeleted = await actions.isDocDeleted(tr, yfs.ystream, yfs.ycollection.ownerBin, yfs.ycollection.collection, docid)
        // console.log({ docnamee, docdeleted, docid, ycontent: /** @type {any} */ (ycontent)?.content?.toString?.().slice(0, 50) || ycontent, docPath, opClock })
        const strPath = path.join(yfs.observedPath, docPath?.map(p => p.docname).join('/') || '')
        if (docnamee == null || docPath == null) {
          docnamee == null && console.warn('docname should not be empty') // @todo
          docPath == null && console.warn('docPath should not be empty') // @todo
          // @todo this edge case is ignored for now
          // error.unexpectedCase()
        } else if (ycontent == null) {
          // console.log('removing file/dir ', { strPath })
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
            // console.log('error in fs.stat', e)
          }
        } else if (ycontent.type === 'skip') {
          // skip for now, will be rendered when all content arrives
          // nop
        } else if (ycontent.type === 'binaryFile') {
          // console.log('trying to read file', { strPath, docPath, docid })
          const fileContent = fs.existsSync(strPath) ? fs.readFileSync(strPath) : null
          if (fileContent == null || !array.equalFlat(fileContent, ycontent.content)) {
            // console.log('writing file', { docPath, strPath, ycontent: /** @type {any} */ (ycontent).content?.toString?.().slice(0, 50) || ycontent, fileContent: fileContent?.toString?.().slice(0, 50), ypath: docPath })
            fs.writeFileSync(strPath, ycontent.content)
            // console.log('file written!', { strPath })
          }
        } else {
          // console.log('checking if folder exists', { strPath })
          if (!fs.existsSync(strPath)) {
            // console.log(strPath, ' does notexist , lets creat it..')
            fs.mkdirSync(strPath)
            // console.log('folder exists now', {
            //   strPath, exists: fs.existsSync(strPath)
            // })
          }
        }
        yfs._filesToRenderDocNames.delete(docid)
        filesToRender.shift()
        filesrendered++
        if (filesToRender.length === 0) {
          shouldBreak = true
        }
      }
    })
    logging.print(logging.ORANGE, `${filesrendered}/${filesToRender.length + filesrendered} files rendered (clientid=${yfs.ystream.clientid})`)
  }
}

/**
 * Creates a document and creates parent documents as necessary. Works similarly to `mkdir -p`.
 *
 * @param {import('@y/stream').YTransaction} tr
 * @param {Ystream.Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string|null} rootid
 * @param {Array<string>} path
 * @param {'dir'|'binary'|'text'} finalFtype
 * @return {Promise<{ docid: string, isNew: boolean }>}
 */
export const mkPath = async (tr, ystream, owner, collection, rootid, path, finalFtype) => {
  let isNew = false
  if (path.length === 0) error.unexpectedCase()
  const ftype = path.length === 1 ? finalFtype : 'dir'
  let children = await tr.tables.childDocs.getValues({ prefix: { owner, collection, parent: rootid, docname: path[0] } }).then(cs => cs.map(c => c.v))
  if (children.length === 0) {
    const newChildId = random.uuidv4() + path.join('/')
    isNew = true
    await actions.setFileInfo(tr, ystream, owner, collection, newChildId, path[0], rootid, ftype)
    children = [newChildId]
  } else if (path.length === 1) {
    const fi = await actions.getFileInfo(tr, ystream, owner, collection, children[0])
    if (fi?.ftype !== finalFtype) {
      await actions.setFileInfo(tr, ystream, owner, collection, children[0], path[0], rootid, ftype)
    }
  }
  if (path.length === 1) {
    return { docid: children[0], isNew }
  }
  return mkPath(tr, ystream, owner, collection, children[0], path.slice(1), finalFtype)
}

/**
 * @type {Array<{ type: string, path: string, content: string|Buffer|null }>}}
 */
const _eventsToCompute = []
/**
 * @param {Yfs} yfs
 */
const _computeEvents = async yfs => {
  const ycollection = yfs.ycollection
  // console.log('all events to compute', _eventsToCompute)
  while (_eventsToCompute.length > 0) {
    await yfs.ystream.transact(async tr => {
      for (let iterations = 0; _eventsToCompute.length > 0 && iterations < 300; iterations++) {
        const event = _eventsToCompute[0]
        const arrPath = event.path.split(path.sep)
        // const filePath = arrPath.slice(0, -1)
        // const fileName = arrPath[arrPath.length - 1]
        // console.log(event.type, { path: event.path, filePath, fileName, content: event.content?.toString?.().slice(0, 50) || event.content })
        switch (event.type) {
          case 'add':
          case 'change': {
            // console.log('ids for path', {
            //   filePath,
            //   ids: await ycollection.getDocIdsFromPath(tr, null, filePath)
            // })
            const { docid, isNew } = await mkPath(tr, ycollection.ystream, ycollection.ownerBin, ycollection.collection, null, arrPath, 'binary')
            if (isNew) {
              // console.log('created file', { filePath, eventContent: event.content?.toString().slice(0, 50) })
              await ycollection.setLww(tr, docid, event.content)
            } else {
              const currContent = await ycollection.getLww(tr, docid)
              // console.log('updating file', { filePath, currContent: Buffer.from(currContent).toString().slice(0, 50), eventContent: event.content?.toString().slice(0, 50) })
              if (Buffer.isBuffer(event.content) && currContent instanceof Uint8Array && array.equalFlat(currContent, event.content)) {
                // console.log('nop...')
                // nop
              } else {
                await ycollection.setLww(tr, docid, event.content)
              }
            }
            break
          }
          case 'unlink':
          case 'unlinkDir': {
            const docid = await ycollection.getDocIdsFromPath(tr, null, arrPath).then(ids => ids[0])
            if (docid) {
              await ycollection.deleteDoc(tr, docid)
            }
            break
          }
          case 'addDir': {
            await mkPath(tr, ycollection.ystream, ycollection.ownerBin, ycollection.collection, null, arrPath, 'dir')
            break
          }
        }
        _eventsToCompute.shift()
      }
    })
  }
}
