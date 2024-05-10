import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as error from 'lib0/error'
import * as Y from 'yjs'
import * as math from 'lib0/math'
import * as array from 'lib0/array'
import * as dbtypes from './dbtypes.js'
import { mergeDocOps } from './actions.js'

/**
 * @typedef {import('isodb').IEncodable} IEncodable
 */

export const OpYjsUpdateType = 0
export const OpNoPermissionType = 1
export const OpPermType = 2
export const OpLwwType = 3
export const OpChildOfType = 4
export const OpDeleteDocType = 5

/**
 * @typedef {keyof typeMap} OpTypeIds
 */

/**
 * @typedef {InstanceType<typeMap[OpTypeIds]>} OpTypes
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

  /**
   * Note that op.localClock must be set before calling integrate!
   *
   * @todo There is probably a better abstraction than integrate / unintegrate to achive consistency
   * (e.g. AbstractOp.cleanup(merged, deletedOps), which is called only once before calling event
   * handlers or returning the promise)
   *
   * @param {import('./ystream.js').Ystream} _ystream
   * @param {import('isodb').ITransaction<typeof import('./db.js').def>} _tr
   * @param {import('./dbtypes.js').OpValue} _op
   * @return {Promise<void>|void}
   */
  integrate (_ystream, _tr, _op) {
    error.methodUnimplemented()
  }

  /**
   * @param {import('./ystream.js').Ystream} _ystream
   * @param {import('isodb').ITransaction<typeof import('./db.js').def>} _tr
   * @param {import('./dbtypes.js').OpValue} _op
   * @return {Promise<void>|void}
   */
  unintegrate (_ystream, _tr, _op) {
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
    const op = new this()
    const size = decoding.readVarUint(decoder)
    for (let i = 0; i < size; i++) {
      const userhash = decoding.readVarString(decoder)
      const perm = decoding.readVarUint(decoder)
      op.access.set(userhash, perm)
    }
    return op
  }

  /**
   * @todo maybe return ops that can safely be removed
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

  /**
   * @param {import('./ystream.js').Ystream} _ystream
   * @param {import('isodb').ITransaction<typeof import('./db.js').def>} _tr
   * @param {import('./dbtypes.js').OpValue} _op
   */
  integrate (_ystream, _tr, _op) {
  }

  /**
   * @param {import('./ystream.js').Ystream} _ystream
   * @param {import('isodb').ITransaction<typeof import('./db.js').def>} _tr
   * @param {import('./dbtypes.js').OpValue} _op
   */
  unintegrate (_ystream, _tr, _op) {
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
    return new this()
  }

  /**
   * @param {Array<import('./dbtypes.js').OpValue<OpNoPermission>>} ops
   * @param {boolean} _gc
   * @return {import('./dbtypes.js').OpValue<OpNoPermission>}
   */
  static merge (ops, _gc) {
    return ops[ops.length - 1]
  }

  /**
   * @param {import('./ystream.js').Ystream} _ystream
   * @param {import('isodb').ITransaction<typeof import('./db.js').def>} _tr
   * @param {import('./dbtypes.js').OpValue} _op
   */
  integrate (_ystream, _tr, _op) {
  }

  /**
   * @param {import('./ystream.js').Ystream} _ystream
   * @param {import('isodb').ITransaction<typeof import('./db.js').def>} _tr
   * @param {import('./dbtypes.js').OpValue} _op
   */
  unintegrate (_ystream, _tr, _op) {
  }
}

/**
 * @implements AbstractOp
 */
export class OpLww {
  /**
   * @param {number} cnt
   * @param {any} val
   */
  constructor (cnt, val) {
    this.cnt = cnt
    this.val = val
  }

  /**
   * @return {OpLwwType}
   */
  get type () {
    return OpLwwType
  }

  /**
   * @param {encoding.Encoder} encoder
   */
  encode (encoder) {
    encoding.writeVarUint(encoder, this.cnt)
    encoding.writeAny(encoder, this.val)
  }

  /**
   * @param {decoding.Decoder} decoder
   * @return {OpLww}
   */
  static decode (decoder) {
    return new this(decoding.readVarUint(decoder), decoding.readAny(decoder))
  }

  /**
   * This returns the "last writer". There is no merging. The other updates (even the ones that
   * happen "later"), can safely be removed without causing sync-issues.
   *
   * @param {Array<import('./dbtypes.js').OpValue<OpLww>>} ops
   * @param {boolean} _gc
   * @return {import('./dbtypes.js').OpValue<OpLww>}
   */
  static merge (ops, _gc) {
    return array.fold(ops, ops[0], (o1, o2) => (o1.op.cnt > o2.op.cnt || (o1.op.cnt === o2.op.cnt && o1.client > o2.client)) ? o1 : o2)
  }

  /**
   * @param {import('./ystream.js').Ystream} _ystream
   * @param {import('isodb').ITransaction<typeof import('./db.js').def>} _tr
   * @param {import('./dbtypes.js').OpValue} _op
   */
  integrate (_ystream, _tr, _op) {
  }

  /**
   * @param {import('./ystream.js').Ystream} _ystream
   * @param {import('isodb').ITransaction<typeof import('./db.js').def>} _tr
   * @param {import('./dbtypes.js').OpValue} _op
   */
  unintegrate (_ystream, _tr, _op) {
  }
}

/**
 * @todo This currently handles parent-child relation AND the name of a document. It's easier to
 * manage the database like this.
 *
 * However, it does make sense to enable users renaming a document while another user is moving
 * content. This implementation might be problematic in a shared filesystem.
 *
 * @implements AbstractOp
 */
