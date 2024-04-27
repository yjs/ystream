import * as t from 'lib0/testing'
import * as promise from 'lib0/promise'
import * as buffer from 'lib0/buffer'
import * as math from 'lib0/math'
import * as Ystream from '../src/index.js'
import * as helpers from './helpers.js'
import * as error from 'lib0/error'
import * as authentication from '../src/api/authentication.js'
// import * as actions from '../src/actions.js'
// import * as operations from '../src/operations.js'

/**
 * @param {string} testname
 */
const getDbName = testname => '.test_dbs/' + testname

const owner = buffer.toBase64(helpers.owner)

/**
 * Testing loading from the database.
 *
 * @param {t.TestCase} tc
 */
export const testYdocLoad = async tc => {
  const collectionName = tc.testName
  await Ystream.remove(getDbName(tc.testName))
  const ystream = await Ystream.open(getDbName(tc.testName))
  const collection = ystream.getCollection(owner, collectionName)
  const ydoc1 = collection.getYdoc('ydoc')
  await ydoc1.whenLoaded
  ydoc1.getMap().set('k', 'v')
  const ydoc2 = collection.getYdoc('ydoc')
  await ydoc2.whenLoaded
  t.assert(ydoc2.getMap().get('k') === 'v')
  ydoc1.getMap().set('k', 'v2')
  t.assert(ydoc1.getMap().get('k') === 'v2')
  console.log('before destroy')
  await ystream.destroy()
  console.log('after destroy')
  const ystream2 = await Ystream.open(getDbName(tc.testName))
  const collection2 = ystream2.getCollection(owner, collectionName)
  console.log('after open')
  const ydoc3 = collection2.getYdoc('ydoc')
  console.log('after getdoc')
  await ydoc3.whenLoaded
  console.log('after loaded')
  t.compare(ydoc3.getMap().get('k'), 'v2')
}

/**
 * @param {t.TestCase} tc
 */
export const testComm = async tc => {
  const th = await helpers.createTestScenario(tc)
  const [{ ystream: ystream1, collection: collection1 }, { ystream: ystream2, collection: collection2 }] = await th.createClients(2)
  console.log('@y/stream1 user hashes: ', await authentication.getAllRegisteredUserHashes(ystream1))
  console.log('@y/stream2 user hashes: ', await authentication.getAllRegisteredUserHashes(ystream2))
  await promise.all([collection1.whenSynced, collection2.whenSynced])
  const ydoc1 = collection1.getYdoc('ydoc')
  ydoc1.getMap().set('k', 'v1')
  const ydoc2 = collection2.getYdoc('ydoc')
  await ydoc2.whenLoaded
  await helpers.waitDocsSynced(ydoc1, ydoc2)
  t.compare(ydoc2.getMap().get('k'), 'v1')
  ydoc1.getMap().set('k', 'v2')
  t.compare(ydoc1.getMap().get('k'), 'v2')
  await helpers.waitDocsSynced(ydoc1, ydoc2)
  t.compare(ydoc2.getMap().get('k'), 'v2')
  const { collection: collection3 } = await th.createClient()
  await collection3.whenSynced
  const ydoc3 = collection3.getYdoc('ydoc')
  await ydoc3.whenLoaded
  t.compare(ydoc3.getMap().get('k'), 'v2')
}

/**
 * @param {t.TestCase} tc
 */
export const testPerformanceLoadingManyDocs = async tc => {
  const N = 10
  const collectionName = tc.testName
  await Ystream.remove(getDbName(tc.testName))
  const ystream = await Ystream.open(getDbName(tc.testName))
  const collection = ystream.getCollection(owner, collectionName)
  await t.measureTimeAsync(`Create ${N} documents with initial content`, async () => {
    for (let i = 0; i < N; i++) {
      const ydoc = collection.getYdoc('doc-' + i)
      ydoc.getMap().set('i', i)
    }
    const lastdoc = collection.getYdoc('doc-' + (N - 1))
    await lastdoc.whenLoaded
    t.assert(lastdoc.getMap().get('i') === N - 1)
  })
  const ystream2 = await Ystream.open(getDbName(tc.testName))
  const collection2 = ystream2.getCollection(owner, collectionName)
  await t.measureTimeAsync(`Loading ${N} documents with initial content`, async () => {
    const ps = []
    for (let i = 0; i < N; i++) {
      const ydoc = collection2.getYdoc('doc-' + i)
      ps.push(ydoc.whenLoaded.then(() => {
        if (ydoc.getMap().get('i') !== i) {
          return promise.reject(error.create(`content on doc ${i} not properly loaded`))
        }
      }))
    }
    await promise.all(ps)
  })
}

