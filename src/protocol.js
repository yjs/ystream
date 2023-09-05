import { Ydb } from './index.js' // eslint-disable-line
import * as dbtypes from './dbtypes.js'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as error from 'lib0/error'
import * as array from 'lib0/array'
import * as actions from './actions.js'

const messageOps = 0
const messageRequestOps = 1
const messageSynced = 2

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
 */
const readOps = (decoder, ydb) => {
  const numOfOps = decoding.readVarUint(decoder)
  /**
   * @type {Array<dbtypes.OpValue>}
   */
  const ops = []
  for (let i = 0; i < numOfOps; i++) {
    ops.push(/** @type {dbtypes.OpValue} */ (dbtypes.OpValue.decode(decoder)))
  }
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
  decoding.readVarString(decoder) // collection
  decoding.readVarUint(decoder) // confirmed clock
  if (comm == null) return
  comm.synced = true
  // @todo this should only fire sync if all Comms are synced
  if (array.from(ydb.comms.values()).every(comm => comm.synced)) {
    ydb.emit('sync', [])
  }
}

/**
 * @param {encoding.Encoder} encoder
 * @param {string} collection
 * @param {number} clock
 */
export const writeRequestOps = (encoder, collection, clock) => {
  encoding.writeUint8(encoder, messageRequestOps)
  encoding.writeVarString(encoder, collection)
  encoding.writeVarUint(encoder, clock)
}

/**
 * @param {encoding.Encoder} encoder
 * @param {decoding.Decoder} decoder
 * @param {Ydb} ydb
 */
const readRequestOps = async (encoder, decoder, ydb) => {
  const collection = decoding.readVarString(decoder)
  const clock = decoding.readVarUint(decoder)
  const ops = await actions.getCollectionOps(ydb, collection, clock)
  writeOps(encoder, ops)
  writeSynced(encoder, collection, ops.length > 0 ? ops[ops.length - 1].clock + 1 : 0)
}

/**
 * @param {encoding.Encoder} encoder
 * @param {decoding.Decoder} decoder
 * @param {Ydb} ydb
 * @param {import('./comm.js').Comm|null} comm - this is used to set the "synced" property
 */
export const readMessage = async (encoder, decoder, ydb, comm) => {
  do {
    const messageType = decoding.readUint8(decoder)
    switch (messageType) {
      case messageOps: {
        await readOps(decoder, ydb)
        break
      }
      case messageRequestOps: {
        await readRequestOps(encoder, decoder, ydb)
        break
      }
      case messageSynced: {
        await readSynced(encoder, decoder, ydb, comm)
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
