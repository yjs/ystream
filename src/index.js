import * as isodb from 'isodb'
import * as db from './db.js'
import { Ydb } from './ydb.js'
export { Ydb } from './ydb.js'

export const deleteYdb = isodb.deleteDB

/**
 * @param {string} dbname
 * @param {import('./ydb.js').YdbConf} [conf]
 */
export const openYdb = async (dbname, conf) => {
  const { idb, isAuthenticated, user, deviceClaim } = await db.createDb(dbname)
  const ydb = new Ydb(dbname, idb, user, deviceClaim, conf)
  if (isAuthenticated) {
    ydb.isAuthenticated = true
    ydb.emit('authenticate', [])
  }
  return ydb
}
