import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as error from 'lib0/error'
import * as isodb from 'isodb'
import * as Y from 'yjs'
import * as math from 'lib0/math'

export class AbstractOp {
  /**
   * @param {any} _anyarg
   */
  constructor (_anyarg) {
    error.methodUnimplemented()
  }

  /**
   * @return {number}
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
   * @return {AbstractOp}
   */
  static decode (_decoder) {
    error.methodUnimplemented()
  }

  /**
   * @param {Array<OpValue>} _ops
   * @param {boolean} _gc
   * @return {OpValue}
   */
  static merge (_ops, _gc) {
    error.methodUnimplemented()
  }
}

export const OpYjsUpdateType = 0
export const OpNoPermissionType = 1
export const OpGroupType = 2
export const OpPermissionType = 3

/**
 * An operation that contains information about which users have access to a group.
 *
 * @implements AbstractOp
 */
export class OpGroup {
  constructor () {
    /**
     * @type {Map<number,number>}
     */
    this.read = new Map()
    /**
     * @type {Map<number,number>}
     */
    this.write = new Map()
    /**
     * @type {Map<number,number>}
     */
    this.admin = new Map()
  }

  /**
   * @param {number} clientid
   */
  hasReadAccess (clientid) {
    return (this.read.get(clientid) || 0) % 2 === 1
  }

  /**
   * @param {number} clientid
   */
  hasWriteAccess (clientid) {
    return (this.write.get(clientid) || 0) % 2 === 1
  }

  /**
   * @param {number} clientid
   */
  hasAdminAccess (clientid) {
    return (this.admin.get(clientid) || 0) % 2 === 1
  }

  get type () {
    return OpGroupType
  }

  /**
   * @param {encoding.Encoder} encoder
   */
  encode (encoder) {
    encoding.writeVarUint(encoder, this.read.size)
    this.read.forEach((perm,clientid) => {
      encoding.writeVarUint(encoder, clientid)
      encoding.writeVarUint(encoder, perm)
    })
    encoding.writeVarUint(encoder, this.write.size)
    this.write.forEach((perm,clientid) => {
      encoding.writeVarUint(encoder, clientid)
      encoding.writeVarUint(encoder, perm)
    })
    encoding.writeVarUint(encoder, this.admin.size)
    this.admin.forEach((perm,clientid) => {
      encoding.writeVarUint(encoder, clientid)
      encoding.writeVarUint(encoder, perm)
    })
  }

  /**
   * @param {decoding.Decoder} decoder
   * @return {OpGroup}
   */
  static decode (decoder) {
    const op = new OpGroup()
    const sizeRead = decoding.readVarUint(decoder)
    for (let i = 0; i < sizeRead; i++) {
      const clientid = decoding.readVarUint(decoder)
      const perm = decoding.readVarUint(decoder)
      op.read.set(clientid, perm)
    }
    const sizeWrite = decoding.readVarUint(decoder)
    for (let i = 0; i < sizeWrite; i++) {
      const clientid = decoding.readVarUint(decoder)
      const perm = decoding.readVarUint(decoder)
      op.write.set(clientid, perm)
    }
    const sizeAdmin = decoding.readVarUint(decoder)
    for (let i = 0; i < sizeAdmin; i++) {
      const clientid = decoding.readVarUint(decoder)
      const perm = decoding.readVarUint(decoder)
      op.admin.set(clientid, perm)
    }
    return op
  }

  /**
   * @param {Array<OpValue<OpGroup>>} ops
   * @param {boolean} _gc
   * @return {OpValue<OpGroup>}
   */
  static merge (ops, _gc) {
    const mergedOp = ops[0].op
    for (let i = 1; i < ops.length; i++) {
      const op = ops[i]
      op.op.read.forEach((perm, clientid) => {
        mergedOp.read.set(clientid, math.max(mergedOp.read.get(clientid) || 0, perm))
      })
      op.op.write.forEach((perm, clientid) => {
        mergedOp.write.set(clientid, math.max(mergedOp.write.get(clientid) || 0, perm))
      })
      op.op.admin.forEach((perm, clientid) => {
        mergedOp.admin.set(clientid, math.max(mergedOp.admin.get(clientid) || 0, perm))
      })
    }
    const lastOp = ops[ops.length - 1]
    lastOp.op = mergedOp
    return lastOp
  }
}

