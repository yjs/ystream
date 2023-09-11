import { WebSocket } from 'ydb/utils/websocket'
import * as dbtypes from '../dbtypes.js'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as comm from '../comm.js'
import { Ydb } from '../ydb'
import * as protocol from '../protocol.js'

class WSConn {
  /**
   * @param {string} url
   */
  constructor (url) {
    this.ws = new WebSocket(url)
  }
}

/**
 * Implementation of Comm for testing purposes. Syncs instances in the same thread.
 *
 * @implements comm.Comm
 */
class WebSocketCommInstance {
  /**
   * @param {import('../ydb.js').Ydb} ydb
   */
  constructor (ydb) {
    this.synced = false
    this.comm = true
    this.ydb = ydb
    ydb.comms.add(this)
  }

  destroy () {
    this.ydb.comms.delete(this)
  }

  /**
   * @todo this should only be called once we know this connection is synced and that ops is the
   * next expected op. Otherwise, fall back to unsynced and sync all local ops to backend.
   * @param {Array<dbtypes.OpValue>} ops
   */
  broadcast (ops) {
    const x = ops[0]
    const message = encoding.encode(encoder => protocol.writeOps(encoder, ops))
    this.ws.send(message)
  }

  /**
   * @todo is this even necessary?
   * @param {Uint8Array} message
   * @param {comm.Peer} peer
   */
  async receive (message, peer) {
    const reply = await protocol.readMessage(encoding.createEncoder(), decoding.createDecoder(message), this.ydb, this)
    if (reply) {
      peer.receive(encoding.toUint8Array(reply), this)
    }
  }
}

/**
 * @implements {comm.CommConfiguration}
 */
export class MockComm {
  /**
   * @param {Ydb} ydb
   */
  init (ydb) {
    return new WebSocketCommInstance(ydb)
  }
}
