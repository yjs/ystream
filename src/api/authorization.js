import * as dbtypes from '../dbtypes.js' // eslint-disable-line
import * as actions from '../actions.js'
import * as operations from '../operations.js'
import * as buffer from 'lib0/buffer'
import * as promise from 'lib0/promise'

/**
 * @typedef {import('../ystream.js').Ystream} Ystream
 */

/**
 * @param {Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @param {dbtypes.UserIdentity} user
 * @param {operations.AccessType} accessType
 */
export const updateCollaborator = async (ystream, owner, collection, doc, user, accessType) => {
  const currentPermOp = await actions.getDocOpsMerged(ystream, owner, collection, doc, operations.OpPermType)
  const op = operations.createOpPermUpdate(currentPermOp?.op || null, buffer.toBase64(user.hash), accessType)
  actions.addOp(ystream, owner, collection, doc, op)
}

/**
 * @param {Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @return {Promise<operations.OpPerm>} accessType
 */
export const getPermOp = async (ystream, owner, collection, doc) =>
  actions.getDocOpsMerged(ystream, owner, collection, doc, operations.OpPermType).then(opperm => opperm?.op || new operations.OpPerm())

/**
 * @param {Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @param {function(operations.OpPerm):boolean} checker
 */
const _checkStreamAccess = (ystream, owner, collection, doc, checker) => getPermOp(ystream, owner, collection, doc).then(checker)

/**
 * @param {Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @param {function(operations.OpPerm):boolean} checker
 */
const checkAccess = async (ystream, owner, collection, doc, checker) => {
  const hasAccessStream = await _checkStreamAccess(ystream, owner, collection, '*', checker)
  if (hasAccessStream) return hasAccessStream
  return await _checkStreamAccess(ystream, owner, collection, doc, checker)
}

/**
 * @param {Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @param {dbtypes.UserIdentity} user
 */
export const hasReadAccess = async (ystream, owner, collection, doc, user) => user.isTrusted ? promise.resolveWith(true) : checkAccess(ystream, owner, collection, doc, opperm => opperm.hasReadAccess(buffer.toBase64(user.hash)))

/**
 * @param {Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @param {dbtypes.UserIdentity} user
 */
export const hasWriteAccess = async (ystream, owner, collection, doc, user) => user.isTrusted ? promise.resolveWith(true) : checkAccess(ystream, owner, collection, doc, opperm => opperm.hasWriteAccess(buffer.toBase64(user.hash)))
