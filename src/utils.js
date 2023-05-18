import * as map from 'lib0/map'
import * as Y from 'yjs'
import * as dbtypes from './dbtypes.js' // eslint-disable-line
import * as array from 'lib0/array'

/**
 * Merges ops on the same collection & doc
 *
 * @param {Array<dbtypes.OpValue>} ops
 * @param {boolean} gc
 */
const _mergeOpsHelper = (ops, gc) => {
  /**
   * @type {Map<number,Array<dbtypes.OpValue>>}
   */
  const opsSortedByType = map.create()
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i]
    map.setIfUndefined(opsSortedByType, op.op.type, array.create).push(op)
  }
  /**
   * @type {Array<dbtypes.OpValue>}
   */
  const mergedOps = []
  opsSortedByType.forEach((sops, type) => { mergedOps.push(dbtypes.optypeToConstructor(type).merge(sops, gc)) })
  return mergedOps
}

/**
 * @param {Array<dbtypes.OpValue>} ops
 * @param {boolean} gc
 * @return {Array<dbtypes.OpValue>}
 */
export const mergeOps = (ops, gc) => {
  /**
   * @type {Map<string, Map<string, Array<dbtypes.OpValue>>>}
   */
  const collections = new Map()
  // Iterate from right to left so we add the "latest" ops first to the collection.
  // Then, when we generate the merged updates (based on the collections map), the ops are already in order
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i]
    map.setIfUndefined(map.setIfUndefined(collections, op.collection, map.create), op.doc, array.create).push(op)
  }
  /**
   * @type {Array<dbtypes.OpValue>}
   */
  const mergedOps = []
  collections.forEach(docs => {
    docs.forEach(docops => {
      mergedOps.push(..._mergeOpsHelper(docops, gc))
    })
  })
  return mergedOps.reverse().sort((a, b) => a.clock - b.clock)
}

/**
 * @param {Array<dbtypes.OpValue>} ops
 */
export const filterYjsUpdateOps = ops =>
  /** @type {Array<dbtypes.OpValue<dbtypes.OpYjsUpdate>>} */ (ops.filter(op => op.op.type === dbtypes.OpYjsUpdateType))

/**
 * @param {Array<dbtypes.OpValue>} ops
 */
export const mergeYjsUpdateOps = ops =>
  Y.mergeUpdatesV2(filterYjsUpdateOps(ops).map(op => op.op.update))
