import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as error from 'lib0/error'
import * as isodb from 'isodb'
import * as Y from 'yjs'
import * as math from 'lib0/math'

export const OpYjsUpdateType = 0
export const OpNoPermissionType = 1
export const OpPermType = 2

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

/**
 * An operation that contains information about which users have access to a document.
 *
 * @implements AbstractOp
 */
export class OpPerm {
  constructor () {
    /**
     * @type {Map<number,number>}
     */
    this.access = new Map()
  }

  /**
   * @param {number} clientid
   */
  hasReadAccess (clientid) {
    return (this.access.get(clientid) || 0) % 3 > 0
  }

  /**
   * @param {number} clientid
   */
  hasWriteAccess (clientid) {
    return (this.access.get(clientid) || 0) % 4 > 1
  }

  /**
   * @param {number} clientid
   */
  hasAdminAccess (clientid) {
    return (this.access.get(clientid) || 0) % 4 === 3
  }

  get type () {
    return OpPermType
  }

  /**
   * @param {encoding.Encoder} encoder
   */
  encode (encoder) {
    encoding.writeVarUint(encoder, this.access.size)
    this.access.forEach((perm, clientid) => {
      encoding.writeVarUint(encoder, clientid)
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
      const clientid = decoding.readVarUint(decoder)
      const perm = decoding.readVarUint(decoder)
      op.access.set(clientid, perm)
    }
    return op
  }

  /**
   * @param {Array<OpValue<OpPerm>>} ops
   * @param {boolean} _gc
   * @return {OpValue<OpPerm>}
   */
  static merge (ops, _gc) {
    const mergedOp = ops[0].op
    for (let i = 1; i < ops.length; i++) {
      const op = ops[i]
      op.op.access.forEach((perm, clientid) => {
        mergedOp.access.set(clientid, math.max(mergedOp.access.get(clientid) || 0, perm))
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
   * @return {ClientClockValue}
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
 * @todo remove doc parameter
 * @implements isodb.IEncodable
 */
export class ClocksKey {
  /**
   * @param {number} clientid
   * @param {string?} collection
   */
  constructor (clientid, collection) {
    this.clientid = clientid
    this.collection = collection
  }

  /**
   * @param {encoding.Encoder} encoder
   */
  encode (encoder) {
    const info = (this.collection ? 1 : 0)
    encoding.writeUint8(encoder, info)
    encoding.writeUint32(encoder, this.clientid)
    this.collection && encoding.writeVarString(encoder, this.collection)
  }

  /**
   * @param {decoding.Decoder} decoder
   * @return {ClocksKey}
   */
  static decode (decoder) {
    const info = decoding.readUint8(decoder)
    const clientid = decoding.readUint32(decoder)
    const collection = (info & 1) > 0 ? decoding.readVarString(decoder) : null
    return new ClocksKey(clientid, collection)
  }
}

/**
 * @implements isodb.IEncodable
 */
export class DocKey {
  /**
   * @param {string} collection
   * @param {string} doc
   * @param {number} type
   * @param {number} opid
   */
  constructor (collection, doc, type, opid) {
    this.collection = collection
    this.doc = doc
    this.type = type
    this.opid = opid
  }

  /**
   * @param {encoding.Encoder} encoder
   */
  encode (encoder) {
    encoding.writeVarString(encoder, this.collection)
    encoding.writeVarString(encoder, this.doc)
    encoding.writeUint16(encoder, this.type)
    encoding.writeUint32(encoder, this.opid)
  }

  /**
   * @param {decoding.Decoder} decoder
   * @return {isodb.IEncodable}
   */
  static decode (decoder) {
    const collection = decoding.readVarString(decoder)
    const doc = decoding.readVarString(decoder)
    const type = decoding.readUint16(decoder)
    const opid = decoding.readUint32(decoder)
    return new DocKey(collection, doc, type, opid)
  }
}

export class NoPermissionIndexKey {
  /**
   * @param {string} collection
   * @param {string} doc
   * @param {number} clock
   */
  constructor (collection, doc, clock) {
    this.collection = collection
    this.doc = doc
    this.clock = clock
  }

  /**
   * @param {encoding.Encoder} encoder
   */
  encode (encoder) {
    encoding.writeVarString(encoder, this.collection)
    encoding.writeVarString(encoder, this.doc)
    encoding.writeUint32(encoder, this.clock)
  }

  /**
   * @param {decoding.Decoder} decoder
   * @return {isodb.IEncodable}
   */
  static decode (decoder) {
    const collection = decoding.readVarString(decoder)
    const doc = decoding.readVarString(decoder)
    const clock = decoding.readUint32(decoder)
    return new NoPermissionIndexKey(collection, doc, clock)
  }
}
