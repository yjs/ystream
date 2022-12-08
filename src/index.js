import * as isodb from 'isodb'
import * as ops from './ops.js'

const def = {
  oplog: {
    key: isodb.AutoKey,
    value: ops.OpValue,
    indexes: {
      doc: {
        key: ops.DocKey,
        /**
         * @param {isodb.AutoKey} k
         * @param {ops.OpValue} v
         */
        mapper: (k, v) => new ops.DocKey(v.collection, v.doc, k.v)
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
      tr.tables.oplog.indexes.doc.getValues({ start: new ops.DocKey(collection, doc, opclock == null ? 0 : (opclock + 1)) })
    )
  }

  /**
   * @param {string} collection
   * @param {string} doc
   * @param {Uint8Array} update
   */
  addUpdate (collection, doc, update) {
    return this.db.transact(async tr => {
      tr.tables.oplog.add(new ops.OpValue(0, 0, collection, doc, new ops.YjsOp(update)))
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
