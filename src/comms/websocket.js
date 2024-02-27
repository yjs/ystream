import { WebSocket as WS } from '@y/stream/utils/websocket'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as protocol from '../protocol.js'
import * as queue from 'lib0/queue'
import { ObservableV2 } from 'lib0/observable'
import * as math from 'lib0/math'
import * as comm from '../comm.js' // eslint-disable-line
import * as logging from 'lib0/logging'
import { Ydb } from '../ydb.js' // eslint-disable-line
import * as webcrypto from 'lib0/webcrypto'
import * as utils from '../utils.js'

const _log = logging.createModuleLogger('@y/stream/websocket')
/**
 * @param {WebSocketCommInstance} comm
 * @param {string} type
 * @param {...any} args
 */
const log = (comm, type, ...args) => _log(logging.PURPLE, `(local=${comm.ydb.clientid.toString(36).slice(0, 4)},remote=${comm.clientid.toString(36).slice(0, 4)}) `, logging.ORANGE, '[' + type + '] ', logging.GREY, ...args)

/**
 * @param {WebSocketCommInstance} comm
 */
const setupWS = comm => {
  if (comm.shouldConnect && comm.ws === null) {
    log(comm, 'setup')
    const websocket = new WS(comm.url)
    websocket.binaryType = 'arraybuffer'
    comm.ws = websocket
    comm.wsconnecting = true
    comm.wsconnected = false
    comm.synced.clear()
    websocket.onmessage = (event) => {
      addReadMessage(comm, new Uint8Array(/** @type {ArrayBuffer} */ (event.data)))
    }
    websocket.onerror = /** @param {any} event */ (event) => {
      log(comm, 'error', event)
      comm.emit('connection-error', [/** @type {ErrorEvent} */(event), comm])
    }
    websocket.onclose = (event) => {
      comm._readMessageQueue = queue.create()
      comm.ws = null
      comm.wsconnecting = false
      if (comm.wsconnected) {
        comm.wsconnected = false
        comm.synced.clear()
        comm.emit('status', [{
          status: 'disconnected'
        }, comm])
      } else {
        comm.wsUnsuccessfulReconnects++
      }
      comm.emit('connection-close', [/** @type {any} */(event), comm])
      log(comm, 'close', 'close-code: ', event.code)
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
      log(comm, 'open')
      comm.wsconnecting = false
      comm.wsconnected = true
      comm.wsUnsuccessfulReconnects = 0
      websocket.send(encoding.encode(encoder => protocol.writeInfo(encoder, comm.ydb, comm)))
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
  /**
   * @type {Uint8Array|undefined}
   */
  let currMessage
  while ((currMessage = readMessageQueue.start?.v) != null) {
    const reply = await protocol.readMessage(encoding.createEncoder(), decoding.createDecoder(currMessage), comm.ydb, comm)
    if (reply) {
      comm.send(encoding.toUint8Array(reply))
    }
    queue.dequeue(readMessageQueue)
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
    this.synced = new utils.CollectionsSet()
    this.isDestroyed = false
    this.comm = true
    this.ydb = ydb
    this.url = url
    this.clientid = -1
    this.isAuthenticated = false
    /**
     * @type {import('../dbtypes.js').UserIdentity|null}
     */
    this.user = null
    /**
     * @type {Uint8Array}
     */
    this.challenge = webcrypto.getRandomValues(new Uint8Array(64))
    /**
     * @type {import('../dbtypes.js').DeviceClaim|null}
     */
    this.deviceClaim = null
    /**
     * @type {InstanceType<WS>|null}
     */
    this.ws = null
    this.shouldConnect = true
    this.wsconnecting = false
    this.wsconnected = false
    this.wsUnsuccessfulReconnects = 0
    this.maxBackoffTime = 60000
    /**
     * @type {queue.Queue<queue.QueueValue<Uint8Array>>}
     */
    this._readMessageQueue = queue.create()
    setupWS(this)
    ydb.comms.add(this)
  }

  destroy () {
    log(this, 'destroy', new Error().stack)
    this.isDestroyed = true
    this.shouldConnect = false
    this.wsconnected = false
    this.wsconnecting = false
    this.ws?.close() // close code 1000 - normal end of connection
    this.ydb.comms.delete(this)
  }

  /**
   * @todo this should only be called once we know this connection is synced and that ops is the
   * next expected op. Otherwise, fall back to unsynced and sync all local ops to backend.
   * @param {Uint8Array} message
   */
  send (message) {
    if (this.ws && this.wsconnected) {
      // @todo handle the case that message could not be sent
      this.ws.send(message)
      return
    }
    this.destroy()
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
