import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as error from 'lib0/error'
import * as isodb from 'isodb'

export class AbstractOp {
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
   * @return {isodb.IEncodable}
   */
  static decode (_decoder) {
    error.methodUnimplemented()
  }
}

export const OpYjsUpdateType = 0

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
}

/**
 * @implements isodb.IEncodable
 */
export class OpValue {
  /**
   * @param {number} client
   * @param {number} clock
   * @param {string} collection
   * @param {string} doc
   * @param {AbstractOp} op
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
    let op
    switch (type) {
      case OpYjsUpdateType: {
        op = OpYjsUpdate.decode(decoder)
        break
      }
      /* c8 ignore next 2 */
      default:
        error.unexpectedCase()
    }
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
    this.doc = doc
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
