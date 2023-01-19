import * as t from 'lib0/testing'
import * as Ydb from '../src/index.js'
import * as Y from 'yjs' // eslint-disable-line
import * as utils from '../src/utils.js'

/**
 * @param {string} testname
 */
const getDbName = testname => '.test_dbs/' + testname

/**
 * @param {t.TestCase} tc
 */
export const testBasic = async tc => {
  await Ydb.deleteYdb(getDbName(tc.testName))
  const y = await Ydb.openYdb(getDbName(tc.testName))
  y.addUpdate('collection', 'docname', new Uint8Array([1, 2, 3]))
  y.addUpdate('collection', 'docname', new Uint8Array([1, 2, 3]))
  y.addUpdate('collection', 'docname', new Uint8Array([1, 2, 3]))
  const updates = await y.getUpdates('collection', 'docname')
  t.assert(updates.length === 3)
}

const emptyUpdate = Y.encodeStateAsUpdateV2(new Y.Doc())

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
  t.compare(merged[0].op.update, emptyUpdate)
  t.assert(merged[1].client === 0)
  t.assert(merged[1].clock === 2)
  t.compare(merged[1].op.update, emptyUpdate)
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
