import * as ecdsa from 'lib0/crypto/ecdsa'
import * as dbtypes from '../api/dbtypes.js'
import * as jose from 'lib0/crypto/jwt'
import * as time from 'lib0/time'
import * as json from 'lib0/json'
import * as error from 'lib0/error'
import * as promise from 'lib0/promise'
import * as string from 'lib0/string'
import * as sha256 from 'lib0/hash/sha256'

/**
 * @typedef {import('../ystream.js').Ystream} Ystream
 */

/**
 * @note this must not be called within a transaction, as it will never finish.
 *
 * @param {Ystream} ystream
 * @param {dbtypes.UserIdentity} userIdentity
 * @param {CryptoKey} publicKey
 * @param {CryptoKey|null} privateKey
 */
export const setUserIdentity = async (ystream, userIdentity, publicKey, privateKey) => {
  const deviceIdentity = await ystream.transact(async tr => {
    console.log(ystream.clientid, 'setting user identity', userIdentity.ekey)
    tr.objects.user.set('public', publicKey)
    privateKey && tr.objects.user.set('private', privateKey)
    tr.tables.users.add(userIdentity)
    tr.objects.user.set('identity', userIdentity)
    ystream.user = userIdentity
    if (privateKey) {
      return /** @type {dbtypes.DeviceIdentity} */ (await tr.objects.device.get('identity'))
    }
    return null
  })
  if (deviceIdentity != null) {
    const claim = await createDeviceClaim(ystream, deviceIdentity)
    await useDeviceClaim(ystream, claim)
  }
}

export const createUserIdentity = async ({ extractable = false } = {}) => {
  const { publicKey, privateKey } = await ecdsa.generateKeyPair({ extractable })
  const userIdentity = new dbtypes.UserIdentity(json.stringify(await ecdsa.exportKeyJwk(publicKey)))
  return { userIdentity, publicKey, privateKey }
}

/**
 * @note this function must not be awaited inside of a ystream.transact, as it must create its own
 * transaction.
 *
 * @param {Ystream} ystream
 * @param {dbtypes.DeviceIdentity} deviceIdentity
 */
export const createDeviceClaim = async (ystream, deviceIdentity) => {
  const { pkey, iss, sub } = await ystream.transact(async tr => {
    const [privateUserKey, user] = await promise.all([
      tr.objects.user.get('private'),
      tr.objects.user.get('identity')
    ])
    if (privateUserKey == null || user == null) error.unexpectedCase()
    return { pkey: privateUserKey.key, iss: user.ekey, sub: deviceIdentity.ekey }
  })
  // @todo add type definition to isodb.jwtValue
  // @todo add expiration date `exp`
  return await jose.encodeJwt(pkey, {
    iss,
    iat: time.getUnixTime(),
    sub
  })
}

/**
 * Register user, allowing him to connect to this instance.
 *
 * @param {Ystream} ystream
 * @param {dbtypes.UserIdentity} user
 * @param {Object} opts
 * @param {boolean} [opts.isTrusted]
 */
export const registerUser = (ystream, user, { isTrusted = false } = {}) =>
  ystream.transact(async tr => {
    if ((await tr.tables.users.indexes.hash.get(user.hash)) == null) {
      await tr.tables.users.add(new dbtypes.UserIdentity(user.ekey, { isTrusted }))
    }
  })

/**
 * Checks whether a user is registered in this database.
 *
 * @param {Ystream} ystream
 * @param {dbtypes.UserIdentity} user
 */
export const isRegisteredUser = (ystream, user) =>
  ystream.transact(tr =>
    tr.tables.users.indexes.hash.get(user.hash)
      .then(ruser => ruser?.ekey === user.ekey)
  )

/**
 * Checks whether a user is registered in this database.
 *
 * @param {Ystream} ystream
 * @param {dbtypes.UserIdentity} user
 */
export const getRegisteredUser = (ystream, user) =>
  ystream.transact(tr =>
    tr.tables.users.indexes.hash.get(user.hash)
  )

/**
 * @param {Ystream} ystream
 * @param {Uint8Array} userHash
 * @param {string} jwt
 * @return {Promise<import('../api/dbtypes.js').JwtDeviceClaim | null>}
 */
export const verifyDeviceClaim = async (ystream, userHash, jwt) => {
  const user = await ystream.transact(tr =>
    tr.tables.users.indexes.hash.get(userHash)
  )
  if (user == null) return null
  const { payload } = await jose.verifyJwt(await user.publicKey, jwt)
  if (payload.sub !== user.ekey) {
    return null
  }
  return payload
}

/**
 * @param {Ystream} ystream
 * @param {Uint8Array} userHash
 * @param {dbtypes.DeviceClaim} claim
 */
export const registerDevice = async (ystream, userHash, claim) => {
  const user = await ystream.transact(tr =>
    tr.tables.users.indexes.hash.get(userHash)
  )
  if (user == null) error.unexpectedCase()
  await verifyDeviceClaim(ystream, claim.hash, claim.v)
  await ystream.transact(tr =>
    tr.tables.devices.add(claim)
  )
}

/**
 * @param {Ystream} ystream
 * @param {string} jwt
 */
export const useDeviceClaim = async (ystream, jwt) => {
  /**
   * @type {any}
   */
  let payload
  const userPublicKey = await ystream.transact(tr => tr.objects.user.get('public'))
  if (userPublicKey != null) {
    payload = await jose.verifyJwt(userPublicKey.key, jwt)
  } else {
    payload = jose.unsafeDecode(jwt)
  }
  const { payload: { sub, iss } } = payload
  if (userPublicKey == null) {
    // ensure that the user identity is set using the public key of the jwt
    const user = new dbtypes.UserIdentity(iss)
    await setUserIdentity(ystream, user, await user.publicKey, null)
  }
  if (sub == null) error.unexpectedCase()
  await ystream.transact(async tr => {
    // Don't call the constructor manually. This is okay only here. Use DeviceClaim.fromJwt
    // instead.
    const deviceclaim = new dbtypes.DeviceClaim(jwt, sha256.digest(string.encodeUtf8(sub)))
    tr.objects.device.set('claim', deviceclaim)
    tr.tables.devices.add(deviceclaim)
    ystream.deviceClaim = deviceclaim
    ystream.isAuthenticated = true
  })
  ystream.emit('authenticate', []) // should only be fired on deviceclaim
}

/**
 * @param {Ystream} ystream
 */
export const getDeviceIdentity = ystream =>
  ystream.transact(async tr => {
    const did = await tr.objects.device.get('identity')
    if (did == null) error.unexpectedCase()
    return did
  })

/**
 * @param {Ystream} ystream
 */
export const getUserIdentity = ystream =>
  ystream.transact(async tr => {
    const uid = await tr.objects.user.get('identity')
    if (uid == null) error.unexpectedCase()
    return uid
  })

/**
 * @param {Ystream} ystream
 */
export const getAllRegisteredUserHashes = ystream => ystream.transact(async tr => {
  const users = await tr.tables.users.getValues()
  return users.map(user => new Uint8Array(user.hash))
})
