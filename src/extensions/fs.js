import chokidar from 'chokidar'
import fs from 'node:fs'
import path from 'node:path'
import * as Y from 'yjs'

import * as random from 'lib0/random'
import * as array from 'lib0/array'
import * as observable from 'lib0/observable'
import * as error from 'lib0/error'
import * as Ystream from '@y/stream' // eslint-disable-line
import * as actions from '@y/stream/api/actions' // eslint-disable-line
import * as logging from 'lib0/logging'
import * as diff from 'lib0/diff'

const textFileExtensions = new Set([
  'txt', 'md', 'js', 'ts', 'tsx', 'jsx', 'css', 'norg'
])

const _fileExtensionRegex = /.+\.(\w+)$/
/**
 * @param {string} fname
 */
const getFileExtension = fname => _fileExtensionRegex.exec(fname)?.[1] ?? null

/**
 * @param {string} fname
 */
const isTextFile = (fname) => {
  const ext = getFileExtension(fname)
  return ext != null ? textFileExtensions.has(ext) : false
}

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
    this._destroyObserver = this.destroy.bind(this)
    this.ystream.on('destroy', this._destroyObserver)

    this.chokidarWatch = chokidar.watch(observePath, { ignoreInitial: false, ignored: /(\.ystream|node_modules|\.git)/ /*, awaitWriteFinish: true */ })
      .on('all', (type, cwdPath) => {
        const observeRelPath = path.relative(observePath, cwdPath)
        if (observeRelPath === '' || observeRelPath === '.' || observeRelPath.startsWith('..')) return
        let content = null
        if (type === 'add' || type === 'change') {
          content = fs.readFileSync(path.join(observePath, observeRelPath))
          try {
            if (isTextFile(observeRelPath)) {
              content = content.toString('utf8')
            }
          } catch (e) {
            console.warn('error parsing text file', e)
          }
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
 * @return {Promise<{ type: 'binaryFile', content: Buffer }|{ type: 'dir' }|{ type: 'skip' }|{ type: 'text', content: Y.Text }|null>}
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
  if (fi.ftype === 'text') {
    const ydoc = new Y.Doc()
    const yupdates = await yfs.ycollection.getYdocUpdates(tr, docid)
    if (yupdates == null) return null
    ydoc.transact(tr => {
      yupdates.forEach(update => {
        Y.applyUpdateV2(ydoc, update)
      })
    })
    return { type: 'text', content: ydoc.getText() }
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
        } else if (ycontent.type === 'text') {
          const ycontentStr = ycontent.content.toString()
          // console.log('trying to read file', { strPath, docPath, docid })
          const fileContent = fs.existsSync(strPath) ? fs.readFileSync(strPath) : null
          let fileContentStr = null
          if (fileContent != null) {
            try {
              fileContentStr = fileContent.toString('utf8')
            } catch (e) { /* nop */ }
          }
          if (fileContentStr !== ycontentStr) {
            fs.writeFileSync(strPath, ycontentStr)
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
      for (let iterations = 0; _eventsToCompute.length > 0 && iterations < 600; iterations++) {
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
            //
            const isTextContent = typeof event.content === 'string'
            const { docid, isNew } = await mkPath(tr, ycollection.ystream, ycollection.ownerBin, ycollection.collection, null, arrPath, isTextContent ? 'text' : 'binary')
            if (isNew) {
              if (isTextContent) {
                const ydoc = new Y.Doc()
                ydoc.getText().insert(0, /** @type {string} */ (event.content))
                await actions.addYDocUpdate(tr, ycollection.ystream, ycollection.ownerBin, ycollection.collection, docid, Y.encodeStateAsUpdateV2(ydoc))
              } else {
                await ycollection.setLww(tr, docid, event.content)
              }
            } else {
              if (isTextContent) {
                const currDocUpdates = await ycollection.getYdocUpdates(tr, docid)
                const currDoc = new Y.Doc()
                if (currDocUpdates != null) {
                  currDoc.transact(() => {
                    currDocUpdates.forEach(update => {
                      Y.applyUpdateV2(currDoc, update)
                    })
                  })
                }
                const textContent = /** @type {string} */ (event.content)
                const d = diff.simpleDiffString(currDoc.getText().toString(), textContent)
                // apply diff and catch the updates
                /**
                 * @type {Array<Uint8Array>}
                 */
                const updates = []
                currDoc.on('updateV2', update => updates.push(update))
                /**
                 * @type {Array<any>}
                 */
                const qdelta = [{ retain: d.index }]
                if (d.remove > 0) {
                  qdelta.push({ delete: d.remove })
                }
                if (d.insert.length > 0) {
                  qdelta.push({ insert: d.insert })
                }
                if (qdelta.length > 1) {
                  currDoc.getText().applyDelta(qdelta)
                }
                for (let i = 0; i < updates.length; i++) {
                  actions.addYDocUpdate(tr, ycollection.ystream, ycollection.ownerBin, ycollection.collection, docid, updates[i])
                }
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
