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
import * as operations from './operations.js'
import * as utils from './utils.js'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { emitOpsEvent } from './ydb.js'

/**
 * @typedef {import('./ydb.js').Ydb} Ydb
 */

/**
 * @param {Ydb} ydb
 * @param {string} collection
 */
export const getUnsyncedDocs = (ydb, collection) => ydb.db.transact(async tr => {
  const ud = await tr.tables.unsyncedDocs.getKeys({ start: new dbtypes.UnsyncedKey(collection, ''), end: new dbtypes.UnsyncedKey(collection, null) })
  const ds = await promise.all(ud.map(async u => {
    const np = await getDocOpsLast(ydb, collection, /** @type {string} */ (u.doc), operations.OpNoPermissionType)
    if (np == null) {
      await tr.tables.unsyncedDocs.remove(u)
    }
    return np
  }))
  return /** @type {Array<dbtypes.OpValue<operations.OpNoPermission>>} */ (ds.filter(d => d !== null))
})

/**
 * @template {operations.OpTypes} OP
 * @template {{ value: dbtypes.OpValue<OP>, fkey: isodb.AutoKey }} UPDATE
 * @param {Ydb} ydb
 * @param {Array<UPDATE>} updates
 * @return {Array<UPDATE>}
 */
const _updateOpClocksHelper = (ydb, updates) => updates.map(update => {
  update.value.localClock = update.fkey.v
  if (update.value.client === ydb.clientid) {
    update.value.clock = update.fkey.v
  }
  return update
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
    update.value.localClock = update.key.v
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
      end: new dbtypes.CollectionKey(collection, number.HIGHEST_UINT32)
    })
  )
  return utils.mergeOps(_updateOpClocksHelper(ydb, ops).map(entry => entry.value), clock === 0)
}

/**
 * @template {operations.OpTypeIds} TYPE
 * @param {Ydb} ydb
 * @param {string} collection
 * @param {string} doc
 * @param {TYPE} type
 * @param {number} clock
 * @return {Promise<Array<dbtypes.OpValue<InstanceType<operations.typeMap[TYPE]>>>>}
 */
export const getDocOpsEntries = async (ydb, collection, doc, type, clock) => {
  const entries = await ydb.db.transact(tr =>
    tr.tables.oplog.indexes.doc.getEntries({
      start: new dbtypes.DocKey(type, collection, doc, clock),
      end: new dbtypes.DocKey(type, collection, doc, number.HIGHEST_UINT32)
    })
  )
  return /** @type {Array<dbtypes.OpValue<any>>} */ (_updateOpClocksHelper(ydb, entries).map(entry => entry.value))
}

/**
 * @template {operations.OpTypeIds} TYPE
 * @param {Ydb} ydb
 * @param {string} collection
 * @param {string} doc
 * @param {TYPE} type
 * @param {number} clock
 * @return {Promise<Array<dbtypes.OpValue<InstanceType<operations.typeMap[TYPE]>>>>}
 */
export const getDocOps = async (ydb, collection, doc, type, clock) => {
  const entries = await ydb.db.transact(tr =>
    tr.tables.oplog.indexes.doc.getEntries({
      start: new dbtypes.DocKey(type, collection, doc, clock),
      end: new dbtypes.DocKey(type, collection, doc, number.HIGHEST_UINT32)
    })
  )
  return /** @type {Array<dbtypes.OpValue<InstanceType<operations.typeMap[TYPE]>>>} */ (_updateOpClocksHelper(ydb, entries).map(entry => entry.value))
}

/**
 * @template {operations.OpTypeIds} TYPE
 * @param {Ydb} ydb
 * @param {string} collection
 * @param {string} doc
 * @param {TYPE} type
 * @return {Promise<dbtypes.OpValue<InstanceType<operations.typeMap[TYPE]>>|null>}
 */
export const getDocOpsLast = async (ydb, collection, doc, type) => {
  const entries = await ydb.db.transact(tr =>
    tr.tables.oplog.indexes.doc.getEntries({
      start: new dbtypes.DocKey(type, collection, doc, 0),
      end: new dbtypes.DocKey(type, collection, doc, number.HIGHEST_UINT32),
      limit: 1,
      reverse: true
    })
  )
  return /** @type {dbtypes.OpValue<InstanceType<operations.typeMap[TYPE]>>} */ (_updateOpClocksHelper(ydb, entries)[0].value) || null
}

/**
 * @template {operations.OpTypeIds} TYPE
 * @param {Ydb} ydb
 * @param {string} collection
 * @param {string} doc
 * @param {TYPE} type
 * @return {Promise<dbtypes.OpValue<InstanceType<operations.typeMap[TYPE]>>|null>}
 */
export const getDocOpsMerged = (ydb, collection, doc, type) => getDocOps(ydb, collection, doc, type, 0).then(ops => utils.mergeOps(ops, false)[0])

/**
 * @template {operations.OpTypeIds} TYPE
 * @param {Ydb} ydb
 * @param {string} collection
 * @param {string} doc
 * @param {TYPE} type
 * @return {Promise<dbtypes.OpValue<InstanceType<operations.typeMap[TYPE]>>|null>}
 */
export const mergeDocOps = (ydb, collection, doc, type) =>
  ydb.db.transact(async tr => {
    const merged = await getDocOpsMerged(ydb, collection, doc, type)
    tr.tables.oplog.indexes.doc.removeRange({
      start: new dbtypes.DocKey(type, collection, doc, 0),
      end: new dbtypes.DocKey(type, collection, doc, number.HIGHEST_UINT32),
      endExclusive: true
    })
    merged && tr.tables.oplog.add(merged)
    return merged
  })

