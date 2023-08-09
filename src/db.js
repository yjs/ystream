import * as dbtypes from './dbtypes.js'
import * as isodb from 'isodb'
import * as string from 'lib0/string'
import * as sha256 from 'lib0/hash/sha256'

/**
 * @todos
 * - implement protocol/RequestDoc (+ be able to apply it)
 * - implement todo queue for requesting docs
 */

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
          mapper: (k, v) => new dbtypes.DocKey(v.op.type, v.collection, v.doc, k.v),
          key: dbtypes.DocKey
        },
        collection: {
          /**
           * @param {isodb.AutoKey} k
           * @param {dbtypes.OpValue} v
           */
          mapper: (k, v) => new dbtypes.CollectionKey(v.collection, k.v),
          key: dbtypes.CollectionKey
        }
      }
    },
    clocks: {
      key: dbtypes.ClocksKey,
      value: dbtypes.ClientClockValue
    },
    unsyncedDocs: {
      key: dbtypes.UnsyncedKey,
      value: isodb.NoValue
    },
    users: {
      key: isodb.AutoKey,
      value: isodb.StringValue,
      indexes: {
        hash: {
          /**
           * @param {isodb.AutoKey} _k
           * @param {isodb.StringValue} v
           */
          mapper: (_k, v) => new isodb.BinaryKey(sha256.digest(string.encodeUtf8(v.v))),
          key: isodb.BinaryKey
        }
      }
    },
    devices: {
      key: isodb.AutoKey,
      value: dbtypes.DeviceKey,
      indexes: {
        device: {
          key: dbtypes.DeviceKey,
          /**
           * @param {isodb.AutoKey} _k
           * @param {dbtypes.DeviceKey} v
           */
          mapper: (_k, v) => v
        }
      }
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
 * # The NoPerm op
 * When a "server" mustn't send an update to a client because it lacks permission, we send
 * a NoPerm op instead with the current client/clock of the "server".
 * Once the client receives access, the client requests the content of that document from other
 * clients using the "RequestDoc" (collection, doc, latestClockOfLastNoPerm) protocol op. We apply
 * the document update op without checking clock. If the remote client has at least
 * "latestClockOfLastNoPerm", then we delete the todo item. Otherwise, we need to try again in the
 * future.
 */

/**
 * @param {string} dbname
 */
export const createDb = dbname =>
  isodb.openDB(dbname, def)
