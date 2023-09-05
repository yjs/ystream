import * as dbtypes from './dbtypes.js'
import * as isodb from 'isodb'
import * as jose from 'lib0/crypto/jwt'
import * as string from 'lib0/string'
import * as sha256 from 'lib0/hash/sha256'
import * as webcrypto from 'lib0/webcrypto'
import * as oaep from 'lib0/crypto/rsa-oaep'
import * as buffer from 'lib0/buffer'
import * as time from 'lib0/time'
import * as json from 'lib0/json'

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
        // @todo add `shallow index: {collection}/{autokey}/{doc}/{opid}` for computing the shallow (nocontent)
        // sync
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
      value: dbtypes.User,
      indexes: {
        hash: {
          key: Uint8Array, // sha256 digest of public key
          /**
           * @param {isodb.AutoKey} _k
           * @param {dbtypes.User} user
           */
          mapper: (_k, user) => user.hash
        }
      }
    },
    devices: {
      key: isodb.AutoKey,
      value: dbtypes.DeviceClaim,
      indexes: {
        hash: {
          key: isodb.BinaryKey,
          /**
           * @param {isodb.AutoKey} _k
           * @param {dbtypes.DeviceClaim} v
           */
          mapper: (_k, v) => v.hash
        }
      }
    }
  },
  objects: {
    db: {
      version: isodb.AnyValue
    },
    user: {
      public: isodb.CryptoKeyValue,
      private: isodb.CryptoKeyValue
    },
    device: {
      public: isodb.CryptoKeyValue,
      private: isodb.CryptoKeyValue,
      // proof.iss: the base64 encoded value of the users publicKey.
      // proof.sub: the json encoded key of the jwt of the device.
      claim: dbtypes.DeviceClaim
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
 * # The NoPerm op (possibly rename to PlaceHolder(noperm))
 * When a "server" mustn't send an update to a client because it lacks permission, we send
 * a NoPerm op instead with the current client/clock of the "server".
 * Once the client receives access, the client requests the content of that document from other
 * clients using the "RequestDoc" (collection, doc, latestClockOfLastNoPerm) protocol op. We apply
 * the document update op without checking clock. If the remote client has at least
 * "latestClockOfLastNoPerm", then we delete the todo item. Otherwise, we need to try again in the
 * future.
 */

/**
 * # Auth & Credentials
 *
 * A user generates a public-private key that must be kept private. This could also be done by a
 * backend. Once a malicious user has access to the private key, the user is compromised and can no
 * longer sync p2p. Hence it must be kept in a secure vault. The users private key can also be
 * stored / generated only when needed.
 *
 * A user is gives access to a document / collection. The sha256 digest of the public key is used
 * for identification.
 *
 * A devices proves that it acts as a certain user using a signed message of the user (using the
 * private key).
 *
 * A device hence must have a different public-private key pair. The user signs the public key of
 * the device (similar to json web token).
 *
 * A future implementation could also require that other authorities (e.g. auth providers) sign
 * the device key for advanced security. We can also require that signed tokens expire.
 */

/**
 * # Security Extensions
 *
 * - There should be a record of claims that a user generated. The user should be able to untrust
 * claims.
 */

/**
 * # Protocol
 * 1. Exchange Credentials (User.publickKey + DeviceClaim)
 *   - Approach1: From now on all messages must be encrypted using the public key of the remote device
 *   - Approach2: If the connection is secure, we can auth by sending a proof that the other side
 *   must decrypt.
 * 2. Request collections [collectionname:[clientid:lastclock], ..]
 *   - Send back all documents as "Placeholder(unsent)" op, but include all permission ops.
 *   - User requests all Placeholder(unsent) ops individually (if they have access, X at a time, but
 *     possible to retrieve Y early). getdoc[clientid:clock|null]
 *   -- An alternative implementation could only retrieve documents when they are opened.
 *   -- Check if user has access to collection
 *   -- If user doesn't have access to a specific document, send NoPerm op instead.
 *      The user can rerequest the document itself.
 */

/**
 * @param {string} dbname
 */
export const createDb = dbname =>
  isodb.openDB(dbname, def).then(async idb => {
    await idb.transact(async tr => {
      const version = await tr.objects.db.get('version')
      if (version === undefined) {
        // init
        tr.objects.db.set('version', 0)
        const dguid = new Uint8Array(64)
        webcrypto.getRandomValues(dguid)
        const { publicKey: publicUserKey, privateKey: privateUserKey } = await oaep.generateKeyPair()
        const user = new dbtypes.User(buffer.encodeAny(await oaep.exportKeyJwk(publicUserKey)))
        tr.objects.user.set('public', publicUserKey)
        tr.objects.user.set('private', privateUserKey)
        tr.tables.users.add(user)
        const { publicKey: publicDeviceKey, privateKey: privateDeviceKey } = await oaep.generateKeyPair()
        tr.objects.device.set('private', privateDeviceKey)
        tr.objects.device.set('public', publicDeviceKey)
        const jwtSub = json.stringify(await oaep.exportKeyJwk(publicDeviceKey)) // should be encoded so we have a hash
        // @todo add type definition to isodb.jwtValue
        // @todo add expiration date `exp`
        const jwt = await jose.encodeJwt(privateUserKey, {
          iss: buffer.toBase64(user.hash),
          iat: time.getUnixTime(),
          sub: jwtSub
        })
        // Don't call the constructor manually. This is okay only here. Use DeviceClaim.fromJwt
        // instead.
        const deviceclaim = new dbtypes.DeviceClaim(jwt, sha256.digest(string.encodeUtf8(jwtSub)))
        tr.objects.device.set('claim', deviceclaim)
        tr.tables.devices.add(deviceclaim)
      }
    })
    return idb
  })
