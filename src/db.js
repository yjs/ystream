import * as dbtypes from './dbtypes.js'
import * as isodb from 'isodb'
import * as utils from './utils.js'
import * as number from 'lib0/number'

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
 * @param {Ydb} ydb
 * @param {Array<{ value: dbtypes.OpValue, fkey: isodb.AutoKey }>} updates
 */
const updateOpClocks = (ydb, updates) => updates.map(update => {
  if (update.value.client === ydb.clientid) {
    update.value.clock = update.fkey.v
  }
  return update.value
})

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
    tr.tables.oplog.getEntries({ start: new isodb.AutoKey(clock) })
  )
  return utils.mergeOps(ops.map(update => {
    if (update.value.client === ydb.clientid) {
      update.value.clock = update.key.v
    }
    return update.value
  }), clock === 0)
}

/**
 * @param {Ydb} ydb
 * @param {string} collection
 * @param {number} clock
 */
export const getCollectionOps = async (ydb, collection, clock) => {
  const ops = await ydb.db.transact(tr =>
    tr.tables.oplog.indexes.collection.getEntries({
      start: new dbtypes.CollectionKey(collection, clock),
      end: new dbtypes.CollectionKey(collection, number.HIGHEST_INT32) // @todo should use number.HIGHEST_UINT32
    })
  )
  return utils.mergeOps(updateOpClocks(ydb, ops), clock === 0)
}

/**
 * @param {Ydb} ydb
 * @param {string} collection
 * @param {string} doc
 * @param {number} clock
 */
export const getDocOps = async (ydb, collection, doc, clock) => {
  const entries = await ydb.db.transact(tr =>
    tr.tables.oplog.indexes.doc.getEntries({
      start: new dbtypes.DocKey(collection, doc, clock),
      end: new dbtypes.DocKey(collection, doc, number.HIGHEST_INT32)// @todo should use number.HIGHEST_UINT32
    })
  )
  /**
   * @type {Array<dbtypes.OpValue>}
   */
  const updates = []
  entries.forEach(entry => {
    if (entry.value.client === ydb.clientid) {
      entry.value.clock = entry.fkey.v
    }
    updates.push(entry.value)
  })
  return updateOpClocks(ydb, entries)
}
