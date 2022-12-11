import { Ydb } from './index.js' // eslint-disable-line
import * as opTypes from './ops.js'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

const messageOps = 0

/**
 * @param {encoding.Encoder} encoder
 * @param {Array<opTypes.OpValue>} ops
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
export const readOps = (decoder, ydb) => {
  const numOfOps = decoding.readVarUint(decoder)
  /**
   * @type {Array<opTypes.OpValue>}
   */
  const ops = []
  for (let i = 0; i < numOfOps; i++) {
    const op = /** @type {opTypes.OpValue} */ (opTypes.OpValue.decode(decoder))
    ops.push(op)
  }
  ydb.applyOps(ops)
}
