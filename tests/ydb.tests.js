import * as t from 'lib0/testing'
import * as Ydb from '../src/index.js'
import * as Y from 'yjs' // eslint-disable-line
import * as utils from '../src/utils.js'
import * as promise from 'lib0/promise'
import * as array from 'lib0/array'
import * as db from '../src/db.js'

/**
 * @param {Y.Doc} ydoc1
 * @param {Y.Doc} ydoc2
 */
const waitDocsSynced = (ydoc1, ydoc2) =>
  promise.until(0, () => {
    const e1 = Y.encodeStateAsUpdateV2(ydoc1)
    const e2 = Y.encodeStateAsUpdateV2(ydoc2)
    return array.equalFlat(e1, e2)
  })

/**
 * @param {string} testname
 */
const getDbName = testname => '.test_dbs/' + testname

const emptyUpdate = Y.encodeStateAsUpdateV2(new Y.Doc())

/**
 * @param {t.TestCase} tc
 */
export const testBasic = async tc => {
  await Ydb.deleteYdb(getDbName(tc.testName))
  const y = await Ydb.openYdb(getDbName(tc.testName))
  y.addUpdate('collection', 'docname', emptyUpdate)
  y.addUpdate('collection', 'docname', emptyUpdate)
  y.addUpdate('collection', 'docname', emptyUpdate)
  y.addUpdate('collection2', 'docname', emptyUpdate)
  y.addUpdate('collection', 'docname2', emptyUpdate)
  const docOps = await db.getDocOps(y, 'collection', 'docname', 0)
  t.assert(docOps.length === 3)
  const allOps = await db.getOps(y, 0)
  t.assert(allOps.length === 3) // because doc ops are merged
  const collectionOps = await db.getCollectionOps(y, 'collection', 0)
  t.assert(collectionOps.length === 2)
}

/**
 * @param {t.TestCase} _tc
 */
export const testMergeOps = (_tc) => {
  /**
   * @type {Array<Ydb.OpValue>}
   */
  const ops = []
  ops.push(new Ydb.OpValue(0, 0, 'c1', 'd1', new Ydb.YjsOp(emptyUpdate)))
  ops.push(new Ydb.OpValue(1, 3, 'c1', 'd1', new Ydb.YjsOp(emptyUpdate)))
  ops.push(new Ydb.OpValue(0, 1, 'c1', 'd1', new Ydb.YjsOp(emptyUpdate)))
  ops.push(new Ydb.OpValue(0, 2, 'c2', 'd1', new Ydb.YjsOp(emptyUpdate)))
  const merged = utils.mergeOps(ops, false)
  t.assert(merged.length === 2)
  t.assert(merged[0].client === 0)
  t.assert(merged[0].clock === 1)
  t.compare(/** @type {import('../src/dbtypes.js').OpYjsUpdate} */ (merged[0].op).update, emptyUpdate)
  t.assert(merged[1].client === 0)
  t.assert(merged[1].clock === 2)
  t.compare(/** @type {import('../src/dbtypes.js').OpYjsUpdate} */ (merged[1].op).update, emptyUpdate)
}

/**
 * @param {t.TestCase} tc
 */
export const testYdocSync = async tc => {
  await Ydb.deleteYdb(getDbName(tc.testName))
  const ydb = await Ydb.openYdb(getDbName(tc.testName))
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
  const ydb2 = await Ydb.openYdb(getDbName(tc.testName))
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
  await Ydb.deleteYdb(getDbName(tc.testName))
  await Ydb.deleteYdb(getDbName(tc.testName) + '-2')
  await Ydb.deleteYdb(getDbName(tc.testName) + '-3')
  const ydb1 = await Ydb.openYdb(getDbName(tc.testName), {
    comms: [new Ydb.MockComm()]
  })
  const ydb2 = await Ydb.openYdb(getDbName(tc.testName) + '-2', {
    comms: [new Ydb.MockComm()]
  })
  await promise.all([ydb1.whenSynced, ydb2.whenSynced])
  const ydoc1 = ydb1.getYdoc('collection', 'ydoc')
  ydoc1.getMap().set('k', 'v1')
  const ydoc2 = ydb2.getYdoc('collection', 'ydoc')
  await ydoc2.whenLoaded
  await waitDocsSynced(ydoc1, ydoc2)
  t.compare(ydoc2.getMap().get('k'), 'v1')
  ydoc1.getMap().set('k', 'v2')
  t.compare(ydoc1.getMap().get('k'), 'v2')
  const ydb3 = await Ydb.openYdb(getDbName(tc.testName) + '-3', {
    comms: [new Ydb.MockComm()]
  })
  await ydb3.whenSynced
  const ydoc3 = ydb3.getYdoc('collection', 'ydoc')
  await ydoc3.whenLoaded
  t.compare(ydoc3.getMap().get('k'), 'v2')
  console.log(await ydb1.getClocks(), 'clientid: ', ydb1.clientid)
  console.log(await ydb2.getClocks(), 'clientid: ', ydb2.clientid)
  console.log(await ydb3.getClocks(), 'clientid: ', ydb3.clientid)
  console.log('updates', ydb1.clientid, await db.getDocOps(ydb1, 'collection', 'ydoc', 0))
  console.log('updates 2', ydb2.clientid, await db.getDocOps(ydb2, 'collection', 'ydoc', 0))
  console.log('updates 3', ydb3.clientid, await db.getDocOps(ydb3, 'collection', 'ydoc', 0))
}
