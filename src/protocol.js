import { Ydb } from './index.js' // eslint-disable-line
import * as dbtypes from './dbtypes.js'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as error from 'lib0/error'
import * as array from 'lib0/array'
import * as actions from './actions.js'
import * as map from 'lib0/map'
import * as promise from 'lib0/promise'
import * as logging from 'lib0/logging'

const _log = logging.createModuleLogger('ydb/protocol')
/**
 * @param {Ydb} ydb
 * @param {import('./comm.js').Comm} comm
 * @param {string} type
 * @param {...any} args
 */
const log = (ydb, comm, type, ...args) => _log(logging.PURPLE, `(local=${ydb.clientid.toString(36).slice(0, 4)},remote=${comm.clientid.toString(36).slice(0, 4)}) `, logging.ORANGE, '[' + type + '] ', logging.GREY, ...args)

const messageOps = 0
const messageRequestOps = 1
const messageSynced = 2
const messageInfo = 3

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
 * @param {Ydb} ydb
 * @param {import('./comm.js').Comm} comm
 */
const readOps = (decoder, ydb, comm) => {
  const numOfOps = decoding.readVarUint(decoder)
  /**
   * @type {Array<dbtypes.OpValue>}
   */
  const ops = []
  for (let i = 0; i < numOfOps; i++) {
    ops.push(/** @type {dbtypes.OpValue} */ (dbtypes.OpValue.decode(decoder)))
  }
  log(ydb, comm, 'Ops', `received ${ops.length} ops`)
  return actions.applyRemoteOps(ydb, ops)
}

/**
 * @param {encoding.Encoder} encoder
 * @param {string} collection
 * @param {number} nextClock
 */
export const writeSynced = (encoder, collection, nextClock) => {
  encoding.writeUint8(encoder, messageSynced)
  encoding.writeVarString(encoder, collection)
  encoding.writeVarUint(encoder, nextClock)
}

/**
 * @param {encoding.Encoder} _encoder
 * @param {decoding.Decoder} decoder
 * @param {Ydb} ydb
 * @param {import('./comm.js').Comm|null} comm
 */
const readSynced = async (_encoder, decoder, ydb, comm) => {
  const collection = decoding.readVarString(decoder) // collection
  decoding.readVarUint(decoder) // confirmed clock
  if (comm == null) return
  comm.synced.add(collection)
  ydb.syncedCollections.add(collection)
  if (ydb.isSynced) return
  if (collection === '*' || array.from(ydb.collections.keys()).every(cname => ydb.syncedCollections.has(cname))) {
    ydb.isSynced = true
    log(ydb, comm, 'Synced', `synced "${collection}" .. emitted sync event`)
    ydb.emit('sync', [])
  } else {
    log(ydb, comm, 'Synced', ` synced "${collection}" .. waiting for other collections`)
  }
}

/**
 * @param {encoding.Encoder} encoder
 * @param {string} collection Use "*" to request all collections
 * @param {number} clock
 */
export const writeRequestOps = (encoder, collection, clock) => {
  encoding.writeUint8(encoder, messageRequestOps)
  encoding.writeVarString(encoder, collection)
  encoding.writeVarUint(encoder, clock)
}

/**
 * @param {Ydb} ydb
 * @param {import('./comm.js').Comm} comm - this is used to subscribe to messages
 * @param {string} collection
 * @param {number} nextExpectedClock
 */
const _subscribeConnToOps = (ydb, comm, collection, nextExpectedClock) => {
  /**
   * @param {Array<dbtypes.OpValue>} ops
   * @param {boolean} _isSynced
   */
  const opsConsumer = (ops, _isSynced) => {
    if (comm.isDestroyed) {
      ydb.off('ops', opsConsumer)
      return
    }
    if (collection !== '*') ops = ops.filter(op => op.collection === collection)
    if (ops.length > 0) {
      comm.send(encoding.encode(encoder =>
        writeOps(encoder, ops)
      ))
    }
  }
  ydb.consumeOps(nextExpectedClock, opsConsumer)
}

/**
 * @param {encoding.Encoder} encoder
 * @param {decoding.Decoder} decoder
 * @param {Ydb} ydb
 * @param {import('./comm.js').Comm} comm - this is used to subscribe to messages
 */
const readRequestOps = async (encoder, decoder, ydb, comm) => {
  const collection = decoding.readVarString(decoder)
  const clock = decoding.readVarUint(decoder)
  const ops = await (collection === '*' ? actions.getOps(ydb, clock) : actions.getCollectionOps(ydb, collection, clock))
  log(ydb, comm, 'RequestOps', `requested "${collection}"`)
  const nextExpectedClock = ops.length > 0 ? ops[ops.length - 1].clock + 1 : 0
  ops.length > 0 && writeOps(encoder, ops)
  writeSynced(encoder, collection, nextExpectedClock)
  // this needs to be handled by a separate function, so the observer doesn't keep the above
  // variables in scope
  _subscribeConnToOps(ydb, comm, collection, nextExpectedClock)
}

/**
 * @todo should contain device auth, exchange of certificates, some verification by challenge, ..
 * @param {encoding.Encoder} encoder
 * @param {Ydb} ydb
 */
export const writeInfo = (encoder, ydb) => {
  encoding.writeUint8(encoder, messageInfo)
  encoding.writeVarUint(encoder, ydb.clientid)
}

/**
 * @todo maybe rename to SyncStep1?
 * @param {encoding.Encoder} encoder
 * @param {decoding.Decoder} decoder
 * @param {import('./comm.js').Comm} comm
 * @param {Ydb} ydb
 */
const readInfo = async (encoder, decoder, ydb, comm) => {
  const clientid = decoding.readVarUint(decoder)
  comm.clientid = clientid
  log(ydb, comm, 'Info', ydb.syncsEverything)
  // we respond by asking for the registered collejtions
  if (ydb.syncsEverything) {
    const clock = await actions.getClock(ydb, clientid, null)
    writeRequestOps(encoder, '*', clock)
  } else {
    await ydb.db.transact(() =>
      promise.all(map.map(ydb.collections, (_, collectionname) =>
        actions.getClock(ydb, clientid, collectionname).then(clock => {
          writeRequestOps(encoder, collectionname, clock)
          return clock
        })
      ))
    )
  }
}

/**
 * @param {encoding.Encoder} encoder
 * @param {decoding.Decoder} decoder
 * @param {Ydb} ydb
 * @param {import('./comm.js').Comm} comm - this is used to set the "synced" property
 */
export const readMessage = async (encoder, decoder, ydb, comm) => {
  do {
    const messageType = decoding.readUint8(decoder)
    switch (messageType) {
      case messageOps: {
        await readOps(decoder, ydb, comm)
        break
      }
      case messageRequestOps: {
        await readRequestOps(encoder, decoder, ydb, comm)
        break
      }
      case messageSynced: {
        await readSynced(encoder, decoder, ydb, comm)
        break
      }
      case messageInfo: {
        await readInfo(encoder, decoder, ydb, comm)
        break
      }
      /* c8 ignore next 3 */
      default:
        // Unknown message-type
        error.unexpectedCase()
    }
  } while (decoding.hasContent(decoder))
  if (encoding.hasContent(encoder)) {
    return encoder
  }
  return null
}
