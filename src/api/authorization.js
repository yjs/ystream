import * as dbtypes from '../dbtypes.js' // eslint-disable-line
import * as actions from '../actions.js'
import * as operations from '../operations.js'
import * as buffer from 'lib0/buffer'

/**
 * @typedef {import('../ydb.js').Ydb} Ydb
 */

/**
 * @param {Ydb} ydb
 * @param {string} collection
 * @param {string} doc
 * @param {dbtypes.UserIdentity} user
 * @param {operations.AccessType} accessType
 */
export const updateCollaborator = async (ydb, collection, doc, user, accessType) => {
  const currentPermOp = await actions.getDocOpsMerged(ydb, collection, doc, operations.OpPermType)
  const op = operations.createOpPermUpdate(currentPermOp?.op || null, buffer.toBase64(user.hash), accessType)
  actions.addOp(ydb, collection, doc, op)
}

/**
 * @param {Ydb} ydb
 * @param {string} collection
 * @param {string} doc
 * @return {Promise<operations.OpPerm>} accessType
 */
export const getPermOp = async (ydb, collection, doc) =>
  actions.getDocOpsMerged(ydb, collection, doc, operations.OpPermType).then(opperm => opperm?.op || new operations.OpPerm())

/**
 * @param {Ydb} ydb
 * @param {string} collection
 * @param {string} doc
 * @param {dbtypes.UserIdentity} user
 */
export const hasReadAccess = async (ydb, collection, doc, user) => getPermOp(ydb, collection, doc).then(opperm => opperm.hasReadAccess(buffer.toBase64(user.hash)))

/**
 * @param {Ydb} ydb
 * @param {string} collection
 * @param {string} doc
 * @param {dbtypes.UserIdentity} user
 */
export const hasWriteAccess = async (ydb, collection, doc, user) => getPermOp(ydb, collection, doc).then(opperm => opperm.hasWriteAccess(buffer.toBase64(user.hash)))
