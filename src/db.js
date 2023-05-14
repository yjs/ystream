import * as dbtypes from './dbtypes.js'
import * as isodb from 'isodb'
import * as utils from './utils.js'
import * as number from 'lib0/number'
import * as promise from 'lib0/promise'
import * as array from 'lib0/array'
import * as math from 'lib0/math'

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
      key: dbtypes.ClocksKey,
      value: dbtypes.ClientClockValue
    }
  }
}

/**
 * # Algorithm to sync documents that a user just got permission to:
 *
 * The information that a document has been created (the first update) is always sent to all users.
 * However, users that don't have permission won't receive the content and simply store a "no
 * permission" information in the `oplog`.
 *
 * When we receive new permission, we store an "todo item in the `reqs`" table: "check table
 * starting at clock X". The name should be unique. Two separate permission changes should update
 * the same item. Simpler implementation: `reqs` table uses AutoKey or `collection/autokey` (by
 * index) and we have to work through the list until completion.
 *
 * We iterate through the table and sync each document individually until we completed the whole
 * collection table. Every time we synced a document, we update the todo item. Once completed,
 * we delete the todo item in reqs.
 *
 * # Todo
 * - ( ) implement request "sync document starting from clock X"
 * - ( ) implement requests table and figure out key-system.
 */

/**
 * @param {string} dbname
 */
export const createDb = dbname =>
  isodb.openDB(dbname, def)

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

/**
 * @param {Ydb} ydb
 * @param {number} clientid
 * @param {string?} collection
 * @param {string?} doc
 */
export const getClock = async (ydb, clientid, collection, doc) =>
  ydb.db.transact(async tr => {
    if (ydb.clientid === clientid) {
      const latestEntry = await tr.tables.oplog.getKeys({
        end: number.HIGHEST_INT32, // @todo change to uint
        reverse: true,
        limit: 1
      })
      return latestEntry.length > 0 ? latestEntry[0].v : 0
    }
    const clocksTable = tr.tables.clocks
    const queries = [
      clocksTable.get(new dbtypes.ClocksKey(clientid, null, null))
    ]
    collection && queries.push(clocksTable.get(new dbtypes.ClocksKey(clientid, collection, null)))
    doc && queries.push(clocksTable.get(new dbtypes.ClocksKey(clientid, collection, doc)))
    const clocks = await promise.all(queries)
    return array.fold(clocks.map(c => c ? c.clock : 0), 0, math.max)
  })

/**
 * Confirm that a all updates of a doc/collection/* from a client have been received.
 *
 * @param {Ydb} ydb
 * @param {number} clientid
 * @param {string?} collection
 * @param {string?} doc
 * @param {number} newClock
 */
export const confirmClientClock = async (ydb, clientid, collection, doc, newClock) => {
  ydb.db.transact(async tr => {
    const currClock = await getClock(ydb, clientid, collection, doc)
    if (currClock < newClock) {
      tr.tables.clocks.set(new dbtypes.ClocksKey(clientid, collection, doc), newClock)
    }
  })
}
