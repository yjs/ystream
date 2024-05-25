import * as t from 'lib0/testing'
import * as promise from 'lib0/promise'
import * as buffer from 'lib0/buffer'
import * as math from 'lib0/math'
import * as Ystream from '../src/index.js'
import * as helpers from './helpers.js'
import * as error from 'lib0/error'
import * as authentication from '../src/api/authentication.js'
import * as actions from '@y/stream/api/actions'
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
  const { owner, name: collectionName } = th.collectionDef
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
    const lastServerDoc = server.ystream.getCollection(owner, collectionName).getYdoc('doc-' + (N - 1))
    await lastServerDoc.whenLoaded
    await helpers.waitDocsSynced(lastClientDoc, lastServerDoc)
    t.assert(lastServerDoc.getMap().get('i') === N - 1)
  })
  const [{ collection: collection2 }] = await th.createClients(1)
  await t.measureTimeAsync(`Sync ${N} documents with content from server`, async () => {
    const lastClientDoc = collection2.getYdoc('doc-' + (N - 1))
    const lastServerDoc = server.ystream.getCollection(owner, collectionName).getYdoc('doc-' + (N - 1))
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
  const [{ collection: collection1, ystream: ystream1 }, { collection: collection2, ystream: ystream2 }] = await th.createClients(2)
  await ystream1.transact(tr => collection1.setLww(tr, 'key', 'val1'))
  t.assert(await ystream1.transact(tr => collection1.getLww(tr, 'key')) === 'val1')
  await ystream2.transact(tr => collection2.setLww(tr, 'key', 'val2'))
  t.assert(await ystream2.transact(tr => collection2.getLww(tr, 'key')) === 'val2')
  while (true) {
    const lw1 = await ystream1.transact(tr => collection1.getLww(tr, 'key'))
    const lw2 = await ystream2.transact(tr => collection2.getLww(tr, 'key'))
    const sv1 = await collection1.ystream.transact(tr => actions.getStateVector(tr, collection1.ystream, collection1.ownerBin, collection1.collection))
    const sv2 = await collection2.ystream.transact(tr => actions.getStateVector(tr, collection2.ystream, collection2.ownerBin, collection2.collection))
    console.log({ lw1, lw2, sv1, sv2 })
    if (lw1 === lw2) break
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
  const [{ collection: collection1, ystream: ystream1 }] = await th.createClients(1)
  await ystream1.transact(async tr => {
    await collection1.setDocParent(tr, 'A', null, 'a')
    await collection1.setDocParent(tr, 'B', 'A', 'b')
    await collection1.setDocParent(tr, 'C', 'B', 'c')
    await collection1.setDocParent(tr, 'D', 'B', 'd')
    t.assert(await collection1.getParent(tr, 'A') === null)
    const a = await collection1.getParent(tr, 'B')
    console.log(a)
    t.assert(await collection1.getParent(tr, 'B') === 'A')
    t.assert(await collection1.getParent(tr, 'D') === 'B')
    t.assert(await collection1.getParent(tr, 'C') === 'B')
    console.log('docname A:', await collection1.getDocName(tr, 'A'))
    t.assert(await collection1.getDocName(tr, 'A') === 'a')
    t.assert(await collection1.getDocName(tr, 'B') === 'b')
    t.assert(await collection1.getDocName(tr, 'D') === 'd')
    t.assert(await collection1.getDocName(tr, 'C') === 'c')
    t.compare(await collection1.getDocChildren(tr, 'A'), [{ docid: 'B', docname: 'b' }])
    t.compare(await collection1.getDocChildren(tr, 'B'), [{ docid: 'C', docname: 'c' }, { docid: 'D', docname: 'd' }]) // should return in alphabetical order
    t.compare(await collection1.getDocPath(tr, 'A'), [{ docid: 'A', docname: 'a' }])
    t.compare(await collection1.getDocPath(tr, 'B'), [{ docid: 'A', docname: 'a' }, { docid: 'B', docname: 'b' }])
    t.compare(await collection1.getDocPath(tr, 'D'), [{ docid: 'A', docname: 'a' }, { docid: 'B', docname: 'b' }, { docid: 'D', docname: 'd' }])
    t.compare(await collection1.getDocChildrenRecursive(tr, 'A'), [
      {
        docid: 'B',
        docname: 'b',
        children: [
          { docid: 'C', docname: 'c', children: [] },
          { docid: 'D', docname: 'd', children: [] }
        ]
      }
    ])
    t.compare(await collection1.getDocIdsFromPath(tr, 'A', ['b']), ['B'])
    t.compare(await collection1.getDocIdsFromPath(tr, 'A', ['b', 'c']), ['C'])
    t.compare(await collection1.getDocIdsFromPath(tr, 'A', ['c']), [])
    await collection1.setDocParent(tr, 'B', null, 'b')
    t.compare(await collection1.getDocChildrenRecursive(tr, 'A'), [])
    t.compare(await collection1.getDocChildrenRecursive(tr, 'B'), [
      { docid: 'C', docname: 'c', children: [] },
      { docid: 'D', docname: 'd', children: [] }
    ])
    await collection1.setDocParent(tr, 'A', 'B', 'a')
    t.compare(await collection1.getDocChildrenRecursive(tr, 'B'), [
      { docid: 'A', docname: 'a', children: [] },
      { docid: 'C', docname: 'c', children: [] },
      { docid: 'D', docname: 'd', children: [] }
    ])
    // @todo handle concurrent moves: parentless docs (deleted parent) should be moved to an
    // orphanage. Circles should be detected - the most recent "parent" should be moved to the
    // orhpanage.
    // The orhpanage should just be a local container of references. docs don't need to be reparented.
    // Circles are actually fine as long as the app can work with them.
  })
}

/**
 * Testing loading from the database.
 *
 * @param {t.TestCase} tc
 */
export const testDeleteDoc = async tc => {
  const docid = 'test'
  const th = await helpers.createTestScenario(tc)
  const [{ collection: collection1, ystream: ystream1 }] = await th.createClients(1)
  const ydoc = collection1.getYdoc(docid)
  await ydoc.whenLoaded
  ydoc.getText().insert(0, 'hi')
  const ydocCheck = collection1.getYdoc(docid)
  await ydocCheck.whenLoaded
  t.compareStrings(ydocCheck.getText().toString(), 'hi')
  console.log('docval prev', ydocCheck.getText().toString())
  ydocCheck.destroy()
  await ystream1.transact(async tr => {
    await collection1.setLww(tr, docid, 'val')
    await collection1.setDocParent(tr, docid, 'parentid', 'mydoc.md')
    t.assert(await collection1.getLww(tr, docid) === 'val')
    t.assert(await collection1.getParent(tr, docid) === 'parentid')
    t.assert(await collection1.getDocName(tr, docid) === 'mydoc.md')
    await collection1.deleteDoc(tr, docid)
  })
  const ydocCheck2 = collection1.getYdoc(docid)
  console.log('docval prev', ydocCheck2.getText().toString())
  t.compareStrings(ydocCheck2.getText().toString(), '')
  await ystream1.transact(async tr => {
    t.assert(await collection1.getLww(tr, docid) === undefined)
    t.assert(await collection1.getParent(tr, docid) === null)
    t.assert(await collection1.getDocName(tr, docid) === null)
    await collection1.setLww(tr, docid, 'val')
    t.assert(await collection1.getLww(tr, docid) === undefined)
    // @todo test if deletion works in combination with parents (integration of delete should
    // orphan child docs)
  })
}
