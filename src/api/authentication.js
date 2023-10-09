import * as ecdsa from 'lib0/crypto/ecdsa'
import * as dbtypes from '../dbtypes.js'
import * as buffer from 'lib0/buffer'
import * as jose from 'lib0/crypto/jwt'
import * as time from 'lib0/time'
import * as json from 'lib0/json'
import * as error from 'lib0/error'
import * as promise from 'lib0/promise'
import * as string from 'lib0/string'
import * as sha256 from 'lib0/hash/sha256'

/**
 * @typedef {import('../ydb.js').Ydb} Ydb
 */

/**
 * @param {Ydb} ydb
 * @param {dbtypes.UserIdentity} userIdentity
 * @param {CryptoKey} publicKey
 * @param {CryptoKey|null} privateKey
 */
export const setUserIdentity = async (ydb, userIdentity, publicKey, privateKey) =>
  ydb.db.transact(async tr => {
    tr.objects.user.set('public', publicKey)
    privateKey && tr.objects.user.set('private', privateKey)
    tr.tables.users.add(userIdentity)
    tr.objects.user.set('identity', userIdentity)
    if (privateKey) {
      // generate deviceclaim
      /**
       * @type {dbtypes.DeviceIdentity}
       */
      const deviceIdentity = /** @type {dbtypes.DeviceIdentity} */ (await tr.objects.device.get('identity'))
      const claim = await createDeviceClaim(ydb, deviceIdentity)
      await useDeviceClaim(ydb, claim)
    }
  })

/**
 * @param {Ydb} ydb
 */
export const generateUserIdentity = async (ydb) => {
  const { publicKey, privateKey } = await ecdsa.generateKeyPair()
  const userIdentity = new dbtypes.UserIdentity(json.stringify(await ecdsa.exportKeyJwk(publicKey)))
  await setUserIdentity(ydb, userIdentity, publicKey, privateKey)
}

/**
 * @param {Ydb} ydb
 * @param {dbtypes.DeviceIdentity} deviceIdentity
 */
export const createDeviceClaim = (ydb, deviceIdentity) =>
  ydb.db.transact(async tr => {
    const [privateUserKey, user] = await promise.all([
      tr.objects.user.get('private'),
      tr.objects.user.get('identity')
    ])
    if (privateUserKey == null || user == null) error.unexpectedCase()
    // @todo add type definition to isodb.jwtValue
    // @todo add expiration date `exp`
    const jwt = await jose.encodeJwt(privateUserKey.key, {
      iss: buffer.toBase64(user.hash), // @todo should this be a hash, or the full ekey? (use hash only for indexing)
      iat: time.getUnixTime(),
      sub: deviceIdentity.ekey
    })
    return jwt
  })

/**
 * Register user, allowing him to connect to this instance.
 *
 * @param {Ydb} ydb
 * @param {dbtypes.UserIdentity} user
 */
export const registerUser = (ydb, user) =>
  ydb.db.transact(async tr => {
    tr.tables.users.add(user)
  })

/**
 * @param {Ydb} ydb
 * @param {Uint8Array} userHash
 * @param {string} jwt
 * @return {Promise<import('../dbtypes.js').JwtDeviceClaim | null>}
 */
export const verifyDeviceClaim = (ydb, userHash, jwt) =>
  ydb.db.transact(async tr => {
    const user = await tr.tables.users.indexes.hash.get(userHash)
    if (user == null) return null
    const { payload } = await jose.verifyJwt(await user.publicKey, jwt)
    if (payload.sub !== user.ekey) {
      return null
    }
    return payload
  })

/**
 * @param {Ydb} ydb
 * @param {Uint8Array} userHash
 * @param {dbtypes.DeviceClaim} claim
 */
export const registerDevice = (ydb, userHash, claim) => {
  ydb.db.transact(async tr => {
    const user = await tr.tables.users.indexes.hash.get(userHash)
    if (user == null) error.unexpectedCase()
    claim.verify(await user.publicKey)
    verifyDeviceClaim(ydb, claim.hash, claim.v)
    tr.tables.devices.add(claim)
  })
}

/**
 * @param {Ydb} ydb
 * @param {string} jwt
 */
export const useDeviceClaim = (ydb, jwt) =>
  ydb.db.transact(async tr => {
    let payload
    const userPublicKey = await tr.objects.user.get('public')
    if (userPublicKey != null) {
      payload = await jose.verifyJwt(userPublicKey.key, jwt)
    } else {
      payload = jose.unsafeDecode(jwt)
    }
    const { payload: { sub } } = payload
    if (userPublicKey == null) {
      // ensure that the user identity is set using the public key of the jwt
      await setUserIdentity(ydb, new dbtypes.UserIdentity(sub), await ecdsa.importKeyJwk(json.parse(sub), { extractable: true }), null)
    }
    if (sub == null) error.unexpectedCase()
    // Don't call the constructor manually. This is okay only here. Use DeviceClaim.fromJwt
    // instead.
    const deviceclaim = new dbtypes.DeviceClaim(jwt, sha256.digest(string.encodeUtf8(sub)))
    tr.objects.device.set('claim', deviceclaim)
    tr.tables.devices.add(deviceclaim)
    ydb.isAuthenticated = true
    ydb.emit('authenticate', []) // should only be fired on deviceclaim
  })

/**
 * @param {Ydb} ydb
 */
export const getDeviceIdentity = ydb =>
  ydb.db.transact(async tr => {
    const did = await tr.objects.device.get('identity')
    if (did == null) error.unexpectedCase()
    return did
  })

/**
 * @param {Ydb} ydb
 */
export const getUserIdentity = ydb =>
  ydb.db.transact(async tr => {
    const uid = await tr.objects.user.get('identity')
    if (uid == null) error.unexpectedCase()
    return uid
  })
