import * as dbtypes from './dbtypes.js'
import * as isodb from 'isodb'

/**
 * @typedef {import('./ydb.js').Ydb} Ydb
 */

export const def = {
  tables: {
    oplog: {
      key: isodb.AutoKey,
      value: dbtypes.OpValue,
      indexes: {
        doc: {
          /**
           * @param {isodb.AutoKey} k
           * @param {dbtypes.OpValue} v
           */
          mapper: (k, v) => new dbtypes.DocKey(v.collection, v.doc, v.op.type, k.v),
          key: dbtypes.DocKey
        },
        collection: {
          /**
           * @param {isodb.AutoKey} k
           * @param {dbtypes.OpValue} v
           */
          mapper: (k, v) => new dbtypes.CollectionKey(v.collection, k.v),
          key: dbtypes.CollectionKey
        },
        noperm: {
          /**
           * @param {isodb.AutoKey} k
           * @param {dbtypes.OpValue} v
           */
          mapper: (k, v) => v.op.type === dbtypes.OpPermType ? new dbtypes.NoPermissionIndexKey(v.collection, v.doc, k.v) : null,
          key: dbtypes.NoPermissionIndexKey
        }
      }
    },
    clocks: {
      key: dbtypes.ClocksKey,
      value: dbtypes.ClientClockValue
    },
    requests: {
      key: isodb.AutoKey,
      value: dbtypes.RequestValue
    }
  }
}

/**
 * # Algorithm to sync documents that a user just got permission to:
 *
 * The information that a document has been created (the first update) is always sent to all users.
 * However, users that don't have permission won't receive the content and simply store a "no
 * permission" information in the `oplog`.
 *
 * When we receive new permission, we store an "todo item in the `reqs`" table: "check table
 * starting at clock X". The name should be unique. Two separate permission changes should update
 * the same item. Simpler implementation: `reqs` table uses AutoKey or `collection/autokey` (by
 * index) and we have to work through the list until completion.
 *
 * We iterate through the table and sync each document individually until we completed the whole
 * collection table. Every time we synced a document, we update the todo item. Once completed,
 * we delete the todo item in reqs.
 *
 * # Todo
 * - ( ) implement request "sync document starting from clock X"
 * - ( ) implement requests table and figure out key-system.
 */

/**
 * @param {string} dbname
 */
export const createDb = dbname =>
  isodb.openDB(dbname, def)