/**
 * @param {Array<dbtypes.DocKey>} noperms
 */
const filterDuplicateNoPermIndexes = noperms => {
  const visited = new Set()
  /**
   * @type {Array<dbtypes.DocKey>}
   */
  const result = []
  for (let i = noperms.length - 1; i >= 0; i--) {
    const p = noperms[i]
    if (p.doc == null || visited.has(p.doc)) continue
    visited.add(p.doc)
    result.push(p)
  }
  return result
}

/**
 * Returns up to N documents that we don't have permission to. Only the first entry for each doc is
 * returned.
 *
 * @param {Ydb} ydb
 * @param {string} collection
 * @return {Promise<Array<dbtypes.DocKey>>}
 */
export const getNoPerms = async (ydb, collection) =>
  ydb.db.transact(tr =>
    tr.tables.oplog.indexes.doc.getKeys({ prefix: { type: operations.OpNoPermissionType, collection } })
      .then(ks => filterDuplicateNoPermIndexes(ks || []))
  )

/**
 * @param {Ydb} ydb
 * @param {number} clientid
 * @param {string?} collection
 */
export const getClock = async (ydb, clientid, collection) =>
  ydb.db.transact(async tr => {
    if (ydb.clientid === clientid) {
      const latestEntry = await tr.tables.oplog.getKeys({
        end: number.HIGHEST_UINT32, // @todo change to uint
        reverse: true,
        limit: 1
      })
      return latestEntry.length > 0 ? latestEntry[0].v : 0
    }
    const clocksTable = tr.tables.clocks
    const queries = [
      clocksTable.get(new dbtypes.ClocksKey(clientid, null))
    ]
    collection && queries.push(clocksTable.get(new dbtypes.ClocksKey(clientid, collection)))
    const clocks = await promise.all(queries)
    return array.fold(clocks.map(c => c ? c.clock : 0), 0, math.max)
  })

/**
 * Confirm that a all updates of a doc/collection/* from a client have been received.
 *
 * @param {Ydb} ydb
 * @param {number} clientid
 * @param {string?} collection
 * @param {number} newClock
 * @param {number} localClock
 */
export const confirmClientClock = async (ydb, clientid, collection, newClock, localClock) => {
  ydb.db.transact(async tr => {
    const currClock = await getClock(ydb, clientid, collection)
    if (currClock < newClock) {
      tr.tables.clocks.set(new dbtypes.ClocksKey(clientid, collection), new dbtypes.ClientClockValue(newClock, localClock))
    }
  })
}

/**
 * @param {Ydb} ydb
 * @param {string} collection
 * @param {string} doc
 * @param {operations.OpTypes} opv
 */
export const addOp = async (ydb, collection, doc, opv) => {
  const op = await ydb.db.transact(async tr => {
    const op = new dbtypes.OpValue(ydb.clientid, 0, collection, doc, opv)
    const key = await tr.tables.oplog.add(op)
    op.clock = key.v
    op.localClock = key.v
    tr.tables.clocks.set(new dbtypes.ClocksKey(op.client, collection), new dbtypes.ClientClockValue(op.clock, op.clock))
    return op
  })
  emitOpsEvent(ydb, [op])
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
 */
export const applyRemoteOps = (ydb, ops) => {
  const p = ydb.db.transact(async tr => {
    /**
     * Maps from encoded(collection/doc/clientid) to clock
     * @type {Map<string,number>}
     */
    const clocks = new Map()
    /**
     * @param {number} client
     * @param {string} collection
     */
    const encodeClocksKey = (client, collection) => buffer.toBase64(encoding.encode(encoder => new dbtypes.ClocksKey(client, collection).encode(encoder)))
    // wait for all clock requests
    await promise.all(array.uniqueBy(ops, op => op.client).map(async op => {
      const clock = await getClock(ydb, op.client, op.collection)
      clock > 0 && clocks.set(encodeClocksKey(op.client, op.collection), clock)
    }))
    /**
     * @type {Map<string,dbtypes.ClientClockValue>}
     */
    const clientClockEntries = new Map()
    // 1. Filter ops that have already been applied 2. apply ops 3. update clocks table
    await promise.all(ops.filter(op => op.clock >= (clocks.get(encodeClocksKey(op.client, op.collection)) || 0)).map(async op => {
      const localClock = await tr.tables.oplog.add(op)
      op.localClock = localClock.v
      clientClockEntries.set(encodeClocksKey(op.client, op.collection), new dbtypes.ClientClockValue(op.clock, localClock.v))
    }))
    clientClockEntries.forEach((clockValue, encClocksKey) => {
      const clocksKey = dbtypes.ClocksKey.decode(decoding.createDecoder(buffer.fromBase64(encClocksKey)))
      tr.tables.clocks.set(clocksKey, clockValue)
    })
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
            // @todo this could use DocKey encoding
            // @todo could use more efficient encoding - allow Uint8Array in lib0/bc
            // @todo this should be generated by a function
            const bcroom = `ydb#${ydb.dbname}#${colname}#${docname}`
            bc.publish(bcroom, buffer.toBase64(mergedUpdate), ydb)
          }
          /* c8 ignore end */
        }
      })
    }
  })
  return p
}
