import * as isodb from 'isodb'
import * as db from './db.js'
import { Ydb } from './ydb.js'
export { Ydb } from './ydb.js'

export { OpValue, OpYjsUpdate as YjsOp } from './dbtypes.js'
export { MockComm } from './comm.js'

export const deleteYdb = isodb.deleteDB

/**
 * @param {string} dbname
 * @param {import('./ydb.js').YdbConf} [conf]
 */
export const openYdb = async (dbname, conf) => {
  const idb = await db.createDb(dbname)
  return new Ydb(dbname, idb, conf)
}
