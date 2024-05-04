import chokidar from 'chokidar'
import * as env from 'lib0/environment'
import fs from 'node:fs'

import * as Ystream from '@y/stream'
import * as wscomm from '@y/stream/comms/ws'
import * as authentication from '@y/stream/api/authentication'
import * as dbtypes from '@y/stream/api/dbtypes'
import * as buffer from 'lib0/buffer'
import * as json from 'lib0/json'
import * as ecdsa from 'lib0/crypto/ecdsa'
import * as decoding from 'lib0/decoding'
import * as random from 'lib0/random'
import * as promise from 'lib0/promise'
import * as array from 'lib0/array'

const testUserRaw = {
  privateKey: '{"key_ops":["sign"],"ext":true,"kty":"EC","x":"pAUmLYc-UFmPIt7leafPTbhxQyygcaW7__nPcUNCuu0wH27yS9P_pWFP1GwcsoAN","y":"u3109KjrPGsNUn2k5Whn2uHLAckQPdLNqtM4GpBEpUJwlvVDvk71-lS3YOEYJ_Sq","crv":"P-384","d":"OHnRw5an9hlSqSKg966lFRvB7dow669pVSn7sFZUi7UQh_Y9Xc95SQ6pEWsofsYD"}',
  user: 'AMgBeyJrZXlfb3BzIjpbInZlcmlmeSJdLCJleHQiOnRydWUsImt0eSI6IkVDIiwieCI6InBBVW1MWWMtVUZtUEl0N2xlYWZQVGJoeFF5eWdjYVc3X19uUGNVTkN1dTB3SDI3eVM5UF9wV0ZQMUd3Y3NvQU4iLCJ5IjoidTMxMDlLanJQR3NOVW4yazVXaG4ydUhMQWNrUVBkTE5xdE00R3BCRXBVSndsdlZEdms3MS1sUzNZT0VZSl9TcSIsImNydiI6IlAtMzg0In0='
}

const testServerUser = 'AMgBeyJrZXlfb3BzIjpbInZlcmlmeSJdLCJleHQiOnRydWUsImt0eSI6IkVDIiwieCI6IkNZd01ha3BuMG9uYU5lQ2Etd3FMbjRGenNyaXNfVVk0WjVnUlFVQTl4UU9vaDk0WUc5T0hoSXRyNnJvdmFZcFoiLCJ5IjoiNzRVbGp1ODZJVU1KWnNZc1NqeFNqdXNMamo5VTZyb3pad2JLOVhhcWozTWdJV3Ruak55akwxRC1Oek9QM0ZKNyIsImNydiI6IlAtMzg0In0='

const testUser = {
  privateKey: await ecdsa.importKeyJwk(json.parse(testUserRaw.privateKey)),
  user: dbtypes.UserIdentity.decode(decoding.createDecoder(buffer.fromBase64(testUserRaw.user)))
}
const owner = buffer.toBase64(testUser.user.hash)

const collectionName = 'my-synced-fs'
const y = await Ystream.open('.ystream/db-session-' + Math.random(), {
  comms: [new wscomm.WebSocketComm('ws://localhost:9000', [{ owner, collection: collectionName }])]
})

await authentication.registerUser(y, dbtypes.UserIdentity.decode(decoding.createDecoder(buffer.fromBase64(testServerUser))), { isTrusted: true })
await authentication.setUserIdentity(y, testUser.user, await testUser.user.publicKey, testUser.privateKey)

const ycollection = y.getCollection(owner, collectionName)

const clonePath = env.getParam('--clone', '')
const initPath = env.getParam('--init', '')
const observePath = clonePath || initPath

console.log({ clonePath, initPath, observePath })

if (clonePath !== '') {
  fs.mkdirSync(clonePath)
}

/**
 * @param {string} docid
 * @return {Promise<string|Buffer|Object>}
 */
const getFileContent = async docid => {
  return ycollection.getLww(docid)
}

/**
 * @type {Array<string>}
 */
const filesToRender = []
const _renderFiles = async () => {
  while (filesToRender.length > 0) {
    await y.db.transact(async () => {
      // perform a max of 100 changes before creating a new transaction
      for (let i = 0; i < 100 && filesToRender.length > 0; i++) {
        const docid = filesToRender[0]
        const ycontent = await getFileContent(docid)
        const path = await ycollection.getDocPath(docid)
        path[0].docname = observePath
        const strPath = path.map(p => p.docname).join('/')
        if (Buffer.isBuffer(ycontent)) {
          const fileContent = fs.existsSync(strPath) ? fs.readFileSync(strPath) : null
          if (typeof ycontent === 'string') {
            throw new Error('@todo cant handle string content yet')
          } else {
            if (fileContent == null || !array.equalFlat(fileContent, ycontent)) {
              console.log('writing file', { path: observePath + '/' + strPath, ycontent, ypath: path })
              fs.writeFileSync(observePath + '/' + strPath, Buffer.from(ycontent))
              console.log('file written!', { strPath })
            }
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

y.on('ops', (ops, _origin) => {
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]
    filesToRender.push(op.doc)
  }
  if (filesToRender.length === ops.length) {
    _renderFiles()
  }
})

ycollection.whenSynced.then(() => { console.log('synced - ycollection handler') })

/**
 * @type {Array<{ type: string, path: string }>}}
 */
const _eventsToCompute = []
const _computeEvents = async () => {
  while (_eventsToCompute.length > 0) {
    await y.db.transact(async () => {
      for (let iterations = 0; _eventsToCompute.length > 0 && iterations < 30; iterations++) {
        const event = _eventsToCompute[0]
        if (event.path === observePath) {
          _eventsToCompute.shift()
          continue
        }
        const arrPath = event.path.split('/')
        const filePath = arrPath.slice(1, -1)
        const fileName = arrPath.slice(-1)[0]

        console.log(event.type, { path: event.path, filePath, fileName })
        switch (event.type) {
          case 'add': {
            const parentDocId = filePath.length === 0 ? 'root' : await ycollection.getDocIdsFromNamePath('root', filePath).then(ids => ids[0])
            const newChildId = random.uuidv4()
            ycollection.setLww(newChildId, fs.readFileSync(event.path))
            ycollection.setDocParent(newChildId, parentDocId, fileName)
            break
          }
          case 'change': {
            const docid = await ycollection.getDocIdsFromNamePath('root', arrPath).then(ids => ids[0])
            ycollection.setLww(docid, fs.readFileSync(event.path).toString())
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
            const newChildId = random.uuidv4()
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

chokidar.watch(observePath, { ignoreInitial: false })
  .on('all', (type, path) => {
    _eventsToCompute.push({ type, path })
    if (_eventsToCompute.length === 1) _computeEvents()
  })
