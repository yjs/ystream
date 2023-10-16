import * as t from 'lib0/testing'
import * as utils from '../src/utils.js'
import * as actions from '../src/actions.js'
import * as operations from '../src/operations.js'
import * as dbtypes from '../src/dbtypes.js'
import { emptyUpdate, createTestScenario, getDbName } from './helpers.js'
import * as D from '../src/index.js'

/**
 * @param {t.TestCase} tc
 */
export const testBasic = async tc => {
  const ydb1 = await D.openYdb(getDbName(tc), [])
  actions.addOp(ydb1, 'collection', 'docname', new operations.OpYjsUpdate(emptyUpdate))
  actions.addOp(ydb1, 'collection', 'docname', new operations.OpYjsUpdate(emptyUpdate))
  actions.addOp(ydb1, 'collection', 'docname', new operations.OpYjsUpdate(emptyUpdate))
  actions.addOp(ydb1, 'collection2', 'docname', new operations.OpYjsUpdate(emptyUpdate))
  actions.addOp(ydb1, 'collection', 'docname2', new operations.OpYjsUpdate(emptyUpdate))
  const docOps = await actions.getDocOps(ydb1, 'collection', 'docname', operations.OpYjsUpdateType, 0)
  t.assert(docOps.length === 3)
  const allOps = await actions.getOps(ydb1, 0)
  t.assert(allOps.length === 3) // because doc ops are merged
  const collectionOps = await actions.getCollectionOps(ydb1, 'collection', 0)
  t.assert(collectionOps.length === 2)
}

/**
 * @param {t.TestCase} _tc
 */
export const testMergeOps = (_tc) => {
  const ops = [
    new dbtypes.OpValue(0, 0, 'c1', 'd1', new operations.OpYjsUpdate(emptyUpdate)),
    new dbtypes.OpValue(1, 3, 'c1', 'd1', new operations.OpYjsUpdate(emptyUpdate)),
    new dbtypes.OpValue(0, 1, 'c1', 'd1', new operations.OpYjsUpdate(emptyUpdate)),
    new dbtypes.OpValue(0, 2, 'c2', 'd1', new operations.OpYjsUpdate(emptyUpdate))
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
