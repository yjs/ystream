import * as map from 'lib0/map'
import * as Y from 'yjs'
import { OpValue, YjsOp } from './ops.js'

/**
 * Merges ops on the same collection & doc
 *
 * @param {Array<OpValue>} ops
 * @param {boolean} gc
 */
const _mergeOpsHelper = (ops, gc) => {
  if (gc) {
    const ydoc = new Y.Doc()
    ydoc.transact(() => {
      ops.forEach(op => {
        Y.applyUpdateV2(ydoc, op.op.update)
      })
    })
    return Y.encodeStateAsUpdateV2(ydoc)
  } else {
    return Y.mergeUpdatesV2(ops.map(op => op.op.update))
  }
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
    map.setIfUndefined(map.setIfUndefined(collections, op.collection, map.create), op.doc, () => []).push(op)
  }
  /**
   * @type {Array<OpValue>}
   */
  const mergedOps = []
  collections.forEach(docs => {
    docs.forEach(docops => {
      const { client, clock, collection, doc } = docops[0]
      const mergedUpdate = _mergeOpsHelper(ops, gc)
      mergedOps.push(new OpValue(client, clock, collection, doc, new YjsOp(mergedUpdate)))
    })
  })
  return mergedOps.reverse()
}
