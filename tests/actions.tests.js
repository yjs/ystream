import * as t from 'lib0/testing'
import * as utils from '../src/utils.js'
import * as operations from '../src/operations.js'
import * as dbtypes from '../src/dbtypes.js'
import { emptyUpdate } from './helpers.js'

const testOwner = new Uint8Array([1, 2, 3])

/**
 * @param {t.TestCase} _tc
 */
export const testMergeOps = (_tc) => {
  const ops = [
    new dbtypes.OpValue(0, 0, testOwner, 'c1', 'd1', new operations.OpYjsUpdate(emptyUpdate)),
    new dbtypes.OpValue(1, 3, testOwner, 'c1', 'd1', new operations.OpYjsUpdate(emptyUpdate)),
    new dbtypes.OpValue(0, 1, testOwner, 'c1', 'd1', new operations.OpYjsUpdate(emptyUpdate)),
    new dbtypes.OpValue(0, 2, testOwner, 'c2', 'd1', new operations.OpYjsUpdate(emptyUpdate))
  ]
  const merged = utils.mergeOps(ops, false)
  t.assert(merged.length === 2)
  t.assert(merged[0].client === 0)
  t.assert(merged[0].clock === 1)
  t.compare(merged[0].op.update, emptyUpdate)
  t.assert(merged[1].client === 0)
  t.assert(merged[1].clock === 2)
  t.compare(merged[1].op.update, emptyUpdate)
}
