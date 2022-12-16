/**
 * Communication channel API
 */

import * as error from 'lib0/error'
import * as protocol from './protocol.js'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'

/**
 * @typedef {import('./ops.js').OpValue} OpValue
 */

/**
 * Interface that describes a peer that can receive messages
 * @interface
 */
export class Peer {
  /**
   * @param {Uint8Array} _message
   * @param {Peer} _peer
   */
  receive (_message, _peer) {
    error.methodUnimplemented()
  }
}

/**
 * Interface that describes a communication channel.
 * @interface
 */
export class Comm extends Peer {
  /**
   * @param {Array<OpValue>} _ops
   */
  broadcast (_ops) {
    error.methodUnimplemented()
  }
}

/**
 * @type {Set<Comm>}
 */
const localInstances = new Set()

/**
 * Implementation of Comm for testing purposes. Syncs instances in the same thread.
 *
 * @implements Comm
 */
export class MockComm {
  /**
   * @param {import('./ydb.js').Ydb} ydb
   */
  constructor (ydb) {
    localInstances.add(this)
    this.ydb = ydb
  }

  /**
   * @param {Array<OpValue>} ops
   */
  broadcast (ops) {
    const message = protocol.encodeMessage(encoder => protocol.writeOps(encoder, ops))
    localInstances.forEach(comm => {
      comm.receive(message, this)
    })
  }

  /**
   * @param {Uint8Array} message
   * @param {Peer} peer
   */
  receive (message, peer) {
    const reply = protocol.readMessage(decoding.createDecoder(message), this.ydb)
    if (reply) {
      peer.receive(encoding.toUint8Array(reply), this)
    }
  }
}
