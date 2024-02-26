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
import * as authorization from './api/authorization.js'

/**
 * @typedef {import('./ydb.js').Ydb} Ydb
 */

/**
 * Receive an event whenever an operation is added to ydb. This function ensures that listener is
 * called for every op after `clock`
 *
 * @param {Ydb} ydb
 * @param {number} clock
 * @param {function(Array<dbtypes.OpValue>, boolean):void} listener - listener(ops, isCurrent)
 */
export const consumeOps = async (ydb, clock, listener) => {
  let nextClock = clock
  // get all ops, check whether eclock matches or if eclock is null
  while (ydb._eclock == null || nextClock < ydb._eclock) {
    const ops = await getOps(ydb, nextClock)
    if (ops.length > 0) {
      nextClock = ops[ops.length - 1].localClock + 1
      if (ydb._eclock === null) {
        ydb._eclock = nextClock
      } else {
        break
      }
    } else {
      break
    }
    listener(ops, ydb._eclock == null || ydb._eclock <= nextClock)
  }
  ydb.on('ops', listener)
  return listener
}

/**
 * @param {Ydb} ydb
 * @param {Uint8Array} owner
 * @param {string} collection
 */
export const getUnsyncedDocs = (ydb, owner, collection) => ydb.db.transact(async tr => {
  const ud = await tr.tables.unsyncedDocs.getKeys({ start: new dbtypes.UnsyncedKey(owner, collection, ''), end: new dbtypes.UnsyncedKey(owner, collection, null) })
  const ds = await promise.all(ud.map(async u => {
    const np = await getDocOpsLast(ydb, owner, collection, /** @type {string} */ (u.doc), operations.OpNoPermissionType)
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
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {number} clock
 */
export const getCollectionOps = async (ydb, owner, collection, clock) => {
  const ops = await ydb.db.transact(tr =>
    tr.tables.oplog.indexes.collection.getEntries({
      start: new dbtypes.CollectionKey(owner, collection, clock),
      end: new dbtypes.CollectionKey(owner, collection, number.HIGHEST_UINT32)
    })
  )
  return utils.mergeOps(_updateOpClocksHelper(ydb, ops).map(entry => entry.value), clock === 0)
}

/**
 * @template {operations.OpTypeIds} TYPE
 * @param {Ydb} ydb
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @param {TYPE} type
 * @param {number} clock
 * @return {Promise<Array<dbtypes.OpValue<InstanceType<operations.typeMap[TYPE]>>>>}
 */
export const getDocOpsEntries = async (ydb, owner, collection, doc, type, clock) => {
  const entries = await ydb.db.transact(tr =>
    tr.tables.oplog.indexes.doc.getEntries({
      start: new dbtypes.DocKey(type, owner, collection, doc, clock),
      end: new dbtypes.DocKey(type, owner, collection, doc, number.HIGHEST_UINT32)
    })
  )
  return /** @type {Array<dbtypes.OpValue<any>>} */ (_updateOpClocksHelper(ydb, entries).map(entry => entry.value))
}

/**
 * @template {operations.OpTypeIds} TYPE
 * @param {Ydb} ydb
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @param {TYPE} type
 * @param {number} clock
 * @return {Promise<Array<dbtypes.OpValue<InstanceType<operations.typeMap[TYPE]>>>>}
 */
export const getDocOps = async (ydb, owner, collection, doc, type, clock) => {
  const entries = await ydb.db.transact(tr =>
    tr.tables.oplog.indexes.doc.getEntries({
      start: new dbtypes.DocKey(type, owner, collection, doc, clock),
      end: new dbtypes.DocKey(type, owner, collection, doc, number.HIGHEST_UINT32)
    })
  )
  return /** @type {Array<dbtypes.OpValue<InstanceType<operations.typeMap[TYPE]>>>} */ (_updateOpClocksHelper(ydb, entries).map(entry => entry.value))
}

/**
 * @template {operations.OpTypeIds} TYPE
 * @param {Ydb} ydb
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @param {TYPE} type
 * @return {Promise<dbtypes.OpValue<InstanceType<operations.typeMap[TYPE]>>|null>}
 */
export const getDocOpsLast = async (ydb, owner, collection, doc, type) => {
  const entries = await ydb.db.transact(tr =>
    tr.tables.oplog.indexes.doc.getEntries({
      start: new dbtypes.DocKey(type, owner, collection, doc, 0),
      end: new dbtypes.DocKey(type, owner, collection, doc, number.HIGHEST_UINT32),
      limit: 1,
      reverse: true
    })
  )
  return /** @type {dbtypes.OpValue<InstanceType<operations.typeMap[TYPE]>>} */ (_updateOpClocksHelper(ydb, entries)[0].value) || null
}

/**
 * @template {operations.OpTypeIds} TYPE
 * @param {Ydb} ydb
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @param {TYPE} type
 * @return {Promise<dbtypes.OpValue<InstanceType<operations.typeMap[TYPE]>>|null>}
 */
export const getDocOpsMerged = (ydb, owner, collection, doc, type) => getDocOps(ydb, owner, collection, doc, type, 0).then(ops => utils.mergeOps(ops, false)[0])

/**
 * @template {operations.OpTypeIds} TYPE
 * @param {Ydb} ydb
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @param {TYPE} type
 * @return {Promise<dbtypes.OpValue<InstanceType<operations.typeMap[TYPE]>>|null>}
 */
export const mergeDocOps = (ydb, owner, collection, doc, type) =>
  ydb.db.transact(async tr => {
    const merged = await getDocOpsMerged(ydb, owner, collection, doc, type)
    tr.tables.oplog.indexes.doc.removeRange({
      start: new dbtypes.DocKey(type, owner, collection, doc, 0),
      end: new dbtypes.DocKey(type, owner, collection, doc, number.HIGHEST_UINT32),
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
 * @param {Uint8Array} owner
 * @param {string} collection
 * @return {Promise<Array<dbtypes.DocKey>>}
 */
export const getNoPerms = async (ydb, owner, collection) =>
  ydb.db.transact(tr =>
    tr.tables.oplog.indexes.doc.getKeys({ prefix: { type: operations.OpNoPermissionType, owner, collection } })
      .then(ks => filterDuplicateNoPermIndexes(ks || []))
  )

/**
 * @param {Ydb} ydb
 * @param {number} clientid
 * @param {Uint8Array?} owner
 * @param {string?} collection
 */
export const getClock = async (ydb, clientid, owner, collection) =>
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
      clocksTable.get(new dbtypes.ClocksKey(clientid, null, null))
    ]
    owner != null && queries.push(clocksTable.get(new dbtypes.ClocksKey(clientid, owner, null)))
    owner != null && collection != null && queries.push(clocksTable.get(new dbtypes.ClocksKey(clientid, owner, collection)))
    const clocks = await promise.all(queries)
    return array.fold(clocks.map(c => c ? c.clock : 0), 0, math.max)
  })

/**
 * Confirm that a all updates of a doc/collection/* from a client have been received.
 *
 * @param {Ydb} ydb
 * @param {number} clientid
 * @param {Uint8Array?} owner
 * @param {string?} collection
 * @param {number} newClock
 * @param {number} localClock
 */
export const confirmClientClock = async (ydb, clientid, owner, collection, newClock, localClock) => {
  ydb.db.transact(async tr => {
    const currClock = await getClock(ydb, clientid, owner, collection)
    if (currClock < newClock) {
      tr.tables.clocks.set(new dbtypes.ClocksKey(clientid, owner, collection), new dbtypes.ClientClockValue(newClock, localClock))
    }
  })
}

/**
 * @param {Ydb} ydb
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @param {operations.OpTypes} opv
 */
export const addOp = async (ydb, owner, collection, doc, opv) => {
  const op = await ydb.db.transact(async tr => {
    const op = new dbtypes.OpValue(ydb.clientid, 0, owner, collection, doc, opv)
    const key = await tr.tables.oplog.add(op)
    op.clock = key.v
    op.localClock = key.v
    tr.tables.clocks.set(new dbtypes.ClocksKey(op.client, owner, collection), new dbtypes.ClientClockValue(op.clock, op.clock))
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
      map.setIfUndefined(collectionClocks, /** @type {string} */ (entry.key.collection), map.create).set(entry.key.clientid, entry.value)
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
 * @param {dbtypes.UserIdentity} user
 */
export const applyRemoteOps = async (ydb, ops, user) => {
  /**
   * @type {Array<dbtypes.OpValue<any>>}
   */
  const filteredOpsPermsChecked = []
  await ydb.db.transact(async tr => {
    /**
     * Maps from encoded(collection/doc/clientid) to clock
     * @type {Map<string,number>}
     */
    const clocks = new Map()
    /**
     * @param {number} client
     * @param {Uint8Array} owner
     * @param {string} collection
     */
    const encodeClocksKey = (client, owner, collection) => buffer.toBase64(encoding.encode(encoder => new dbtypes.ClocksKey(client, owner, collection).encode(encoder)))
    // wait for all clock requests
    await promise.all(array.uniqueBy(ops, op => op.client).map(async op => {
      const clock = await getClock(ydb, op.client, op.owner, op.collection)
      clock > 0 && clocks.set(encodeClocksKey(op.client, op.owner, op.collection), clock)
    }))
    /**
     * @type {Map<string,dbtypes.ClientClockValue>}
     */
    const clientClockEntries = new Map()
    const filteredOps = ops.filter(op => op.client !== ydb.clientid && op.clock > (clocks.get(encodeClocksKey(op.client, op.owner, op.collection)) || -1))
    /**
     * @type {Map<string,Map<string,Map<string,boolean>>>}
     */
    const permissions = new Map()
    filteredOps.forEach(op => { map.setIfUndefined(map.setIfUndefined(permissions, buffer.toBase64(op.owner), map.create), op.collection, () => new Map()).set(op.doc, false) })
    await promise.all(array.from(permissions.entries()).map(async ([_owner, collections]) => {
      const owner = buffer.fromBase64(_owner)
      if (array.equalFlat(owner, user.hash)) {
        // sender is creator of the collections, no need to check db for permissions
        collections.forEach(docs => {
          docs.set('*', true)
        })
      } else {
        return promise.all(array.from(collections.entries()).map(async ([collectionName, docs]) => {
          const hasCollectionAccess = await authorization.hasWriteAccess(ydb, owner, collectionName, '*', user)
          if (hasCollectionAccess) {
            docs.set('*', true)
          } else {
            await promise.all(array.from(docs.keys()).map(
              docName => authorization.hasWriteAccess(ydb, owner, collectionName, docName, user).then(hasWriteAccess => docs.set(docName, hasWriteAccess))
            ))
          }
        }))
      }
    }))
    // 1. Filter ops that have already been applied 2. apply ops 3. update clocks table
    await promise.all(filteredOps.map(async op => {
      const colperms = permissions.get(buffer.toBase64(op.owner))?.get(op.collection)
      if (colperms?.get('*') || colperms?.get(op.doc)) {
        const localClock = await tr.tables.oplog.add(op)
        op.localClock = localClock.v
        clientClockEntries.set(encodeClocksKey(op.client, op.owner, op.collection), new dbtypes.ClientClockValue(op.clock, op.localClock))
        filteredOpsPermsChecked.push(op)
      } else {
        console.log('Not applying op because of missing permission', op, ydb.syncsEverything, user.hash, user.isTrusted)
      }
    }))
    clientClockEntries.forEach((clockValue, encClocksKey) => {
      const clocksKey = dbtypes.ClocksKey.decode(decoding.createDecoder(buffer.fromBase64(encClocksKey)))
      tr.tables.clocks.set(clocksKey, clockValue)
    })
  })
  emitOpsEvent(ydb, filteredOpsPermsChecked)
  // @todo only apply doc ops to ydocs if sender has write permissions
  /**
   * @type {Map<string, Map<string, Map<string, Array<dbtypes.OpValue>>>>}
   */
  const sorted = new Map()
  filteredOpsPermsChecked.forEach(op => {
    map.setIfUndefined(map.setIfUndefined(map.setIfUndefined(sorted, buffer.toBase64(op.owner), map.create), op.collection, map.create), op.doc, () => /** @type {Array<dbtypes.OpValue>} */ ([])).push(op)
  })
  sorted.forEach((collections, owner) => {
    // @todo check if this is reached
    collections.forEach((col, colname) => {
      const docs = ydb.collections.get(owner)?.get(colname)
      if (docs) {
        col.forEach((updates, docname) => {
          const docupdates = utils.filterYjsUpdateOps(updates)
          const docset = docs.get(docname)
          /* c8 ignore next */
          if (docupdates.length > 0 && ((docset && docset.size > 0) || env.isBrowser)) {
            const mergedUpdate = Y.mergeUpdatesV2(docupdates.map(op => op.op.update))
            if (docset && docset.size > 0) {
              docset.forEach(doc => Y.applyUpdateV2(doc, mergedUpdate))
            }
            /* c8 ignore start */
            if (env.isBrowser) {
              // @todo (separate from below) we should publish via bc, instead only publish an
              // "updated" notification
              // @todo this could use DocKey encoding
              // @todo could use more efficient encoding - allow Uint8Array in lib0/bc
              // @todo this should be generated by a function
              const bcroom = `ydb#${ydb.dbname}#${owner}#${colname}#${docname}`
              bc.publish(bcroom, buffer.toBase64(mergedUpdate), ydb)
            }
            /* c8 ignore end */
          }
        })
      }
    })
  })
}