export class OpChildOf {
  /**
   * @param {number} cnt
   * @param {string|null} parent
   * @param {string|null} childname
   */
  constructor (cnt, parent, childname) {
    this.cnt = cnt
    this.parent = parent
    this.childname = childname
  }

  /**
   * @return {OpChildOfType}
   */
  get type () {
    return OpChildOfType
  }

  /**
   * @param {encoding.Encoder} encoder
   */
  encode (encoder) {
    // bit0: has parent
    // bit1: has childname
    encoding.writeUint8(encoder, (this.parent === null ? 0 : 1) | (this.childname === null ? 0 : 2))
    encoding.writeVarUint(encoder, this.cnt)
    if (this.parent !== null) encoding.writeVarString(encoder, this.parent)
    if (this.childname !== null) encoding.writeVarString(encoder, this.childname)
  }

  /**
   * @param {decoding.Decoder} decoder
   * @return {OpChildOf}
   */
  static decode (decoder) {
    const info = decoding.readUint8(decoder)
    const cnt = decoding.readVarUint(decoder)
    const parent = (info & 1) === 1 ? decoding.readVarString(decoder) : null
    const childname = (info & 2) === 2 ? decoding.readVarString(decoder) : null
    return new OpChildOf(cnt, parent, childname)
  }

  /**
   * This works similarly to the lww merge.
   *
   * @param {Array<import('./dbtypes.js').OpValue<OpChildOf>>} ops
   * @param {boolean} _gc
   * @return {import('./dbtypes.js').OpValue<OpChildOf>}
   */
  static merge (ops, _gc) {
    return array.fold(ops, ops[0], (o1, o2) => (o1.op.cnt > o2.op.cnt || (o1.op.cnt === o2.op.cnt && o1.client > o2.client)) ? o1 : o2)
  }

  /**
   * @param {import('./ystream.js').Ystream} ystream
   * @param {import('isodb').ITransaction<typeof import('./db.js').def>} tr
   * @param {import('./dbtypes.js').OpValue} op
   */
  async integrate (ystream, tr, op) {
    if (this.parent !== null) {
      tr.tables.childDocs.set(new dbtypes.ParentKey(op.owner, op.collection, this.parent, this.childname ?? op.doc, op.localClock), op.doc)
    }
    // force that conflicts are unintegrated
    await mergeDocOps(ystream, op.owner, op.collection, op.doc, this.type)
  }

  /**
   * @param {import('./ystream.js').Ystream} _ystream
   * @param {import('isodb').ITransaction<typeof import('./db.js').def>} tr
   * @param {import('./dbtypes.js').OpValue} op
   */
  unintegrate (_ystream, tr, op) {
    if (this.parent !== null) {
      tr.tables.childDocs.remove(new dbtypes.ParentKey(op.owner, op.collection, this.parent, this.childname ?? op.doc, op.localClock))
    }
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
    return new this(decoding.readVarUint8Array(decoder))
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
      const ydoc = new Y.Doc({ guid: '' })
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

  /**
   * @param {import('./ystream.js').Ystream} _ystream
   * @param {import('isodb').ITransaction<typeof import('./db.js').def>} _tr
   * @param {import('./dbtypes.js').OpValue} _op
   */
  integrate (_ystream, _tr, _op) {
  }

  /**
   * @param {import('./ystream.js').Ystream} _stream
   * @param {import('isodb').ITransaction<typeof import('./db.js').def>} _tr
   * @param {import('./dbtypes.js').OpValue} _op
   */
  unintegrate (_stream, _tr, _op) {
  }
}

/**
 * @implements AbstractOp
 */
export class OpDeleteDoc {
  /**
   * @return {OpDeleteDocType}
   */
  get type () {
    return OpDeleteDocType
  }

  /**
   * @param {encoding.Encoder} _encoder
   */
  encode (_encoder) { }

  /**
   * @param {decoding.Decoder} _decoder
   * @return {OpDeleteDoc}
   */
  static decode (_decoder) {
    return new this()
  }

  /**
   * This returns the "last writer". There is no merging. The other updates (even the ones that
   * happen "later"), can safely be removed without causing sync-issues.
   *
   * @param {Array<import('./dbtypes.js').OpValue<OpDeleteDoc>>} ops
   * @param {boolean} _gc
   * @return {import('./dbtypes.js').OpValue<OpDeleteDoc>}
   */
  static merge (ops, _gc) {
    // we retain the op with the lowest localClock
    return array.fold(ops, ops[0], (o1, o2) => o1.localClock < o2.localClock ? o1 : o2)
  }

  /**
   * @param {import('./ystream.js').Ystream} _ystream
   * @param {import('isodb').ITransaction<typeof import('./db.js').def>} _tr
   * @param {import('./dbtypes.js').OpValue} _op
   */
  integrate (_ystream, _tr, _op) {
    /**
     * @todo get all doc operations here and unintegrate them
     */
  }

  /**
   * @param {import('./ystream.js').Ystream} _ystream
   * @param {import('isodb').ITransaction<typeof import('./db.js').def>} _tr
   * @param {import('./dbtypes.js').OpValue} _op
   */
  unintegrate (_ystream, _tr, _op) { }
}

export const typeMap = {
  [OpYjsUpdateType]: OpYjsUpdate,
  [OpNoPermissionType]: OpNoPermission,
  [OpPermType]: OpPerm,
  [OpLwwType]: OpLww,
  [OpChildOfType]: OpChildOf,
  [OpDeleteDocType]: OpDeleteDoc
}
