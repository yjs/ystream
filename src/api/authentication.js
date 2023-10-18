import * as ecdsa from 'lib0/crypto/ecdsa'
import * as dbtypes from '../dbtypes.js'
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
    ydb.user = userIdentity
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

export const createUserIdentity = async ({ extractable = false } = {}) => {
  const { publicKey, privateKey } = await ecdsa.generateKeyPair({ extractable })
  const userIdentity = new dbtypes.UserIdentity(json.stringify(await ecdsa.exportKeyJwk(publicKey)))
  return { userIdentity, publicKey, privateKey }
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
      iss: user.ekey,
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
 * @param {Object} opts
 * @param {boolean} [opts.isTrusted]
 */
export const registerUser = (ydb, user, { isTrusted = false } = {}) =>
  ydb.db.transact(async tr => {
    if ((await tr.tables.users.indexes.hash.get(user.hash)) == null) {
      await tr.tables.users.add(new dbtypes.UserIdentity(user.ekey, { isTrusted }))
    }
  })

/**
 * Checks whether a user is registered in this database.
 *
 * @param {Ydb} ydb
 * @param {dbtypes.UserIdentity} user
 */
export const isRegisteredUser = (ydb, user) =>
  ydb.db.transact(tr =>
    tr.tables.users.indexes.hash.get(user.hash)
      .then(ruser => ruser?.ekey === user.ekey)
  )

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
export const registerDevice = (ydb, userHash, claim) =>
  ydb.db.transact(async tr => {
    const user = await tr.tables.users.indexes.hash.get(userHash)
    if (user == null) error.unexpectedCase()
    claim.verify(await user.publicKey)
    verifyDeviceClaim(ydb, claim.hash, claim.v)
    tr.tables.devices.add(claim)
  })

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
    const { payload: { sub, iss } } = payload
    if (userPublicKey == null) {
      // ensure that the user identity is set using the public key of the jwt
      const user = new dbtypes.UserIdentity(iss)
      await setUserIdentity(ydb, user, await user.publicKey, null)
    }
    if (sub == null) error.unexpectedCase()
    // Don't call the constructor manually. This is okay only here. Use DeviceClaim.fromJwt
    // instead.
    const deviceclaim = new dbtypes.DeviceClaim(jwt, sha256.digest(string.encodeUtf8(sub)))
    tr.objects.device.set('claim', deviceclaim)
    tr.tables.devices.add(deviceclaim)
    ydb.deviceClaim = deviceclaim
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

/**
 * @param {Ydb} ydb
 */
export const getAllRegisteredUserHashes = ydb => ydb.db.transact(async tr => {
  const users = await tr.tables.users.getValues()
  return users.map(user => new Uint8Array(user.hash))
})
