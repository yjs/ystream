import * as isodb from 'isodb'
import * as ops from './ops.js'
import * as Y from 'yjs'
import * as map from 'lib0/map'
import { setIfUndefined } from 'lib0/map.js'
import { bindydoc } from './bindydoc.js'
import * as env from 'lib0/environment'
import * as bc from 'lib0/broadcastchannel'
import * as buffer from 'lib0/buffer'
import * as db from './db.js'
import { Ydb } from './ydb.js'
export { Ydb } from './ydb.js'

export { OpValue, YjsOp } from './ops.js'

export const deleteYdb = isodb.deleteDB

/**
 * @param {string} dbname
 */
export const openYdb = async (dbname) => {
  const idb = await db.createDb(dbname)
  return new Ydb(dbname, idb)
}