/**
 * @param {t.TestCase} tc
 */
export const testPerformanceSyncingManyDocs = async tc => {
  const N = 10000
  const th = await helpers.createTestScenario(tc)
  const { owner, collection } = th.collectionDef
  const server = th.server
  if (server === null) {
    return t.skip()
  }
  const [{ collection: collection1 }] = await th.createClients(1)
  await t.measureTimeAsync(`Sync ${N} documents with content to server`, async () => {
    for (let i = 0; i < N; i++) {
      const ydoc = collection1.getYdoc('doc-' + i)
      ydoc.getMap().set('i', i)
      if (i % 10000 === 0 && i !== 0) {
        console.log(`progress: ${math.round(100 * i / N)}%`)
        // can't wait here at the moment, or every single message will be sent individually
        // const ydocRemote = server.ystream.getYdoc(owner, collection, 'doc-' + i)
        // await ydocRemote.whenLoaded
        // await helpers.waitDocsSynced(ydoc, ydocRemote)
      }
      ydoc.destroy()
    }
    const lastClientDoc = collection1.getYdoc('doc-' + (N - 1))
    await lastClientDoc.whenLoaded
    const lastServerDoc = server.ystream.getCollection(owner, collection).getYdoc('doc-' + (N - 1))
    await lastServerDoc.whenLoaded
    await helpers.waitDocsSynced(lastClientDoc, lastServerDoc)
    t.assert(lastServerDoc.getMap().get('i') === N - 1)
  })
  const [{ collection: collection2 }] = await th.createClients(1)
  await t.measureTimeAsync(`Sync ${N} documents with content from server`, async () => {
    const lastClientDoc = collection2.getYdoc('doc-' + (N - 1))
    const lastServerDoc = server.ystream.getCollection(owner, collection).getYdoc('doc-' + (N - 1))
    await lastServerDoc.whenLoaded
    await helpers.waitDocsSynced(lastClientDoc, lastServerDoc)
    t.assert(lastClientDoc.getMap().get('i') === N - 1)
  })
}

/**
 * Testing loading from the database.
 *
 * @param {t.TestCase} tc
 */
export const testLww = async tc => {
  const th = await helpers.createTestScenario(tc)
  const [{ collection: collection1 }, { collection: collection2 }] = await th.createClients(2)
  await collection1.setLww('key', 'val1')
  t.assert(await collection1.getLww('key') === 'val1')
  await collection2.setLww('key', 'val2')
  t.assert(await collection2.getLww('key') === 'val2')
  while (true) {
    if (await collection1.getLww('key') === await collection2.getLww('key')) break
    await promise.wait(100)
  }
  t.info('lww value converged')
}

/**
 * Testing loading from the database.
 *
 * @param {t.TestCase} tc
 */
export const testFolderStructure = async tc => {
  const th = await helpers.createTestScenario(tc)
  const [{ collection: collection1 }] = await th.createClients(2)
  await collection1.setParent('B', 'A')
  await collection1.setParent('C', 'B')
  await collection1.setParent('D', 'B')
  t.assert(await collection1.getParent('B') === 'A')
  t.assert(await collection1.getParent('D') === 'B')
  t.assert(await collection1.getParent('C') === 'B')
  t.compareArrays(await collection1.getChildren('A'), ['B'])
  t.compareArrays(await collection1.getChildren('B'), ['C', 'D']) // should return in alphabetical order
  t.compareArrays(await collection1.getDocPath('A'), [])
  t.compareArrays(await collection1.getDocPath('B'), ['A'])
  t.compareArrays(await collection1.getDocPath('D'), ['A', 'B'])
}
