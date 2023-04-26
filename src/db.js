import * as dbtypes from './dbtypes.js'
import * as isodb from 'isodb'
import * as utils from './utils.js'

/**
 * @typedef {import('./ydb.js').Ydb} Ydb
 */

export const def = {
  tables: {
    oplog: {
      key: isodb.AutoKey,
      value: dbtypes.OpValue,
      indexes: {
        doc: {
        /**
         * @param {isodb.AutoKey} k
         * @param {dbtypes.OpValue} v
         */
          mapper: (k, v) => new dbtypes.DocKey(v.collection, v.doc, k.v),
          key: dbtypes.DocKey
        },
        collection: {
        /**
         * @param {isodb.AutoKey} k
         * @param {dbtypes.OpValue} v
         */
          mapper: (k, v) => new dbtypes.CollectionKey(v.collection, k.v),
          key: dbtypes.CollectionKey
        }
      }
    },
    clocks: {
      key: isodb.Uint32Key, // is a clientid
      value: dbtypes.ClientClockValue
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
  const mergedOps = utils.mergeOps(ops, clock === 0)
  console.log('testing merge', { ops, mergedOps })
  return mergedOps
}
