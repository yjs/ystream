import { Ystream } from './index.js' // eslint-disable-line
import * as dbtypes from './dbtypes.js'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as error from 'lib0/error'
import * as array from 'lib0/array'
import * as actions from './actions.js'
import * as logging from 'lib0/logging'
import * as authentication from './api/authentication.js'
import * as buffer from 'lib0/buffer'
import * as jose from 'lib0/crypto/jwt'
import * as sha256 from 'lib0/hash/sha256'
import * as string from 'lib0/string'

const _log = logging.createModuleLogger('@y/stream/protocol')
/**
 * @param {Ystream} ystream
 * @param {import('./comm.js').Comm} comm
 * @param {string} type
 * @param {...any} args
 */
const log = (ystream, comm, type, ...args) => _log(logging.PURPLE, `(local=${ystream.clientid.toString(36).slice(0, 4)},remote=${comm.clientid.toString(36).slice(0, 4)}${ystream.syncsEverything ? ',server=true' : ''}) `, logging.ORANGE, '[' + type + '] ', logging.GREY, ...args.map(arg => typeof arg === 'function' ? arg() : arg))

const messageOps = 0
const messageRequestOps = 1
const messageSynced = 2
const messageSyncedAll = 3
const messageInfo = 4 // first message
const messageChallengeAnswer = 5 // second message

/**
 * @param {encoding.Encoder} encoder
 * @param {Array<dbtypes.OpValue>} ops
 */
export const writeOps = (encoder, ops) => {
  encoding.writeUint8(encoder, messageOps)
  encoding.writeVarUint(encoder, ops.length)
  ops.forEach(op => {
    op.encode(encoder)
  })
}

/**
 * @param {decoding.Decoder} decoder
 * @param {Ystream} ystream
 * @param {import('./comm.js').Comm} comm
 */
const readOps = (decoder, ystream, comm) => {
  const numOfOps = decoding.readVarUint(decoder)
  /**
   * @type {Array<dbtypes.OpValue>}
   */
  const ops = []
  for (let i = 0; i < numOfOps; i++) {
    ops.push(/** @type {dbtypes.OpValue} */ (dbtypes.OpValue.decode(decoder)))
  }
  log(ystream, comm, 'Ops', `received ${ops.length} ops. decoderlen=${decoder.arr.length}. first: clock=${ops[0].clock},client=${ops[0].client}`)
  if (comm.user == null) {
    error.unexpectedCase()
  }
  return actions.applyRemoteOps(ystream, ops, comm.user, comm)
}

/**
 * @param {encoding.Encoder} encoder
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {number} nextClock
 */
export const writeSynced = (encoder, owner, collection, nextClock) => {
  encoding.writeUint8(encoder, messageSynced)
  encoding.writeVarUint8Array(encoder, owner)
  encoding.writeVarString(encoder, collection)
  encoding.writeVarUint(encoder, nextClock)
}

/**
 * @param {encoding.Encoder} encoder
 * @param {number} nextClock
 */
export const writeSyncedAll = (encoder, nextClock) => {
  encoding.writeUint8(encoder, messageSyncedAll)
  encoding.writeVarUint(encoder, nextClock)
}

/**
 * @param {encoding.Encoder} _encoder
 * @param {decoding.Decoder} decoder
 * @param {Ystream} ystream
 * @param {import('./comm.js').Comm|null} comm
 */
const readSynced = async (_encoder, decoder, ystream, comm) => {
  const owner = decoding.readVarUint8Array(decoder)
  const collection = decoding.readVarString(decoder)
  decoding.readVarUint(decoder) // confirmed clock
  if (comm == null) return
  comm.synced.add(owner, collection)
  const ycol = ystream.getCollection(buffer.toBase64(owner), collection)
  if (ycol != null && !ycol.isSynced) {
    ycol.isSynced = true
    ycol.emit('sync', [])
    log(ystream, comm, 'Synced', `synced "${collection}" .. emitted sync event`)
  }
}

/**
 * @param {encoding.Encoder} _encoder
 * @param {decoding.Decoder} decoder
 * @param {Ystream} ystream
 * @param {import('./comm.js').Comm|null} comm
 */
