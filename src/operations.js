import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as error from 'lib0/error'
import * as Y from 'yjs'
import * as math from 'lib0/math'
import * as array from 'lib0/array'

/**
 * @typedef {import('isodb').IEncodable} IEncodable
 */

export const OpYjsUpdateType = 0
export const OpNoPermissionType = 1
export const OpPermType = 2

/**
 * @typedef {OpYjsUpdateType | OpNoPermissionType | OpPermType} OpTypeIds
 */

/**
 * @typedef {OpYjsUpdate | OpNoPermission | OpPerm} OpTypes
 */

/**
 * @todo rename all interfaces to I[* / AbstractOp]
 * @implements IEncodable
 */
export class AbstractOp {
  /**
   * @param {any} _anyarg
   */
  constructor (_anyarg) {
    error.methodUnimplemented()
  }

  /**
   * @return {OpTypeIds}
   */
  get type () {
    return error.methodUnimplemented()
  }

  /**
   * @param {encoding.Encoder} _encoder
   */
  encode (_encoder) {
    error.methodUnimplemented()
  }

  /**
   * @param {decoding.Decoder} _decoder
   * @return {OpTypes}
   */
  static decode (_decoder) {
    error.methodUnimplemented()
  }

  /**
   * @param {Array<import('./dbtypes.js').OpValue>} _ops
   * @param {boolean} _gc
   * @return {import('./dbtypes.js').OpValue}
   */
  static merge (_ops, _gc) {
    error.methodUnimplemented()
  }
}

/**
 * @typedef {'noaccess'|'r'|'rw'|'admin'} AccessType
 */

/**
 * An operation that contains information about which users have access to a document.
 *
 * @implements AbstractOp
 */
export class OpPerm {
  constructor () {
    /**
     * @type {Map<string,number>}
     */
    this.access = new Map()
  }

  /**
   * @param {string} userhash
   */
  hasReadAccess (userhash) {
    return (this.access.get(userhash) || 0) % 3 > 0
  }

  /**
   * @param {string} userhash
   */
  hasWriteAccess (userhash) {
    return (this.access.get(userhash) || 0) % 4 > 1
  }

  /**
   * @param {string} userhash
   */
  hasAdminAccess (userhash) {
    return (this.access.get(userhash) || 0) % 4 === 3
  }

  /**
   * @param {string} userhash
   * @return {AccessType}
   */
  getAccessType (userhash) {
    switch ((this.access.get(userhash) || 0) % 4) {
      case 0:
        return 'noaccess'
      case 1:
        return 'r'
      case 2:
        return 'rw'
      case 3:
        return 'admin'
      default:
        error.unexpectedCase()
    }
  }

  /**
   * @return {OpPermType}
   */
  get type () {
    return OpPermType
  }

  /**
   * @param {encoding.Encoder} encoder
   */
  encode (encoder) {
    encoding.writeVarUint(encoder, this.access.size)
    this.access.forEach((perm, userhash) => {
      encoding.writeVarString(encoder, userhash)
      encoding.writeVarUint(encoder, perm)
    })
  }

  /**
   * @param {decoding.Decoder} decoder
   * @return {OpPerm}
   */
  static decode (decoder) {
    const op = new OpPerm()
    const size = decoding.readVarUint(decoder)
    for (let i = 0; i < size; i++) {
      const userhash = decoding.readVarString(decoder)
      const perm = decoding.readVarUint(decoder)
      op.access.set(userhash, perm)
    }
    return op
  }

  /**
   * @param {Array<import('./dbtypes.js').OpValue<OpPerm>>} ops
   * @param {boolean} _gc
   * @return {import('./dbtypes.js').OpValue<OpPerm>}
   */
  static merge (ops, _gc) {
    const mergedOp = ops[0].op
    for (let i = 1; i < ops.length; i++) {
      const op = ops[i]
      op.op.access.forEach((perm, userhash) => {
        mergedOp.access.set(userhash, math.max(mergedOp.access.get(userhash) || 0, perm))
      })
    }
    const lastOp = ops[ops.length - 1]
    lastOp.op = mergedOp
    return lastOp
  }
}

/**
 * @param {OpPerm|null} currentPermOp
 * @param {string} userhash
 * @param {AccessType} accessType
 */
export const createOpPermUpdate = (currentPermOp, userhash, accessType) => {
  const currAccess = (currentPermOp?.access.get(userhash) || 0) % 4
  const diff = 4 - currAccess
  let newAccessType = 0
  switch (accessType) {
    case 'noaccess':
      newAccessType = 0
      break
    case 'r':
      newAccessType = 1
      break
    case 'rw':
      newAccessType = 2
      break
    case 'admin':
      newAccessType = 3
      break
    default:
      error.unexpectedCase()
  }
  const newPermOp = new OpPerm()
  newPermOp.access.set(userhash, currAccess + diff + newAccessType)
  return newPermOp
}

/**
 * An operation that is used as a placeholder until we request access again.
 * @implements AbstractOp
 */
export class OpNoPermission {
  /**
   * @return {OpNoPermissionType}
   */
  get type () {
    return OpNoPermissionType
  }

  /**
   * @param {encoding.Encoder} _encoder
   */
  encode (_encoder) {}

  /**
   * @param {decoding.Decoder} _decoder
   * @return {OpNoPermission}
   */
  static decode (_decoder) {
    return new OpNoPermission()
  }

  /**
   * @param {Array<import('./dbtypes.js').OpValue<OpNoPermission>>} ops
   * @param {boolean} _gc
   * @return {import('./dbtypes.js').OpValue<OpNoPermission>}
   */
  static merge (ops, _gc) {
    return ops[ops.length - 1]
  }
}

/**
 * @implements AbstractOp
 */
export class OpYjsUpdate {
  /**
   * @param {Uint8Array} update
   */
  constructor (update) {
    this.update = update
  }

  /**
   * @return {OpYjsUpdateType}
   */
  get type () {
    return OpYjsUpdateType
  }

  /**
   * @param {encoding.Encoder} encoder
   */
  encode (encoder) {
    encoding.writeVarUint8Array(encoder, this.update)
  }

  /**
   * @param {decoding.Decoder} decoder
   * @return {OpYjsUpdate}
   */
  static decode (decoder) {
    return new OpYjsUpdate(decoding.readVarUint8Array(decoder))
  }

  /**
   * @param {Array<import('./dbtypes.js').OpValue<OpYjsUpdate>>} ops
   * @param {boolean} gc
   * @return {import('./dbtypes.js').OpValue<OpYjsUpdate>}
   */
  static merge (ops, gc) {
    let update
    // @todo if ops.length === 1 return ops[0]
    if (gc) {
      const ydoc = new Y.Doc()
      ydoc.transact(() => {
        for (let i = 0; i < ops.length; i++) {
          Y.applyUpdateV2(ydoc, ops[i].op.update)
        }
      })
      update = Y.encodeStateAsUpdateV2(ydoc)
    } else {
      update = Y.mergeUpdatesV2(ops.map(op => op.op.update))
    }
    const lastOp = array.fold(ops, ops[0], (o1, o2) => o1.localClock > o2.localClock ? o1 : o2)
    lastOp.op = new OpYjsUpdate(update)
    return lastOp
  }
}

export const typeMap = {
  [OpYjsUpdateType]: OpYjsUpdate,
  [OpNoPermissionType]: OpNoPermission,
  [OpPermType]: OpPerm
}
