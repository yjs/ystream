import * as t from 'lib0/testing'
import * as Ydb from '../src/index.js'
import * as promise from 'lib0/promise'
import * as Y from 'yjs'

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

/**
 * @param {t.TestCase} tc
 */
export const testYdocSync = async tc => {
  await Ydb.deleteYdb(getDbName(tc.testName))
  const ydb = await Ydb.openYdb(getDbName(tc.testName))
  /**
   * @param {Y.Doc} ydoc
   */
  const waitYdocSynced = ydoc => promise.create(r => ydoc.once('synced', r))
  const ydoc1 = ydb.getYdoc('collection', 'doc1')
  await waitYdocSynced(ydoc1)
  ydoc1.getMap().set('k', 'v')
  const ydoc2 = ydb.getYdoc('collection', 'doc1')
  await waitYdocSynced(ydoc2)
  t.assert(ydoc2.getMap().get('k') === 'v')
}
