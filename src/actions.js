import * as array from 'lib0/array'
import * as bc from 'lib0/broadcastchannel'
import * as buffer from 'lib0/buffer'
import * as env from 'lib0/environment'
import * as map from 'lib0/map'
import * as math from 'lib0/math'
import * as number from 'lib0/number'
import * as promise from 'lib0/promise'
import * as Y from 'yjs'
import * as dbtypes from './dbtypes.js'
import * as operations from './operations.js'
import * as utils from './utils.js'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { emitOpsEvent } from './ystream.js'
import * as authorization from './api/authorization.js'
import * as protocol from './protocol.js'
import * as isodb from 'isodb'

/**
 * @typedef {import('./ystream.js').Ystream} Ystream
 */

/**
 * @param {Ystream} ystream
 * @param {number} startClock
 * @param {Uint8Array?} owner
 * @param {string?} collection
 * @return {ReadableStream<{ messages: Array<dbtypes.OpValue|Uint8Array>, origin: any }>}
 */
export const createOpsReader = (ystream, startClock, owner, collection) => {
  let nextClock = startClock
  /**
   * @type {((ops: Array<dbtypes.OpValue>, origin: any) => void) | null}
   */
  let listener = null
  let registeredListener = false
  /**
   * @type {ReadableStream<{ messages: Array<dbtypes.OpValue|Uint8Array>, origin: any }>}
   */
  const stream = new ReadableStream({
    start (controller) {
      listener = (ops, origin) => {
        if (collection != null) {
          ops = ops.filter(op => op.localClock >= nextClock && op.collection === collection && array.equalFlat(op.owner, /** @type {Uint8Array} */ (owner)))
        } else {
          ops = ops.filter(op => op.localClock >= nextClock)
        }
        if (ops.length > 0) {
          nextClock = ops[ops.length - 1].localClock + 1
          controller.enqueue({ messages: ops, origin })
        }
      }
    },
    async pull (controller) {
      if (registeredListener) return
      console.log('desired size: ', controller.desiredSize, { nextClock })
      return ystream.transact(async tr => {
        do {
          const ops = owner != null && collection != null
            ? await tr.tables.oplog.indexes.collection.getEntries({
              start: new dbtypes.CollectionKey(owner, collection, nextClock),
              end: new dbtypes.CollectionKey(owner, collection, number.HIGHEST_UINT32),
              limit: 3000
            }).then(colEntries => _updateOpClocksHelper(ystream, colEntries))
            : await tr.tables.oplog.getEntries({
              start: new isodb.AutoKey(nextClock),
              limit: 3000
            }).then(colEntries => colEntries.map(update => {
              update.value.localClock = update.key.v
              if (update.value.client === ystream.clientid) {
                update.value.clock = update.key.v
              }
              return update.value
            }))
          if (ops.length > 0) {
            nextClock = ops[ops.length - 1].localClock + 1
          }
          if (ops.length === 0) {
            nextClock = math.max(ystream._eclock || 0, nextClock)
            console.log('sending synced step')
            controller.enqueue({
              messages: [
                encoding.encode(encoder => {
                  if (owner != null && collection != null) {
                    protocol.writeSynced(encoder, owner, collection, nextClock)
                  } else {
                    protocol.writeSyncedAll(encoder, nextClock)
                  }
                })
              ],
              origin: 'db'
            })
            registeredListener = true
            ystream.on('ops', /** @type {(ops: Array<dbtypes.OpValue>) => void} */ (listener))
            break
          }
          while (ops.length > 0) {
            controller.enqueue({ messages: ops.splice(0, 1000), origin: 'db' })
          }
        } while ((controller.desiredSize || 0) > 0)
      })
    },
    cancel (_reason) {
      ystream.off('ops', /** @type {(ops: Array<dbtypes.OpValue>) => void} */ (listener))
    }
  }, {
    highWaterMark: 200,
    size (message) {
      return message.messages.length
    }
  })
  return stream
}

/**
 * @param {Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 */
