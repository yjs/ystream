import * as isodb from 'isodb'
import * as db from './db.js'
import { Ydb } from './ydb.js'
export { Ydb } from './ydb.js'

export const deleteYdb = isodb.deleteDB

/**
 * @param {string} dbname
 * @param {Array<string>} collections
 * @param {import('./ydb.js').YdbConf} [conf]
 */
export const openYdb = async (dbname, collections, conf) => {
  const idb = await db.createDb(dbname)
  return new Ydb(collections, dbname, idb, conf)
}
