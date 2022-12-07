import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as error from 'lib0/error'
import * as isodb from 'isodb'

const OpTypeYjsUpdate = 0

/**
 * @template T
 * @implements isodb.IEncodable
 */
export class OpValue {
  /**
   * @param {number} client
   * @param {number} clock
   * @param {string} collection
   * @param {T} v
   */
  constructor (client, clock, collection, v) {
    this.client = client
    this.clock = clock
    this.collection = collection
    this.v = v
  }

  /**
   * @param {encoding.Encoder} _encoder
   */
  encode (_encoder) {
    error.methodUnimplemented()
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
    switch (type) {
      case OpTypeYjsUpdate: {
        const doc = decoding.readVarString(decoder)
        const update = decoding.readVarUint8Array(decoder)
        return new YjsUpdateValue(clientFkey, clientClockFkey, collection, update, doc)
      }
    }
    error.unexpectedCase()
  }
}

/**
 * @extends {OpValue<Uint8Array>}
 */
class YjsUpdateValue extends OpValue {
  /**
   * @param {number} client
   * @param {number} clock
   * @param {string} collection
   * @param {Uint8Array} update
   * @param {string} doc
   */
  constructor (client, clock, collection, update, doc) {
    super(client, clock, collection, update)
    this.doc = doc
  }

  /**
   * @param {encoding.Encoder} encoder
   */
  encode (encoder) {
    encoding.writeUint8(encoder, OpTypeYjsUpdate)
    encoding.writeVarUint(encoder, this.client)
    encoding.writeVarUint(encoder, this.clock)
    encoding.writeVarString(encoder, this.collection)
    encoding.writeVarString(encoder, this.doc)
    encoding.writeVarUint8Array(encoder, this.v)
  }
}

export const CertificateValue = isodb.StringKey

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
    /**
     * @todo remove this.v prop
     * @type {any}
     */
    this.v = null
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

const def = {
  oplog: {
    key: isodb.AutoKey,
    value: OpValue,
    indexes: {
      doc: {
        key: DocKey,
        /**
         * @param {isodb.AutoKey} k
         * @param {YjsUpdateValue} v
         */
        mapper: (k, v) => new DocKey(v.collection, v.doc, k.v)
      }
    }
  }
}

export class Ydb {
  /**
   * @param {string} dbname
   * @param {isodb.IDB<typeof def>} db
   */
  constructor (dbname, db) {
    this.dbname = dbname
    /**
     * @type {isodb.IDB<typeof def>}
     */
    this.db = db
  }

  /**
   * @param {string} collection
   * @param {string} doc
   * @param {number} [opclock]
   */
  getUpdates (collection, doc, opclock) {
    return this.db.transact(tr =>
      tr.tables.oplog.indexes.doc.getValues({ start: new DocKey(collection, doc, opclock == null ? 0 : (opclock + 1)) })
    )
  }

  /**
   * @param {string} collection
   * @param {string} doc
   * @param {Uint8Array} update
   */
  addUpdate (collection, doc, update) {
    return this.db.transact(async tr => {
      tr.tables.oplog.add(new YjsUpdateValue(0, 0, collection, update, doc))
    })
  }
}

export const deleteYdb = isodb.deleteDB

/**
 * @param {string} dbname
 */
export const openYdb = async (dbname) => {
  const db = await isodb.openDB(dbname, def)
  return new Ydb(dbname, db)
}
