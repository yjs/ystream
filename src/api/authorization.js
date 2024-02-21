import * as dbtypes from '../dbtypes.js' // eslint-disable-line
import * as actions from '../actions.js'
import * as operations from '../operations.js'
import * as buffer from 'lib0/buffer'
import * as promise from 'lib0/promise'

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
 * @param {function(operations.OpPerm):boolean} checker
 */
const _checkStreamAccess = (ydb, collection, doc, checker) => getPermOp(ydb, collection, doc).then(checker)

/**
 * @param {Ydb} ydb
 * @param {string} collection
 * @param {string} doc
 * @param {function(operations.OpPerm):boolean} checker
 */
const checkAccess = async (ydb, collection, doc, checker) => {
  const hasAccessStream = await _checkStreamAccess(ydb, collection, '*', checker)
  if (hasAccessStream) return hasAccessStream
  return await _checkStreamAccess(ydb, collection, doc, checker)
}

/**
 * @param {Ydb} ydb
 * @param {string} collection
 * @param {string} doc
 * @param {dbtypes.UserIdentity} user
 */
export const hasReadAccess = async (ydb, collection, doc, user) => user.isTrusted ? promise.resolveWith(true) : checkAccess(ydb, collection, doc, opperm => opperm.hasReadAccess(buffer.toBase64(user.hash)))

/**
 * @param {Ydb} ydb
 * @param {string} collection
 * @param {string} doc
 * @param {dbtypes.UserIdentity} user
 */
export const hasWriteAccess = async (ydb, collection, doc, user) => user.isTrusted ? promise.resolveWith(true) : checkAccess(ydb, collection, doc, opperm => opperm.hasWriteAccess(buffer.toBase64(user.hash)))
