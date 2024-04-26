import * as map from 'lib0/map'
import * as Y from 'yjs'
import * as dbtypes from './dbtypes.js' // eslint-disable-line
import * as operations from './operations.js'
import * as array from 'lib0/array'
import * as buffer from 'lib0/buffer'

/**
 * Merges ops on the same collection & doc
 *
 * @template {operations.OpTypes} OP
 * @param {Array<dbtypes.OpValue<OP>>} ops
 * @param {boolean} gc
 * @return {Array<dbtypes.OpValue<OP>>}
 */
const _mergeOpsHelper = (ops, gc) => {
  /**
   * @type {Map<operations.OpTypeIds,Array<dbtypes.OpValue>>}
   */
  const opsSortedByType = map.create()
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i]
    map.setIfUndefined(opsSortedByType, op.op.type, array.create).push(op)
  }
  /**
   * @type {Array<dbtypes.OpValue<any>>}
   */
  const mergedOps = []
  opsSortedByType.forEach((sops, type) => { mergedOps.push(/** @type {typeof operations.AbstractOp} */ (operations.typeMap[type]).merge(sops, gc)) })
  return mergedOps
}

/**
 * @deprecated - remove this
 * @template {operations.OpTypes} OP
 * @param {Array<dbtypes.OpValue<OP>>} ops
 * @param {boolean} gc
 * @return {Array<dbtypes.OpValue<OP>>}
 */
export const mergeOps = (ops, gc) => {
  /**
   * @type {Map<string, Map<string, Array<dbtypes.OpValue<OP>>>>}
   */
  const collections = new Map()
  // Iterate from right to left so we add the "latest" ops first to the collection.
  // Then, when we generate the merged updates (based on the collections map), the ops are already in order
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i]
    map.setIfUndefined(map.setIfUndefined(collections, op.collection, map.create), op.doc, array.create).push(op)
  }
  /**
   * @type {Array<dbtypes.OpValue<OP>>}
   */
  const mergedOps = []
  collections.forEach(docs => {
    docs.forEach(docops => {
      mergedOps.push(..._mergeOpsHelper(docops, gc))
    })
  })
  return mergedOps.reverse().sort((a, b) => a.localClock - b.localClock)
}

/**
 * @template {operations.OpTypes|operations.AbstractOp} OP
 * @param {Array<dbtypes.OpValue<OP>>} ops
 * @param {boolean} gc
 * @return {dbtypes.OpValue<OP>|null}
 */
export const merge = (ops, gc) => {
  if (ops.length === 0) return null
  return /** @type {dbtypes.OpValue<OP>} */ (
    /** @type {typeof operations.AbstractOp} */ (operations.typeMap[ops[0].op.type]).merge(ops, gc)
  )
}

/**
 * @param {Array<dbtypes.OpValue>} ops
 */
export const filterYjsUpdateOps = ops =>
  /** @type {Array<dbtypes.OpValue<operations.OpYjsUpdate>>} */ (ops.filter(op => op.op.type === operations.OpYjsUpdateType))

/**
 * @param {Array<dbtypes.OpValue>} ops
 */
export const mergeYjsUpdateOps = ops =>
  Y.mergeUpdatesV2(filterYjsUpdateOps(ops).map(op => op.op.update))

/**
 * Registry for adding owner/collection pairs and checking whether they have been added.
 */
export class CollectionsSet {
  constructor () {
    /**
     * @type {Map<string,Set<string>>}
     */
    this.owners = new Map()
  }

  clear () {
    this.owners.clear()
  }

  /**
   * @param {Uint8Array} owner
   * @param {string} collection
   */
  add (owner, collection) {
    map.setIfUndefined(this.owners, buffer.toBase64(owner), () => new Set()).add(collection)
  }

  /**
   * @param {string} owner
   * @param {string} collection
   * @return {boolean}
   */
  has (owner, collection) {
    return this.owners.get(owner)?.has(collection) === true
  }
}