/**
 * An operation that is used as a placeholder until we request access again.
 * @implements AbstractOp
 */
export class OpNoPermission {
  get type () {
    return OpNoPermissionType
  }

  /**
   * @param {encoding.Encoder} _encoder
   */
  encode (_encoder) {}

  /**
   * @param {decoding.Decoder} _decoder
   * @return {AbstractOp}
   */
  static decode (_decoder) {
    return new OpNoPermission()
  }

  /**
   * @param {Array<OpValue<OpNoPermission>>} ops
   * @param {boolean} _gc
   * @return {OpValue<OpNoPermission>}
   */
  static merge (ops, _gc) {
    return ops[ops.length - 1]
  }
}

/**
 * An operation that is used as a placeholder until we request access again.
 * @implements AbstractOp
 */
export class OpNoPermission {
  get type () {
    return OpNoPermissionType
  }

  /**
   * @param {encoding.Encoder} _encoder
   */
  encode (_encoder) {}

  /**
   * @param {decoding.Decoder} _decoder
   * @return {AbstractOp}
   */
  static decode (_decoder) {
    return new OpNoPermission()
  }

  /**
   * @param {Array<OpValue<OpNoPermission>>} ops
   * @param {boolean} _gc
   * @return {OpValue<OpNoPermission>}
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
   * @return {AbstractOp}
   */
  static decode (decoder) {
    return new OpYjsUpdate(decoding.readVarUint8Array(decoder))
  }

  /**
   * @param {Array<OpValue<OpYjsUpdate>>} ops
   * @param {boolean} gc
   * @return {OpValue<OpYjsUpdate>}
   */
  static merge (ops, gc) {
    let update
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
    const lastOp = ops[ops.length - 1]
    lastOp.op = new OpYjsUpdate(update)
    return lastOp
  }
}

/**
 * @type {Object<number,typeof AbstractOp>}
 */
const optypeMap = {
  [OpYjsUpdateType]: OpYjsUpdate,
  [OpNoPermissionType]: OpNoPermission
}

/**
 * @param {number} type
 * @return {typeof AbstractOp}
 */
export const optypeToConstructor = type => optypeMap[type]

/**
 * @template {AbstractOp} [OP=AbstractOp]
 * @implements isodb.IEncodable
 */
export class OpValue {
  /**
   * @param {number} client
   * @param {number} clock
   * @param {string} collection
   * @param {string} doc
   * @param {OP} op
   */
  constructor (client, clock, collection, doc, op) {
    this.client = client
    this.clock = clock
    this.collection = collection
    this.doc = doc
    this.op = op
  }

  /**
   * @param {encoding.Encoder} encoder
   */
  encode (encoder) {
    encoding.writeUint8(encoder, OpYjsUpdateType)
    encoding.writeVarUint(encoder, this.client)
    encoding.writeVarUint(encoder, this.clock)
    encoding.writeVarString(encoder, this.collection)
    encoding.writeVarString(encoder, this.doc)
    this.op.encode(encoder)
  }

  /**
   * @param {decoding.Decoder} decoder
   * @return {isodb.IEncodable}
   */
  static decode (decoder) {
    const type = decoding.readUint8(decoder)
    const clientFkey = decoding.readVarUint(decoder)
    const clientClockFkey = decoding.readVarUint(decoder)
    const collection = decoding.readVarString(decoder)
    const doc = decoding.readVarString(decoder)
    const op = optypeToConstructor(type).decode(decoder)
    return new OpValue(clientFkey, clientClockFkey, collection, doc, op)
  }
}

export const CertificateValue = isodb.StringKey

const RequestDocumentType = 0

/**
 * @implements isodb.IEncodable
 */
export class RequestValue {
  /**
   * @param {encoding.Encoder} _encoder
   */
  encode (_encoder) {
    error.unexpectedCase()
  }

  /**
   * @param {decoding.Decoder} decoder
   * @return {isodb.IEncodable}
   */
  static decode (decoder) {
    const requestType = decoding.peekVarUint(decoder)
    switch (requestType) {
      case RequestDocumentType: {
        return RequestDocumentValue.decode(decoder)
      }
      default:
        error.methodUnimplemented()
    }
  }
}

