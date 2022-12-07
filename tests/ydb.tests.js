import * as t from 'lib0/testing'
import * as ydb from '../src/index.js'

/**
 * @param {string} testname
 */
const getDbName = testname => '.test_dbs/' + testname

/**
 * @param {t.TestCase} tc
 */
export const testBasic = async tc => {
  await ydb.deleteYdb(getDbName(tc.testName))
  const y = await ydb.openYdb(getDbName(tc.testName))
  y.addUpdate('collection', 'docname', new Uint8Array([1, 2, 3]))
  y.addUpdate('collection', 'docname', new Uint8Array([1, 2, 3]))
  y.addUpdate('collection', 'docname', new Uint8Array([1, 2, 3]))
  const updates = await y.getUpdates('collection', 'docname')
  t.assert(updates.length === 3)
}
