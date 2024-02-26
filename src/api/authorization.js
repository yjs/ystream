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
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @param {dbtypes.UserIdentity} user
 * @param {operations.AccessType} accessType
 */
export const updateCollaborator = async (ydb, owner, collection, doc, user, accessType) => {
  const currentPermOp = await actions.getDocOpsMerged(ydb, owner, collection, doc, operations.OpPermType)
  const op = operations.createOpPermUpdate(currentPermOp?.op || null, buffer.toBase64(user.hash), accessType)
  actions.addOp(ydb, owner, collection, doc, op)
}

/**
 * @param {Ydb} ydb
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @return {Promise<operations.OpPerm>} accessType
 */
export const getPermOp = async (ydb, owner, collection, doc) =>
  actions.getDocOpsMerged(ydb, owner, collection, doc, operations.OpPermType).then(opperm => opperm?.op || new operations.OpPerm())

/**
 * @param {Ydb} ydb
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @param {function(operations.OpPerm):boolean} checker
 */
const _checkStreamAccess = (ydb, owner, collection, doc, checker) => getPermOp(ydb, owner, collection, doc).then(checker)

/**
 * @param {Ydb} ydb
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @param {function(operations.OpPerm):boolean} checker
 */
const checkAccess = async (ydb, owner, collection, doc, checker) => {
  const hasAccessStream = await _checkStreamAccess(ydb, owner, collection, '*', checker)
  if (hasAccessStream) return hasAccessStream
  return await _checkStreamAccess(ydb, owner, collection, doc, checker)
}

/**
 * @param {Ydb} ydb
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @param {dbtypes.UserIdentity} user
 */
export const hasReadAccess = async (ydb, owner, collection, doc, user) => user.isTrusted ? promise.resolveWith(true) : checkAccess(ydb, owner, collection, doc, opperm => opperm.hasReadAccess(buffer.toBase64(user.hash)))

/**
 * @param {Ydb} ydb
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @param {dbtypes.UserIdentity} user
 */
export const hasWriteAccess = async (ydb, owner, collection, doc, user) => user.isTrusted ? promise.resolveWith(true) : checkAccess(ydb, owner, collection, doc, opperm => opperm.hasWriteAccess(buffer.toBase64(user.hash)))