export const getUnsyncedDocs = (ystream, owner, collection) => ystream.childTransaction(async tr => {
  const ud = await tr.tables.unsyncedDocs.getKeys({ start: new dbtypes.UnsyncedKey(owner, collection, ''), end: new dbtypes.UnsyncedKey(owner, collection, null) })
  const ds = await promise.all(ud.map(async u => {
    const np = await getDocOpsLast(ystream, owner, collection, /** @type {string} */ (u.doc), operations.OpNoPermissionType)
    if (np == null) {
      await tr.tables.unsyncedDocs.remove(u)
    }
    return np
  }))
  return /** @type {Array<dbtypes.OpValue<operations.OpNoPermission>>} */ (ds.filter(d => d !== null))
})

/**
 * @template {operations.OpTypes|operations.AbstractOp} OP
 * @template {{ value: dbtypes.OpValue<OP>, fkey: import('isodb').AutoKey }} UPDATE
 * @param {Ystream} ystream
 * @param {Array<UPDATE>} updates
 * @return {Array<UPDATE["value"]>}
 */
const _updateOpClocksHelper = (ystream, updates) => updates.map(update => {
  update.value.localClock = update.fkey.v
  if (update.value.client === ystream.clientid) {
    update.value.clock = update.fkey.v
  }
  return update.value
})

/**
 * @template {operations.OpTypeIds} TYPE
 * @param {Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @param {TYPE} type
 * @param {number} startLocalClock
 * @param {number} endLocalClock
 * @return {Promise<Array<dbtypes.OpValue<InstanceType<operations.typeMap[TYPE]>>>>}
 */
export const getDocOps = async (ystream, owner, collection, doc, type, startLocalClock = 0, endLocalClock = number.HIGHEST_UINT32) => {
  const entries = await ystream.childTransaction(tr =>
    tr.tables.oplog.indexes.doc.getEntries({
      start: new dbtypes.DocKey(type, owner, collection, doc, startLocalClock),
      end: new dbtypes.DocKey(type, owner, collection, doc, endLocalClock)
    })
  )
  return /** @type {Array<dbtypes.OpValue<InstanceType<operations.typeMap[TYPE]>>>} */ (_updateOpClocksHelper(ystream, entries))
}

/**
 * @template {operations.OpTypeIds} TYPE
 * @param {Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @param {TYPE} type
 * @return {Promise<dbtypes.OpValue<InstanceType<operations.typeMap[TYPE]>>|null>}
 */
export const getDocOpsLast = async (ystream, owner, collection, doc, type) => {
  const entries = await ystream.childTransaction(tr =>
    tr.tables.oplog.indexes.doc.getEntries({
      start: new dbtypes.DocKey(type, owner, collection, doc, 0),
      end: new dbtypes.DocKey(type, owner, collection, doc, number.HIGHEST_UINT32),
      limit: 1,
      reverse: true
    })
  )
  return /** @type {dbtypes.OpValue<InstanceType<operations.typeMap[TYPE]>>} */ (_updateOpClocksHelper(ystream, entries)[0]) || null
}

/**
 * @template {operations.OpTypeIds} TYPE
 * @param {Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @param {TYPE} type
 * @param {number} [startLocalClock]
 * @param {number} [endLocalClock]
 * @return {Promise<dbtypes.OpValue<InstanceType<operations.typeMap[TYPE]>>|null>}
 */
export const getDocOpsMerged = async (ystream, owner, collection, doc, type, startLocalClock, endLocalClock) => {
  const [
    ops,
    docDeleted
  ] = await promise.all([
    getDocOps(ystream, owner, collection, doc, type, startLocalClock, endLocalClock),
    type === operations.OpDeleteDocType ? false : isDocDeleted(ystream, owner, collection, doc, endLocalClock)
  ])
  return docDeleted ? null : utils.merge(ops, false)
}

/**
 * @param {Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} docid
 * @param {number} [endLocalClock]
 */