export class RequestDocumentValue extends RequestValue {
  /**
   * @param {string} collection
   * @param {string} doc
   */
  constructor (collection, doc) {
    super()
    this.collection = collection
    this.doc = doc
  }

  /**
   * @param {encoding.Encoder} encoder
   */
  encode (encoder) {
    encoding.writeVarUint(encoder, RequestDocumentType)
    encoding.writeVarString(encoder, this.collection)
    encoding.writeVarString(encoder, this.doc)
  }

  /**
   * @param {decoding.Decoder} decoder
   * @return {RequestValue}
   */
  static decode (decoder) {
    const type = decoding.readVarUint(decoder)
    if (type !== RequestDocumentType) error.methodUnimplemented()
    const collection = decoding.readVarString(decoder)
    const doc = decoding.readVarString(decoder)
    return new RequestDocumentValue(collection, doc)
  }
}

/**
 * @implements isodb.IEncodable
 */
export class ClientClockValue {
  /**
   * @param {number} clock
   * @param {number} localClock
   */
  constructor (clock, localClock) {
    this.clock = clock
    this.localClock = localClock
  }

  /**
   * @param {encoding.Encoder} encoder
   */
  encode (encoder) {
    encoding.writeVarUint(encoder, this.clock)
    encoding.writeVarUint(encoder, this.localClock)
  }

  /**
   * @param {decoding.Decoder} decoder
   * @return {isodb.IEncodable}
   */
  static decode (decoder) {
    const clock = decoding.readVarUint(decoder)
    const localClock = decoding.readVarUint(decoder)
    return new ClientClockValue(clock, localClock)
  }
}

/**
 * @implements isodb.IEncodable
 */
export class CollectionKey {
  /**
   * @param {string} collection
   * @param {number} opid
   */
  constructor (collection, opid) {
    this.collection = collection
    this.opid = opid
  }

  /**
   * @param {encoding.Encoder} encoder
   */
  encode (encoder) {
    encoding.writeVarString(encoder, this.collection)
    encoding.writeUint32(encoder, this.opid)
  }

  /**
   * @param {decoding.Decoder} decoder
   * @return {isodb.IEncodable}
   */
  static decode (decoder) {
    const collection = decoding.readVarString(decoder)
    const opid = decoding.readUint32(decoder)
    return new CollectionKey(collection, opid)
  }
}

/**
 * @implements isodb.IEncodable
 */
export class ClocksKey {
  /**
   * @param {number} clientid
   * @param {string?} collection
   * @param {string?} doc
   */
  constructor (clientid, collection, doc) {
    this.clientid = clientid
    this.collection = collection
    this.doc = doc // @todo remove: we probably don't need this
  }

  /**
   * @param {encoding.Encoder} encoder
   */
  encode (encoder) {
    const info = (this.collection ? 1 : 0) + (this.doc ? 2 : 0)
    encoding.writeUint8(encoder, info)
    encoding.writeUint32(encoder, this.clientid)
    this.collection && encoding.writeVarString(encoder, this.collection)
    this.doc && encoding.writeVarString(encoder, this.doc)
  }

  /**
   * @param {decoding.Decoder} decoder
   * @return {isodb.IEncodable}
   */
  static decode (decoder) {
    const info = decoding.readUint8(decoder)
    const clientid = decoding.readUint32(decoder)
    const collection = (info & 1) > 0 ? decoding.readVarString(decoder) : null
    const doc = (info & 2) > 0 ? decoding.readVarString(decoder) : null
    return new ClocksKey(clientid, collection, doc)
  }
}

/**
 * @implements isodb.IEncodable
 */
export class DocKey {
  /**
   * @param {string} collection
   * @param {string} doc
   * @param {number} opid
   */
  constructor (collection, doc, opid) {
    this.collection = collection
    this.doc = doc
    this.opid = opid
  }

  /**
   * @param {encoding.Encoder} encoder
   */
  encode (encoder) {
    encoding.writeVarString(encoder, this.collection)
    encoding.writeVarString(encoder, this.doc)
    encoding.writeUint32(encoder, this.opid)
  }

  /**
   * @param {decoding.Decoder} decoder
   * @return {isodb.IEncodable}
   */
  static decode (decoder) {
    const collection = decoding.readVarString(decoder)
    const doc = decoding.readVarString(decoder)
    const opid = decoding.readUint32(decoder)
    return new DocKey(collection, doc, opid)
  }
}
