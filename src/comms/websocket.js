import { WebSocket } from 'ydb/utils/websocket'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as protocol from '../protocol.js'
import * as queue from 'lib0/queue'
import { ObservableV2 } from 'lib0/observable'
import * as math from 'lib0/math'
import * as comm from '../comm.js' // eslint-disable-line
import { Ydb } from '../ydb.js' // eslint-disable-line
import * as dbtypes from '../dbtypes.js' // eslint-disable-line

/**
 * @param {WebSocketCommInstance} comm
 */
const setupWS = comm => {
  if (comm.shouldConnect && comm.ws === null) {
    const websocket = new WebSocket(comm.url)
    comm.ws = websocket
    websocket.binaryType = 'arraybuffer'
    comm.ws = websocket
    comm.wsconnecting = true
    comm.wsconnected = false
    comm.synced = false

    websocket.onmessage = (event) => {
      addReadMessage(comm, new Uint8Array(event.data))
    }
    websocket.onerror = (event) => {
      comm.emit('connection-error', [/** @type {ErrorEvent} */(event), comm])
    }
    websocket.onclose = (event) => {
      comm._readMessageQueue = queue.create()
      comm.ws = null
      comm.wsconnecting = false
      if (comm.wsconnected) {
        comm.wsconnected = false
        comm.synced = false
        comm.emit('status', [{
          status: 'disconnected'
        }, comm])
      } else {
        comm.wsUnsuccessfulReconnects++
      }
      comm.emit('connection-close', [event, comm])
      // Start with no reconnect timeout and increase timeout by
      // using exponential backoff starting with 100ms
      setTimeout(
        setupWS,
        math.min(
          math.pow(2, comm.wsUnsuccessfulReconnects) * 100,
          comm.maxBackoffTime
        ),
        comm
      )
    }
    websocket.onopen = () => {
      comm.wsconnecting = false
      comm.wsconnected = true
      comm.wsUnsuccessfulReconnects = 0
      websocket.send(encoding.encode(encoder => protocol.writeInfo(encoder, comm.ydb)))
      comm.emit('status', [{
        status: 'connected'
      }, comm])
    }
    comm.emit('status', [{
      status: 'connecting'
    }, comm])
  }
}

/**
 * @param {WebSocketCommInstance} comm
 * @param {Uint8Array} m
 */
const addReadMessage = async (comm, m) => {
  const readMessageQueue = comm._readMessageQueue
  const wasEmpty = queue.isEmpty(readMessageQueue)
  queue.enqueue(readMessageQueue, new queue.QueueValue(m))
  if (!wasEmpty) return
  while (true) {
    const m = queue.dequeue(readMessageQueue)
    if (m === null) break
    const reply = await protocol.readMessage(encoding.createEncoder(), decoding.createDecoder(m.v), comm.ydb, comm)
    if (reply) {
      comm.ws?.send(encoding.toUint8Array(reply).buffer)
    }
  }
}

/**
 * Implementation of Comm for testing purposes. Syncs instances in the same thread.
 *
 * @implements comm.Comm
 * @extends ObservableV2<{ synced: function(WebSocketCommInstance):any, "connection-error": function(ErrorEvent, WebSocketCommInstance):any, "connection-close": function(CloseEvent, WebSocketCommInstance):any, status: function({ status: 'connecting'|'connected'|'disconnected' }, WebSocketCommInstance):any }>
 */
class WebSocketCommInstance extends ObservableV2 {
  /**
   * @param {import('../ydb.js').Ydb} ydb
   * @param {string} url
   */
  constructor (ydb, url) {
    super()
    this.synced = false
    this.comm = true
    this.ydb = ydb
    this.url = url
    /**
     * @type {WebSocket|null}
     */
    this.ws = null
    this.shouldConnect = true
    this.wsconnecting = false
    this.wsconnected = false
    this.wsUnsuccessfulReconnects = 0
    this.synced = false
    this.maxBackoffTime = 60000
    /**
     * @type {queue.Queue<queue.QueueValue<Uint8Array>>}
     */
    this._readMessageQueue = queue.create()
    setupWS(this)
    ydb.comms.add(this)
  }

  destroy () {
    this.shouldConnect = false
    this.wsconnected = false
    this.wsconnecting = false
    this.ws?.close() // close code 1000 - normal end of connection
    this.ydb.comms.delete(this)
  }

  /**
   * @todo this should only be called once we know this connection is synced and that ops is the
   * next expected op. Otherwise, fall back to unsynced and sync all local ops to backend.
   * @param {Array<dbtypes.OpValue>} ops
   */
  broadcast (ops) {
    const message = encoding.encode(encoder => protocol.writeOps(encoder, ops))
    if (this.ws && this.wsconnected) {
      // otherwise, the message is going to be synced by the sync protocol
      this.ws.send(message)
    }
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
export class WebSocketComm {
  /**
   * @param {string} url
   */
  constructor (url) {
    this.url = url
  }

  /**
   * @param {Ydb} ydb
   */
  init (ydb) {
    return new WebSocketCommInstance(ydb, this.url)
  }
}
