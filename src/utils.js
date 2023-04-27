import * as map from 'lib0/map'
import * as Y from 'yjs'
import { OpValue, YjsOp } from './dbtypes.js' // eslint-disable-line

/**
 * Merges ops on the same collection & doc
 *
 * @param {Array<OpValue>} ops
 * @param {boolean} gc
 */
const _mergeOpsHelper = (ops, gc) => {
  /**
   * @type {Array<OpValue>}
   */
  const yjsOps = []
  /**
   * @type {Array<OpValue>}
   */
  const restOps = []
  ops.forEach(op => {
    if (op.op.constructor === YjsOp) {
      yjsOps.push(op)
    /* c8 ignore next 3 */
    } else {
      restOps.push(op)
    }
  })
  /* c8 ignore next 3 */
  if (yjsOps.length === 0) {
    return restOps
  }
  const yop = yjsOps[0]
  restOps.push(yop)
  if (gc) {
    const ydoc = new Y.Doc()
    ydoc.transact(() => {
      // Apply in reverse because we expect updates in reverse order
      for (let i = ops.length - 1; i >= 0; i--) {
        Y.applyUpdateV2(ydoc, ops[i].op.update)
      }
    })
    yop.op.update = Y.encodeStateAsUpdateV2(ydoc)
  } else {
    yop.op.update = Y.mergeUpdatesV2(ops.map(op => op.op.update))
  }
  return restOps
}

/**
 * @param {Array<OpValue>} ops
 * @param {boolean} gc
 * @return {Array<OpValue>}
 */
export const mergeOps = (ops, gc) => {
  /**
   * @type {Map<string, Map<string, Array<OpValue>>>}
   */
  const collections = new Map()
  // Iterate from right to left so we add the "latest" ops first to the collection.
  // Then, when we generate the merged updates (based on the collections map), the ops are already in order
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i]
    map.setIfUndefined(map.setIfUndefined(collections, op.collection, map.create), op.doc, () => /** @type {Array<OpValue>} */ ([])).push(op)
  }
  /**
   * @type {Array<OpValue>}
   */
  const mergedOps = []
  collections.forEach(docs => {
    docs.forEach(docops => {
      mergedOps.push(..._mergeOpsHelper(docops, gc))
    })
  })
  return mergedOps.reverse().sort((a, b) => a.clock - b.clock)
}
