import * as array from 'lib0/array'
import * as bc from 'lib0/broadcastchannel'
import * as buffer from 'lib0/buffer'
import * as env from 'lib0/environment'
import * as map from 'lib0/map'
import * as math from 'lib0/math'
import * as number from 'lib0/number'
import * as promise from 'lib0/promise'
import * as isodb from 'isodb'
import * as Y from 'yjs'
import * as dbtypes from './dbtypes.js'
import * as utils from './utils.js'

/**
 * @typedef {import('./ydb.js').Ydb} Ydb
 */

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
 * @param {number} type
 * @param {number} clock
 */
export const getDocOps = async (ydb, collection, doc, type, clock) => {
  const entries = await ydb.db.transact(tr =>
    tr.tables.oplog.indexes.doc.getEntries({
      start: new dbtypes.DocKey(collection, doc, type, clock),
      end: new dbtypes.DocKey(collection, doc, type, number.HIGHEST_INT32)// @todo should use number.HIGHEST_UINT32
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

/**
 * @param {Ydb} ydb
 * @param {string} collection
 * @param {string} doc
 * @param {Uint8Array} update
 */
export const addYjsUpdate = async (ydb, collection, doc, update) => {
  const op = await ydb.db.transact(async tr => {
    const op = new dbtypes.OpValue(ydb.clientid, 0, collection, doc, new dbtypes.OpYjsUpdate(update))
    const key = await tr.tables.oplog.add(op)
    op.clock = key.v
    tr.tables.clocks.set(op.client, new dbtypes.ClientClockValue(op.clock, op.clock))
    return op
  })
  ydb.comms.forEach(comm => {
    comm.broadcast([op])
  })
}

/**
 * @param {Ydb} ydb
 */
export const getClocks = ydb =>
  ydb.db.transactReadonly(async tr => {
    const entries = await tr.tables.clocks.getEntries({})
    /**
       * @type {Map<string,Map<number,dbtypes.ClientClockValue>>}
       */
    const collectionClocks = new Map()
    entries.forEach(entry => {
      map.setIfUndefined(collectionClocks, entry.key.collection, map.create).set(entry.key.clientid, entry.value)
    })
    const lastKey = await tr.tables.oplog.getKeys({ reverse: true, limit: 1 })
    if (lastKey.length >= 0) {
      collectionClocks.forEach(cls => {
        cls.set(ydb.clientid, new dbtypes.ClientClockValue(lastKey[0].v, lastKey[0].v))
      })
    }
    return collectionClocks
  })

/**
 * @param {Ydb} ydb
 * @param {Array<dbtypes.OpValue>} ops
 * @param {boolean} shouldFilter Filter operations with older client-id - this should only be true if the connection is
 *                               synced
 */
export const applyRemoteOps = (ydb, ops, shouldFilter) => {
  const p = ydb.db.transact(async tr => {
    /**
     * Maps from clientid to clock
     * @type {Map<number,number>}
     */
    const clocks = new Map()
    // wait for all clock requests
    await promise.all(array.uniqueBy(ops, op => op.client).map(op =>
      tr.tables.clocks.get(op.client).then(clock => {
        clock && clocks.set(op.client, clock.clock)
      })
    ))
    /**
     * @type {Map<number,dbtypes.ClientClockValue>}
     */
    const clientClockEntries = new Map()
    // 1. Filter ops that have already been applied 2. apply ops 3. update clocks table
    await promise.all((!shouldFilter ? ops : ops.filter(op => op.clock >= (clocks.get(op.client) || 0))).map(op =>
      tr.tables.oplog.add(op).then(localClock => {
        clientClockEntries.set(op.client, new dbtypes.ClientClockValue(op.clock, localClock.v))
      })
    ))
    clientClockEntries.forEach((clockValue, client) => {
      tr.tables.clocks.set(client, clockValue)
    })
    console.log(ydb.dbname, 'wrote ops', ops)
  })
  /**
     * @type {Map<string, Map<string, Array<dbtypes.OpValue>>>}
     */
  const sorted = new Map()
  ops.forEach(op => {
    map.setIfUndefined(map.setIfUndefined(sorted, op.collection, map.create), op.doc, () => /** @type {Array<dbtypes.OpValue>} */ ([])).push(op)
  })
  sorted.forEach((col, colname) => {
    const docs = ydb.collections.get(colname)
    if (docs) {
      col.forEach((updates, docname) => {
        const docupdates = utils.filterYjsUpdateOps(updates)
        const docset = docs.get(docname)
        /* c8 ignore next */
        if ((docset && docset.size > 0) || env.isBrowser) {
          const mergedUpdate = Y.mergeUpdatesV2(docupdates.map(op => op.op.update))
          if (docset && docset.size > 0) {
            docset.forEach(doc => Y.applyUpdateV2(doc, mergedUpdate))
          }
          /* c8 ignore start */
          if (env.isBrowser) {
            // @todo could use more efficient encoding - allow Uint8Array in lib0/bc
            // @todo this should be generated by a function
            const bcroom = `${ydb.dbname}#${colname}#${docname}`
            bc.publish(bcroom, buffer.toBase64(mergedUpdate), ydb)
          }
          /* c8 ignore end */
        }
      })
    }
  })
  return p
}
