import * as t from 'lib0/testing'
import * as promise from 'lib0/promise'

import * as Ydb from '../src/index.js'
import * as helpers from './helpers.js'
// import * as actions from '../src/actions.js'
// import * as operations from '../src/operations.js'

/**
 * @param {string} testname
 */
const getDbName = testname => '.test_dbs/' + testname

/**
 * Testing loading from the database.
 *
 * @param {t.TestCase} tc
 */
export const testYdocLoad = async tc => {
  await Ydb.deleteYdb(getDbName(tc.testName))
  const ydb = await Ydb.openYdb(getDbName(tc.testName), ['collection'])
  const ydoc1 = ydb.getYdoc('collection', 'doc1')
  await ydoc1.whenLoaded
  ydoc1.getMap().set('k', 'v')
  const ydoc2 = ydb.getYdoc('collection', 'doc1')
  await ydoc2.whenLoaded
  t.assert(ydoc2.getMap().get('k') === 'v')
  ydoc1.getMap().set('k', 'v2')
  t.assert(ydoc1.getMap().get('k') === 'v2')
  console.log('before destroy')
  await ydb.destroy()
  console.log('after destroy')
  const ydb2 = await Ydb.openYdb(getDbName(tc.testName), ['collection'])
  console.log('after open')
  const ydoc3 = ydb2.getYdoc('collection', 'doc1')
  console.log('after getdoc')
  await ydoc3.whenLoaded
  console.log('after loaded')
  t.compare(ydoc3.getMap().get('k'), 'v2')
}

/**
 * @param {t.TestCase} tc
 */
export const testComm = async tc => {
  const th = helpers.createTestHelper(tc)
  const [ydb1, ydb2] = await th.createClients(2)
  await promise.all([ydb1.whenSynced, ydb2.whenSynced])
  const ydoc1 = ydb1.getYdoc('c1', 'ydoc')
  ydoc1.getMap().set('k', 'v1')
  const ydoc2 = ydb2.getYdoc('c1', 'ydoc')
  await ydoc2.whenLoaded
  await helpers.waitDocsSynced(ydoc1, ydoc2)
  t.compare(ydoc2.getMap().get('k'), 'v1')
  ydoc1.getMap().set('k', 'v2')
  t.compare(ydoc1.getMap().get('k'), 'v2')
  await helpers.waitDocsSynced(ydoc1, ydoc2)
  t.compare(ydoc2.getMap().get('k'), 'v2')
  const ydb3 = await th.createClient()
  await ydb3.whenSynced
  const ydoc3 = ydb3.getYdoc('c1', 'ydoc')
  await ydoc3.whenLoaded
  t.compare(ydoc3.getMap().get('k'), 'v2')
  // console.log(await actions.getClocks(ydb1), 'clientid: ', ydb1.clientid)
  // console.log(await actions.getClocks(ydb2), 'clientid: ', ydb2.clientid)
  // console.log(await actions.getClocks(ydb3), 'clientid: ', ydb3.clientid)
  // console.log('updates', ydb1.clientid, await actions.getDocOps(ydb1, 'c1', 'ydoc', operations.OpYjsUpdateType, 0))
  // console.log('updates 2', ydb2.clientid, await actions.getDocOps(ydb2, 'c1', 'ydoc', operations.OpYjsUpdateType, 0))
  // console.log('updates 3', ydb3.clientid, await actions.getDocOps(ydb3, 'c1', 'ydoc', operations.OpYjsUpdateType, 0))
}
