import * as isodb from 'isodb'
import * as db from './db.js'
import { Ystream } from './ystream.js'
export { Ystream, Collection } from './ystream.js'

export const remove = isodb.deleteDB

/**
 * @param {string} dbname
 * @param {import('./ystream.js').YstreamConf} [conf]
 */
export const open = async (dbname, conf) => {
  const { idb, isAuthenticated, user, deviceClaim } = await db.createDb(dbname)
  const ystream = new Ystream(dbname, idb, user, deviceClaim, conf)
  if (isAuthenticated) {
    ystream.isAuthenticated = true
    ystream.emit('authenticate', [])
  }
  return ystream
}
