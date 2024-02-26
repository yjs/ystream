import * as isodb from 'isodb'
import * as db from './db.js'
import { Ydb } from './ydb.js'
export { Ydb } from './ydb.js'

export const deleteYdb = isodb.deleteDB

/**
 * @param {string} dbname
 * @param {Array<{ owner: string, collection: string }>} collections
 * @param {import('./ydb.js').YdbConf} [conf]
 */
export const openYdb = async (dbname, collections, conf) => {
  const { idb, isAuthenticated, user, deviceClaim } = await db.createDb(dbname)
  const ydb = new Ydb(collections, dbname, idb, user, deviceClaim, conf)
  if (isAuthenticated) {
    ydb.isAuthenticated = true
    ydb.emit('authenticate', [])
  }
  return ydb
}