const readSyncedAll = async (_encoder, decoder, ystream, comm) => {
  decoding.readVarUint(decoder) // confirmed clock
  if (comm == null) return
  ystream.collections.forEach(c => {
    c.forEach(ycol => {
      ycol.isSynced = true
      ycol.emit('sync', [])
    })
  })
  log(ystream, comm, 'Synced', 'synced "*" collections .. emitted sync event')
}

/**
 * @param {encoding.Encoder} encoder
 * @param {Uint8Array} owner
 * @param {string} collection
 * @param {number} clock
 */
export const writeRequestOps = (encoder, owner, collection, clock) => {
  encoding.writeUint8(encoder, messageRequestOps)
  encoding.writeUint8(encoder, 1) // requesting specific ops
  encoding.writeVarUint8Array(encoder, owner)
  encoding.writeVarString(encoder, collection)
  encoding.writeVarUint(encoder, clock)
}

/**
 * @param {encoding.Encoder} encoder
 * @param {number} clock
 */
export const writeRequestAllOps = (encoder, clock) => {
  encoding.writeUint8(encoder, messageRequestOps)
  encoding.writeUint8(encoder, 0) // request all ops
  encoding.writeVarUint(encoder, clock)
}

/**
 * @param {decoding.Decoder} decoder
 * @param {Ystream} ystream
 * @param {import('./comm.js').Comm} comm - this is used to subscribe to messages
 */
const readRequestOps = async (decoder, ystream, comm) => {
  const requestedAllOps = decoding.readUint8(decoder) === 0
  let owner = null
  let collection = null
  let nextClock = 0
  if (requestedAllOps) {
    nextClock = decoding.readVarUint(decoder)
    log(ystream, comm, 'RequestOps', 'requested all ops')
  } else {
    // requested only a single collection
    owner = decoding.readVarUint8Array(decoder)
    collection = decoding.readVarString(decoder)
    nextClock = decoding.readVarUint(decoder)
    log(ystream, comm, 'RequestOps', `requested "${collection}"`)
  }
  console.log(ystream.clientid, 'subscribing conn to ops', { fcid: comm.clientid, collection, owner })
  // @todo add method to filter by owner & collection
  actions.createOpsReader(ystream, nextClock, owner, collection).pipeTo(comm.writer, { signal: comm.streamController.signal }).catch((reason) => {
    console.log('ended pipe', { reason, isDestroyed: comm.isDestroyed })
  })
}

/**
 * @todo should contain device auth, exchange of certificates, some verification by challenge, ..
 * @param {encoding.Encoder} encoder
 * @param {Ystream} ystream
 * @param {import('./comm.js').Comm} comm - this is used to subscribe to messages
 */
export const writeInfo = (encoder, ystream, comm) => {
  encoding.writeUint8(encoder, messageInfo)
  encoding.writeVarUint(encoder, ystream.clientid)
  if (ystream.user == null || ystream.deviceClaim == null) {
    error.unexpectedCase()
  }
  ystream.user.encode(encoder)
  ystream.deviceClaim.encode(encoder)
  // challenge that the other user must sign using the device's private key
  encoding.writeVarUint8Array(encoder, comm.challenge)
}

/**
 * @todo maybe rename to SyncStep1?
 * @param {encoding.Encoder} encoder
 * @param {decoding.Decoder} decoder
 * @param {import('./comm.js').Comm} comm
 * @param {Ystream} ystream
 */