export const isDocDeleted = async (ystream, owner, collection, docid, endLocalClock) => {
  const op = await mergeDocOps(ystream, owner, collection, docid, operations.OpDeleteDocType, endLocalClock)
  return op != null
}

/**
 * @param {Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} docid
 */
export const deleteDoc = (ystream, owner, collection, docid) => ystream.childTransaction(async _tr => {
  const isDeleted = await isDocDeleted(ystream, owner, collection, docid)
  if (!isDeleted) {
    const children = await getDocChildren(ystream, owner, collection, docid)
    await promise.all(children.map(child => deleteDoc(ystream, owner, collection, child.docid)))
    await addOp(ystream, owner, collection, docid, new operations.OpDeleteDoc())
  }
})

/**
 * @param {Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} parent
 * @return {Promise<Array<{ docid: string, docname: string }>>}
 */
export const getDocChildren = async (ystream, owner, collection, parent) => {
  const entries = await ystream.childTransaction(tr =>
    tr.tables.childDocs.getEntries({
      prefix: { owner, collection, parent }
    })
  )
  return entries.map(({ key, value }) => ({ docname: key.childname, docid: value.v }))
}

/**
 * @typedef {{ docname: string, docid: string, children: Array<ParentChildMapping> }} ParentChildMapping
 */

/**
 * @param {Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} parentid
 * @return {Promise<Array<ParentChildMapping>>}
 */
export const getDocChildrenRecursive = (ystream, owner, collection, parentid) => ystream.childTransaction(async tr => {
  const childrenOps = await tr.tables.childDocs.getEntries({
    prefix: { owner, collection, parent: parentid }
  })
  /**
   * @type {Array<ParentChildMapping>}
   */
  const cmap = await promise.all(childrenOps.map(async child => ({
    docid: child.value.v,
    docname: child.key.childname,
    children: await getDocChildrenRecursive(ystream, owner, collection, child.value.v)
  })))
  return cmap
})

/**
 * @param {Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} rootid
 * @param {Array<string>} path
 * @return {Promise<Array<string>>}
 */
export const getDocIdsFromPath = (ystream, owner, collection, rootid, path) => ystream.childTransaction(async tr => {
  if (path.length === 0) return []
  const children = await tr.tables.childDocs.getValues({ prefix: { owner, collection, parent: rootid, docname: path[0] } })
  if (path.length === 1) return children.map(c => c.v)
  return promise.all(children.map(child => getDocIdsFromPath(ystream, owner, collection, child.v, path.slice(1)))).then(res => res.flat(1))
})

/**
 * @param {Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} childid
 * @param {string|null} parentDoc
 * @param {string} childname
 * @return {Promise<void>}
 */
export const setDocParent = (ystream, owner, collection, childid, parentDoc, childname) => ystream.childTransaction(async _tr => {
  if (parentDoc === undefined) throw new Error('parentDoc must not be undefined') // @todo remove!
  const co = await getDocOpsMerged(ystream, owner, collection, childid, operations.OpChildOfType)
  await addOp(ystream, owner, collection, childid, new operations.OpChildOf(co?.op.cnt || 0, parentDoc, childname))
})

/**
 * @param {Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} key
 * @param {any} val
 * @return {Promise<void>}
 */
export const setLww = (ystream, owner, collection, key, val) => ystream.childTransaction(async _tr => {
  const lww = await getDocOpsMerged(ystream, owner, collection, key, operations.OpLwwType)
  await addOp(ystream, owner, collection, key, new operations.OpLww(1 + (lww?.op.cnt || 0), val))
  return lww === null ? undefined : lww.op.val
})

/**
 * @param {Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} key
 * @return {Promise<void>}
 */
export const getLww = (ystream, owner, collection, key) => ystream.childTransaction(async _tr => {
  const lww = await getDocOpsMerged(ystream, owner, collection, key, operations.OpLwwType)
  return lww === null ? undefined : lww.op.val
})

/**
 * @param {Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @param {number} [endLocalClock]
 * @return {Promise<Array<{ docid: string, docname: string | null }>>}
 */
