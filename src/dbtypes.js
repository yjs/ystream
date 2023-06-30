import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as error from 'lib0/error'
import * as isodb from 'isodb'
import * as requests from './messages.js'
import * as operations from './operations.js'
import * as binary from 'lib0/binary'

/**
 * @template {operations.OpTypes} [OP=any]
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
    encoding.writeUint8(encoder, operations.OpYjsUpdateType)
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
    const type = /** @type {operations.OpTypeIds} */ (decoding.readUint8(decoder))
    const clientFkey = decoding.readVarUint(decoder)
    const clientClockFkey = decoding.readVarUint(decoder)
    const collection = decoding.readVarString(decoder)
    const doc = decoding.readVarString(decoder)
    const op = operations.typeMap[type].decode(decoder)
    return new OpValue(clientFkey, clientClockFkey, collection, doc, op)
  }
}

export const CertificateValue = isodb.StringKey

/**
 * @todo create a "Request" type that is used in protocol
 * @template {requests.RequestDocument} [REQ=requests.RequestDocument]
 * @implements isodb.IEncodable
 */
export class RequestValue {
  /**
   * @param {REQ} req
   */
  constructor (req) {
    this.req = req
  }

  /**
   * @param {encoding.Encoder} encoder
   */
  encode (encoder) {
    encoding.writeVarUint(encoder, this.req.type)
    this.req.encode(encoder)
  }

  /**
   * @param {decoding.Decoder} decoder
   * @return {isodb.IEncodable}
   */
  static decode (decoder) {
    const requestType = decoding.readVarUint(decoder)
    switch (requestType) {
      case requests.RequestDocumentType: {
        return requests.RequestDocument.decode(decoder)
      }
      default:
        error.methodUnimplemented()
    }
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
   * @param {number} type
   * @param {string} collection
   * @param {string} doc
   * @param {number} opid
   */
  constructor (type, collection, doc, opid) {
    this.type = type
    this.collection = collection
    this.doc = doc
    this.opid = opid
  }

  /**
   * @param {{ type:number, collection:string, doc?:string }} prefix
   */
  static prefix ({ type, collection, doc }) {
    return encoding.encode(encoder => {
      encoding.writeUint16(encoder, type)
      encoding.writeVarString(encoder, collection)
      doc != null && encoding.writeVarString(encoder, doc)
    })
  }

  /**
   * @param {encoding.Encoder} encoder
   */
  encode (encoder) {
    encoding.writeUint16(encoder, this.type)
    encoding.writeVarString(encoder, this.collection)
    encoding.writeVarString(encoder, this.doc)
    encoding.writeUint32(encoder, this.opid)
  }

  /**
   * @param {decoding.Decoder} decoder
   * @return {isodb.IEncodable}
   */
  static decode (decoder) {
    const type = decoding.readUint16(decoder)
    const collection = decoding.readVarString(decoder)
    const doc = decoding.readVarString(decoder)
    const opid = decoding.readUint32(decoder)
    return new DocKey(type, collection, doc, opid)
  }
}

/**
 * @implements isodb.IEncodable
 */
export class UnsyncedKey {
  /**
   * @param {string} collection
   * @param {string?} doc
   */
  constructor (collection, doc) {
    this.collection = collection
    this.doc = doc
  }

  /**
   * @param {encoding.Encoder} encoder
   */
  encode (encoder) {
    encoding.writeVarString(encoder, this.collection)
    if (this.doc != null) {
      // use empty string '' as start
      encoding.writeVarString(encoder, this.doc)
    } else {
      // marking the end
      // this mustn't be decoded
      encoding.writeUint32(encoder, binary.BITS32)
    }
  }

  /**
   * @param {decoding.Decoder} decoder
   * @return {isodb.IEncodable}
   */
  static decode (decoder) {
    const collection = decoding.readVarString(decoder)
    const doc = decoding.readVarString(decoder)
    return new this(collection, doc)
  }
}

// @todo this can be removed
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