const readInfo = async (encoder, decoder, ystream, comm) => {
  const clientid = decoding.readVarUint(decoder)
  // @todo user only has to be submitted, if we want to register a new user. For now, we simply
  // always send the user identity in all initial requests.
  const user = dbtypes.UserIdentity.decode(decoder)
  const deviceClaim = dbtypes.DeviceClaim.decode(decoder)
  const challenge = decoding.readVarUint8Array(decoder)
  const registeredUser = await authentication.getRegisteredUser(ystream, user)
  comm.clientid = clientid
  comm.user = registeredUser || user
  // @todo 1. read device claim and verify it
  comm.deviceClaim = deviceClaim
  if (!array.equalFlat(user.hash, sha256.digest(string.encodeUtf8(deviceClaim.unsafeDecode().payload.iss)))) {
    log(ystream, comm, 'InfoRejected', 'rejecting comm because client hash doesn\'t match with device claim', '\n', user.hash, deviceClaim.hash)
    error.unexpectedCase()
  }
  if (registeredUser == null) {
    if (ystream.acceptNewUsers) {
      await authentication.registerUser(ystream, user)
    } else {
      log(ystream, comm, 'destroying', 'User not registered')
      comm.destroy()
      return
    }
  }
  const parsedClaim = await deviceClaim.verify(await user.publicKey)
  if (parsedClaim.payload.iss !== user.ekey) {
    comm.destroy()
    error.unexpectedCase()
  }
  await ystream.transact(async tr => {
    const currClaim = await tr.tables.devices.indexes.hash.get(deviceClaim.hash)
    if (currClaim == null) {
      await tr.tables.devices.add(deviceClaim)
    }
  })
  // @todo send some kind of challenge
  log(ystream, comm, 'Info Challenge', () => Array.from(challenge))
  await writeChallengeAnswer(encoder, ystream, challenge, comm)
}

/**
 * @param {decoding.Decoder} decoder
 * @param {import('./comm.js').Comm} comm
 */
const readChallengeAnswer = async (decoder, comm) => {
  const deviceClaim = comm.deviceClaim
  if (deviceClaim == null) {
    error.unexpectedCase()
  }
  const jwt = decoding.readVarString(decoder)
  const { payload: { sub } } = await jose.verifyJwt(await deviceClaim.dpkey, jwt)
  if (sub !== buffer.toBase64(comm.challenge)) {
    throw new Error('Wrong challenge')
  }
  comm.isAuthenticated = true
  if (comm.sentChallengeAnswer) comm.emit('authenticated', [comm])
}

/**
 * @todo should contain device auth, exchange of certificates, some verification by challenge, ..
 * @param {encoding.Encoder} encoder
 * @param {Ystream} ystream
 * @param {Uint8Array} challenge - this is used to subscribe to messages
 * @param {import('./comm.js').Comm} comm - this is used to subscribe to messages
 */
export const writeChallengeAnswer = async (encoder, ystream, challenge, comm) => {
  encoding.writeUint8(encoder, messageChallengeAnswer)
  await ystream.transact(async tr => {
    const pk = await tr.objects.device.get('private')
    if (pk == null) error.unexpectedCase()
    const jwt = await jose.encodeJwt(pk.key, {
      sub: buffer.toBase64(challenge)
    })
    encoding.writeVarString(encoder, jwt)
  })
  comm.sentChallengeAnswer = true
  if (comm.isAuthenticated) comm.emit('authenticated', [comm])
}

/**
 * @param {encoding.Encoder} encoder
 * @param {decoding.Decoder} decoder
 * @param {Ystream} ystream
 * @param {import('./comm.js').Comm} comm - this is used to set the "synced" property
 */
export const readMessage = async (encoder, decoder, ystream, comm) => {
  try {
    do {
      const messageType = decoding.readUint8(decoder)
      if (messageType === messageInfo) {
        await readInfo(encoder, decoder, ystream, comm)
      } else if (messageType === messageChallengeAnswer) {
        await readChallengeAnswer(decoder, comm)
      } else {
        if (comm.deviceClaim == null || comm.user == null || !comm.isAuthenticated) {
          log(ystream, comm, 'closing unauthenticated connection')
          comm.destroy()
        }
        switch (messageType) {
          case messageOps: {
            await readOps(decoder, ystream, comm)
            break
          }
          case messageRequestOps: {
            await readRequestOps(decoder, ystream, comm)
            break
          }
          case messageSynced: {
            await readSynced(encoder, decoder, ystream, comm)
            break
          }
          case messageSyncedAll: {
            await readSyncedAll(encoder, decoder, ystream, comm)
            break
          }
          /* c8 ignore next 3 */
          default:
            // Unknown message-type
            error.unexpectedCase()
        }
      }
    } while (decoding.hasContent(decoder))
    if (encoding.hasContent(encoder)) {
      return encoder
    }
    return null
  } catch (err) {
    log(ystream, comm, 'Info rejection', 'Closing connection because of unexpected error', /** @type {Error} */ (err).stack)
    comm.destroy()
  }
}
