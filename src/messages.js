import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as error from 'lib0/error'
import * as operations from './operations.js'

/**
 * @typedef {import('isodb').IEncodable} IEncodable
 */

export const RequestDocumentType = 0
export const ResendDocumentType = 1

/**
 * @abstract
 * @implements IEncodable
 */
export class AbstractMessage {
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
   * @return {AbstractMessage}
   */
  static decode (_decoder) {
    error.methodUnimplemented()
  }
}

/**
 * @implements AbstractMessage
 */
export class RequestDocument {
  /**
   * @param {string} collection
   * @param {string} doc
   * @param {number} expectedClientid
   * @param {number} expectedClock
   */
  constructor (collection, doc, expectedClientid, expectedClock) {
    this.collection = collection
    this.doc = doc
    this.eclientid = expectedClientid
    this.eclock = expectedClock
  }

  get type () { return RequestDocumentType }

  /**
   * @param {encoding.Encoder} encoder
   */
  encode (encoder) {
    encoding.writeVarString(encoder, this.collection)
    encoding.writeVarString(encoder, this.doc)
    encoding.writeVarUint(encoder, this.eclientid)
    encoding.writeVarUint(encoder, this.eclock)
  }

  /**
   * @param {decoding.Decoder} decoder
   */
  static decode (decoder) {
    const collection = decoding.readVarString(decoder)
    const doc = decoding.readVarString(decoder)
    const eclientid = decoding.readVarUint(decoder)
    const eclock = decoding.readVarUint(decoder)
    return new RequestDocument(collection, doc, eclientid, eclock)
  }
}

/**
 * @todo rename to "RequestedDocument"
 * @implements AbstractMessage
 */
export class ResendDocument {
  /**
   * @param {string} collection
   * @param {string} doc
   * @param {number} confirmedClientId
   * @param {number} confirmedClock
   * @param {Array<operations.AbstractOp>} ops
   */
  constructor (collection, doc, confirmedClientId, confirmedClock, ops) {
    this.collection = collection
    this.doc = doc
    this.cclientid = confirmedClientId
    this.cclock = confirmedClock
    this.ops = ops
  }

  get type () { return ResendDocumentType }

  /**
   * @param {encoding.Encoder} encoder
   */
  encode (encoder) {
    encoding.writeVarString(encoder, this.collection)
    encoding.writeVarString(encoder, this.doc)
    encoding.writeVarUint(encoder, this.cclientid)
    encoding.writeVarUint(encoder, this.cclock)
    encoding.writeVarUint(encoder, this.ops.length)
    for (let i = 0; i < this.ops.length; i++) {
      const op = this.ops[i]
      encoding.writeVarUint(encoder, op.type)
      op.encode(encoder)
    }
  }

  /**
   * @param {decoding.Decoder} decoder
   */
  static decode (decoder) {
    const collection = decoding.readVarString(decoder)
    const doc = decoding.readVarString(decoder)
    const cclientid = decoding.readVarUint(decoder)
    const cclock = decoding.readVarUint(decoder)
    const ops = []
    const opsLen = decoding.readVarUint(decoder)
    for (let i = 0; i < opsLen; i++) {
      const type = /** @type {operations.OpTypeIds} */ (decoding.readVarUint(decoder))
      ops.push(operations.typeMap[type].decode(decoder))
    }
    return new ResendDocument(collection, doc, cclientid, cclock, ops)
  }
}

export const typeMap = {
  [RequestDocumentType]: RequestDocument,
  [ResendDocumentType]: ResendDocument
}