export const getDocPath = (ystream, owner, collection, doc, endLocalClock) => ystream.childTransaction(async _tr => { // exec in a single db transaction
  /**
   * @type {string | null}
   */
  let currDoc = doc
  /**
   * @type {Array<{ docid: string, docname: string | null }>}
   */
  const path = []
  while (currDoc != null) {
    /**
     * @type {dbtypes.OpValue<operations.OpChildOf> | null}
     */
    const parentOp = await getDocOpsMerged(ystream, owner, collection, currDoc, operations.OpChildOfType, 0, endLocalClock)
    path.unshift({ docid: currDoc, docname: parentOp?.op.childname || null })
    currDoc = parentOp?.op.parent || null
  }
  return path
})

/**
 * @template {operations.OpTypeIds} TYPEID
 * @template {InstanceType<operations.typeMap[TYPEID]>} TYPE
 * @param {Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @param {TYPEID} type
 * @param {number} [endLocalClock]
 * @return {Promise<dbtypes.OpValue<TYPE>|null>}
 */
export const mergeDocOps = (ystream, owner, collection, doc, type, endLocalClock) =>
  ystream.childTransaction(async tr => {
    const [
      allOps,
      docDeleted
    ] = await promise.all([
      /** @type {Promise<Array<dbtypes.OpValue<TYPE>>>} */ (getDocOps(ystream, owner, collection, doc, type, 0, endLocalClock)),
      type === operations.OpDeleteDocType ? false : isDocDeleted(ystream, owner, collection, doc, endLocalClock)
    ])
    if (allOps.length === 0) return null
    const mergedOp = docDeleted ? null : utils.merge(allOps, true)
    const opsToDelete = mergedOp === null ? allOps : allOps.filter(op => mergedOp.client !== op.client || mergedOp.clock !== op.clock)
    await promise.all(opsToDelete.map(/** @return {Promise<any>} */ op =>
      promise.all([op.op.unintegrate(ystream, tr, /** @type {any} */ (op)), tr.tables.oplog.remove(op.localClock)])
    ))
    return mergedOp
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
 * @param {Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 * @return {Promise<Array<dbtypes.DocKey>>}
 */
export const getNoPerms = async (ystream, owner, collection) =>
  ystream.childTransaction(tr =>
    tr.tables.oplog.indexes.doc.getKeys({ prefix: { type: operations.OpNoPermissionType, owner, collection } })
      .then(ks => filterDuplicateNoPermIndexes(ks || []))
  )

/**
 * @param {Ystream} ystream
 * @param {number} clientid
 * @param {Uint8Array?} owner
 * @param {string?} collection
 */
export const getClock = async (ystream, clientid, owner, collection) =>
  ystream.childTransaction(async tr => {
    if (ystream.clientid === clientid) {
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
 * Retrieve all clientid<>confirmed_clock pairs for a specific collection
 *
 * Generally, it is discouraged to use this function. Usually, there is no need to do a full state
 * comparison. However, this can be useful for writing tests.
 *
 * @param {Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 */
export const getStateVector = async (ystream, owner, collection) =>
  ystream.childTransaction(async tr => {
    const entries = await tr.tables.clocks.getEntries({ prefix: { owner, collection } })
    return entries.map(({ key: client, value: clockDef }) => {
      return { client: client.clientid, clock: clockDef.clock }
    })
  })

/**
 * Confirm that a all updates of a doc/collection/* from a client have been received.
 *
 * @param {Ystream} ystream
 * @param {number} clientid
 * @param {Uint8Array?} owner
 * @param {string?} collection
 * @param {number} newClock
 * @param {number} localClock
 */
export const confirmClientClock = async (ystream, clientid, owner, collection, newClock, localClock) => {
  ystream.childTransaction(async tr => {
    const currClock = await getClock(ystream, clientid, owner, collection)
    if (currClock < newClock) {
      tr.tables.clocks.set(new dbtypes.ClocksKey(clientid, owner, collection), new dbtypes.ClientClockValue(newClock, localClock))
    }
  })
}

/**
 * @param {Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @param {operations.OpTypes} opv
 */
export const addOp = async (ystream, owner, collection, doc, opv) => {
  const op = await ystream.childTransaction(async tr => {
    const op = new dbtypes.OpValue(ystream.clientid, 0, owner, collection, doc, opv)
    const key = await tr.tables.oplog.add(op)
    op.clock = key.v
    op.localClock = key.v
    tr.tables.clocks.set(new dbtypes.ClocksKey(op.client, owner, collection), new dbtypes.ClientClockValue(op.clock, op.clock))
    await opv.integrate(ystream, tr, op)
    return op
  })
  emitOpsEvent(ystream, [op], ystream)
}

/**
 * @param {Ystream} ystream
 */
export const getClocks = ystream =>
  ystream.childTransaction(async tr => {
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
        cls.set(ystream.clientid, new dbtypes.ClientClockValue(lastKey[0].v, lastKey[0].v))
      })
    }
    return collectionClocks
  })

/**
 * @param {Ystream} ystream
 * @param {Array<dbtypes.OpValue>} ops
 * @param {dbtypes.UserIdentity} user
 * @param {any} origin
 */
export const applyRemoteOps = async (ystream, ops, user, origin) => {
  /**
   * @type {Array<dbtypes.OpValue<any>>}
   */
  const filteredOpsPermsChecked = []
  await ystream.transact(async tr => {
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
      const clock = await getClock(ystream, op.client, op.owner, op.collection)
      clock > 0 && clocks.set(encodeClocksKey(op.client, op.owner, op.collection), clock)
    }))
    /**
     * @type {Map<string,dbtypes.ClientClockValue>}
     */
    const clientClockEntries = new Map()
    const filteredOps = ops.filter(op => op.client !== ystream.clientid && op.clock > (clocks.get(encodeClocksKey(op.client, op.owner, op.collection)) || -1))
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
          const hasCollectionAccess = await authorization.hasWriteAccess(ystream, owner, collectionName, '*', user)
          if (hasCollectionAccess) {
            docs.set('*', true)
          } else {
            await promise.all(array.from(docs.keys()).map(
              docName => authorization.hasWriteAccess(ystream, owner, collectionName, docName, user).then(hasWriteAccess => docs.set(docName, hasWriteAccess))
            ))
          }
        }))
      }
    }))
    // 1. Filter ops that have already been applied 2. apply ops 3. update clocks table
    for (let i = 0; i < filteredOps.length; i++) {
      const op = filteredOps[i]
      const colperms = permissions.get(buffer.toBase64(op.owner))?.get(op.collection)
      if (colperms?.get('*') || colperms?.get(op.doc)) {
        const localClock = await tr.tables.oplog.add(op)
        op.localClock = localClock.v
        await op.op.integrate(ystream, tr, op)
        clientClockEntries.set(encodeClocksKey(op.client, op.owner, op.collection), new dbtypes.ClientClockValue(op.clock, op.localClock))
        filteredOpsPermsChecked.push(op)
      } else {
        console.log('Not applying op because of missing permission', op, ystream.syncsEverything, user.hash, user.isTrusted)
      }
    }
    clientClockEntries.forEach((clockValue, encClocksKey) => {
      const clocksKey = dbtypes.ClocksKey.decode(decoding.createDecoder(buffer.fromBase64(encClocksKey)))
      tr.tables.clocks.set(clocksKey, clockValue)
    })
  })
  emitOpsEvent(ystream, filteredOpsPermsChecked, origin)
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
      const docs = ystream.collections.get(owner)?.get(colname)?.docs
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
              const bcroom = `ystream#${ystream.dbname}#${owner}#${colname}#${docname}`
              bc.publish(bcroom, buffer.toBase64(mergedUpdate), ystream)
            }
            /* c8 ignore end */
          }
        })
      }
    })
  })
}
