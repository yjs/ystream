import * as dbtypes from '../api/dbtypes.js' // eslint-disable-line
import * as actions from '../api/actions.js'
import * as operations from '../operations.js'
import * as buffer from 'lib0/buffer'
import * as promise from 'lib0/promise'

/**
 * @typedef {import('../ystream.js').Ystream} Ystream
 */

/**
 * @param {import('isodb').ITransaction<typeof import('../db.js').def>} tr
 * @param {Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @param {dbtypes.UserIdentity} user
 * @param {operations.AccessType} accessType
 */
export const updateCollaborator = async (tr, ystream, owner, collection, doc, user, accessType) => {
  const currentPermOp = await actions.getDocOpsMerged(tr, ystream, owner, collection, doc, operations.OpPermType)
  const op = operations.createOpPermUpdate(currentPermOp?.op || null, buffer.toBase64(user.hash), accessType)
  actions.addOp(tr, ystream, owner, collection, doc, op)
}

/**
 * @param {import('isodb').ITransaction<typeof import('../db.js').def>} tr
 * @param {Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @return {Promise<operations.OpPerm>} accessType
 */
export const getPermOp = async (tr, ystream, owner, collection, doc) =>
  actions.getDocOpsMerged(tr, ystream, owner, collection, doc, operations.OpPermType).then(opperm => opperm?.op || new operations.OpPerm())

/**
 * @param {import('isodb').ITransaction<typeof import('../db.js').def>} tr
 * @param {Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @param {function(operations.OpPerm):boolean} checker
 */
const _checkStreamAccess = (tr, ystream, owner, collection, doc, checker) => getPermOp(tr, ystream, owner, collection, doc).then(checker)

/**
 * @param {import('isodb').ITransaction<typeof import('../db.js').def>} tr
 * @param {Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @param {function(operations.OpPerm):boolean} checker
 */
const checkAccess = async (tr, ystream, owner, collection, doc, checker) => {
  const hasAccessStream = await _checkStreamAccess(tr, ystream, owner, collection, '*', checker)
  if (hasAccessStream) return hasAccessStream
  return await _checkStreamAccess(tr, ystream, owner, collection, doc, checker)
}

/**
 * @param {import('isodb').ITransaction<typeof import('../db.js').def>} tr
 * @param {Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @param {dbtypes.UserIdentity} user
 */
export const hasReadAccess = async (tr, ystream, owner, collection, doc, user) => user.isTrusted ? promise.resolveWith(true) : checkAccess(tr, ystream, owner, collection, doc, opperm => opperm.hasReadAccess(buffer.toBase64(user.hash)))

/**
 * @param {import('isodb').ITransaction<typeof import('../db.js').def>} tr
 * @param {Ystream} ystream
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {string} doc
 * @param {dbtypes.UserIdentity} user
 */
export const hasWriteAccess = async (tr, ystream, owner, collection, doc, user) => user.isTrusted ? promise.resolveWith(true) : checkAccess(tr, ystream, owner, collection, doc, opperm => opperm.hasWriteAccess(buffer.toBase64(user.hash)))
