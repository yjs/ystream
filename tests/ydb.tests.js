import * as t from 'lib0/testing'
import * as promise from 'lib0/promise'
import * as buffer from 'lib0/buffer'

import * as Ydb from '../src/index.js'
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
const collection = 'c1'
const collectionDef = { owner, collection }

/**
 * Testing loading from the database.
 *
 * @param {t.TestCase} tc
 */
export const testYdocLoad = async tc => {
  await Ydb.deleteYdb(getDbName(tc.testName))
  const ydb = await Ydb.openYdb(getDbName(tc.testName), [collectionDef])
  const ydoc1 = ydb.getYdoc(owner, collection, 'ydoc')
  await ydoc1.whenLoaded
  ydoc1.getMap().set('k', 'v')
  const ydoc2 = ydb.getYdoc(owner, collection, 'ydoc')
  await ydoc2.whenLoaded
  t.assert(ydoc2.getMap().get('k') === 'v')
  ydoc1.getMap().set('k', 'v2')
  t.assert(ydoc1.getMap().get('k') === 'v2')
  console.log('before destroy')
  await ydb.destroy()
  console.log('after destroy')
  const ydb2 = await Ydb.openYdb(getDbName(tc.testName), [collectionDef])
  console.log('after open')
  const ydoc3 = ydb2.getYdoc(owner, collection, 'ydoc')
  console.log('after getdoc')
  await ydoc3.whenLoaded
  console.log('after loaded')
  t.compare(ydoc3.getMap().get('k'), 'v2')
}

/**
 * @param {t.TestCase} tc
 */
export const testComm = async tc => {
  const th = helpers.createTestScenario(tc)
  const [{ ydb: ydb1 }, { ydb: ydb2 }] = await th.createClients(2)
  console.log('@y/stream1 user hashes: ', await authentication.getAllRegisteredUserHashes(ydb1))
  console.log('@y/stream2 user hashes: ', await authentication.getAllRegisteredUserHashes(ydb2))
  await promise.all([ydb1.whenSynced, ydb2.whenSynced])
  const ydoc1 = ydb1.getYdoc(owner, 'c1', 'ydoc')
  ydoc1.getMap().set('k', 'v1')
  const ydoc2 = ydb2.getYdoc(owner, 'c1', 'ydoc')
  await ydoc2.whenLoaded
  await helpers.waitDocsSynced(ydoc1, ydoc2)
  t.compare(ydoc2.getMap().get('k'), 'v1')
  ydoc1.getMap().set('k', 'v2')
  t.compare(ydoc1.getMap().get('k'), 'v2')
  await helpers.waitDocsSynced(ydoc1, ydoc2)
  t.compare(ydoc2.getMap().get('k'), 'v2')
  const { ydb: ydb3 } = await th.createClient()
  await ydb3.whenSynced
  const ydoc3 = ydb3.getYdoc(owner, 'c1', 'ydoc')
  await ydoc3.whenLoaded
  t.compare(ydoc3.getMap().get('k'), 'v2')
  // console.log(await actions.getClocks(ydb1), 'clientid: ', ydb1.clientid)
  // console.log(await actions.getClocks(ydb2), 'clientid: ', ydb2.clientid)
  // console.log(await actions.getClocks(ydb3), 'clientid: ', ydb3.clientid)
  // console.log('updates', ydb1.clientid, await actions.getDocOps(ydb1, 'c1', 'ydoc', operations.OpYjsUpdateType, 0))
  // console.log('updates 2', ydb2.clientid, await actions.getDocOps(ydb2, 'c1', 'ydoc', operations.OpYjsUpdateType, 0))
  // console.log('updates 3', ydb3.clientid, await actions.getDocOps(ydb3, 'c1', 'ydoc', operations.OpYjsUpdateType, 0))
}

/**
 * @param {t.TestCase} tc
 */
export const testPerformanceLoadingManyDocs = async tc => {
  const N = 1000
  await Ydb.deleteYdb(getDbName(tc.testName))
  const ydb = await Ydb.openYdb(getDbName(tc.testName), [collectionDef])
  await t.measureTimeAsync(`Create ${N} documents with initial content`, async () => {
    for (let i = 0; i < N; i++) {
      const ydoc = ydb.getYdoc(owner, collection, 'doc-' + i)
      ydoc.getMap().set('i', i)
    }
    const lastdoc = ydb.getYdoc(owner, collection, 'doc-' + (N - 1))
    await lastdoc.whenLoaded
    t.assert(lastdoc.getMap().get('i') === N - 1)
  })
  const ydb2 = await Ydb.openYdb(getDbName(tc.testName), [collectionDef])
  await t.measureTimeAsync(`Loading ${N} documents with initial content`, async () => {
    const ps = []
    for (let i = 0; i < N; i++) {
      const ydoc = ydb2.getYdoc(owner, collection, 'doc-' + i)
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
  const th = helpers.createTestScenario(tc)
  const server = th.server
  if (server === null) {
    return t.skip()
  }
  const [{ ydb: ydb1 }] = await th.createClients(1)
  await t.measureTimeAsync(`Sync ${N} documents with content to server`, async () => {
    for (let i = 0; i < N; i++) {
      const ydoc = ydb1.getYdoc(owner, 'c1', 'doc-' + i)
      ydoc.getMap().set('i', i)
    }
    const lastClientDoc = ydb1.getYdoc(owner, 'c1', 'doc-' + (N - 1))
    await lastClientDoc.whenLoaded
    const lastServerDoc = server.ydb.getYdoc(owner, 'c1', 'doc-' + (N - 1))
    await lastServerDoc.whenLoaded
    await helpers.waitDocsSynced(lastClientDoc, lastServerDoc)
    t.assert(lastServerDoc.getMap().get('i') === N - 1)
  })
  const [{ ydb: ydb2 }] = await th.createClients(1)
  await t.measureTimeAsync(`Sync ${N} documents with content from server`, async () => {
    const lastClientDoc = ydb2.getYdoc(owner, 'c1', 'doc-' + (N - 1))
    const lastServerDoc = server.ydb.getYdoc(owner, 'c1', 'doc-' + (N - 1))
    await lastServerDoc.whenLoaded
    await helpers.waitDocsSynced(lastClientDoc, lastServerDoc)
    t.assert(lastClientDoc.getMap().get('i') === N - 1)
  })
}
