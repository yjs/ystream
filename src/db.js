import * as ops from './ops.js'
import * as isodb from 'isodb'
import * as utils from './utils.js'

/**
 * @typedef {import('./ydb.js').Ydb} Ydb
 */

export const def = {
  oplog: {
    key: isodb.AutoKey,
    value: ops.OpValue,
    indexes: {
      doc: {
        key: ops.DocKey,
        /**
         * @param {isodb.AutoKey} k
         * @param {ops.OpValue} v
         */
        mapper: (k, v) => new ops.DocKey(v.collection, v.doc, k.v)
      }
    }
  }
}

/**
 * @param {string} dbname
 */
export const createDb = dbname =>
  isodb.openDB(dbname, def)

/**
 * @param {Ydb} ydb
 * @param {number} clock
 */
export const getOps = async (ydb, clock) => {
  const ops = await ydb.db.transact(tr =>
    tr.tables.oplog.getValues({ start: new isodb.AutoKey(clock) })
  )
  return utils.mergeOps(ops, clock === 0)
}
