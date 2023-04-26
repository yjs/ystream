/**
 * Communication channel API
 */

import * as error from 'lib0/error'
import * as protocol from './protocol.js'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'

/**
 * @typedef {import('./ydb.js').Ydb} Ydb
 */

/**
 * @typedef {import('./dbtypes.js').OpValue} OpValue
 */

/* c8 ignore start */
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
/* c8 ignore end */

/* c8 ignore start */
/**
 * Interface that describes a communication channel.
 * @interface
 */
export class Comm extends Peer {
  get synced () { return false }
  set synced (_v) { error.methodUnimplemented() }

  /**
   * @param {Array<OpValue>} _ops
   */
  broadcast (_ops) {
    error.methodUnimplemented()
  }
}
/* c8 ignore end */

/* c8 ignore start */
/**
 * @interface
 */
export class CommConfiguration {
  /**
   * @param {Ydb} _ydb
   * @return {Comm}
   */
  init (_ydb) {
    error.methodUnimplemented()
  }
}
/* c8 ignore end */

/**
 * @type {Set<Comm>}
 */
const localInstances = new Set()

/**
 * Implementation of Comm for testing purposes. Syncs instances in the same thread.
 *
 * @implements Comm
 */
class MockCommInstance {
  /**
   * @param {import('./ydb.js').Ydb} ydb
   */
  constructor (ydb) {
    this.synced = false
    this.comm = true
    this.ydb = ydb
    ydb.comms.add(this)
    localInstances.forEach(comm => {
      comm.receive(protocol.encodeMessage(encoder => protocol.writeRequestOps(encoder, 0)), this)
      this.receive(protocol.encodeMessage(encoder => protocol.writeRequestOps(encoder, 0)), comm)
    })
    localInstances.add(this)
  }

  destroy () {
    localInstances.delete(this)
    this.ydb.comms.delete(this)
  }

  /**
   * @param {Array<OpValue>} ops
   */
  broadcast (ops) {
    const message = protocol.encodeMessage(encoder => protocol.writeOps(encoder, ops))
    localInstances.forEach(comm => {
      // @todo dont broadcast to yourself
      comm.receive(message, this)
    })
  }

  /**
   * @param {Uint8Array} message
   * @param {Peer} peer
   */
  async receive (message, peer) {
    const reply = await protocol.readMessage(decoding.createDecoder(message), this.ydb, this)
    if (reply) {
      peer.receive(encoding.toUint8Array(reply), this)
    }
  }
}

/**
 * @implements {CommConfiguration}
 */
export class MockComm {
  /**
   * @param {Ydb} ydb
   */
  init (ydb) {
    return new MockCommInstance(ydb)
  }
}
