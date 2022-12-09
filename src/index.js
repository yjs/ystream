import * as isodb from 'isodb'
import * as ops from './ops.js'
import * as Y from 'yjs'
import { setIfUndefined } from 'lib0/map.js'
import { bindydoc } from './bindydoc.js'

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
    /**
     * @type {Map<string,Map<string,Set<Y.Doc>>>}
     */
    this.collections = new Map()
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

  /**
   * @param {string} collection
   * @param {string} docname
   */
  getYdoc (collection, docname) {
    const col = setIfUndefined(this.collections, collection, () => new Map())
    const docset = setIfUndefined(col, docname, () => new Set())
    const ydoc = new Y.Doc({
      guid: `${collection}#${docname}`
    })
    docset.add(ydoc)
    bindydoc(this, collection, docname, ydoc)
    return ydoc
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
