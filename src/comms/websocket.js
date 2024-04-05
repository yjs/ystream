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
import * as promise from 'lib0/promise'
import * as dbtypes from '../dbtypes.js' // eslint-disable-line

const _log = logging.createModuleLogger('@y/stream/websocket')
/**
 * @param {WebSocketCommInstance} comm
 * @param {string} type
 * @param {...any} args
 */
const log = (comm, type, ...args) => _log(logging.PURPLE, `(local=${comm.ydb.clientid.toString(36).slice(0, 4)},remote=${comm.clientid.toString(36).slice(0, 4)}) `, logging.ORANGE, '[' + type + '] ', logging.GREY, ...args.map(arg => typeof arg === 'function' ? arg() : arg))

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
 * @implements comm.Comm
 */
class WebSocketCommInstance {
  /**
   * @param {WebSocketHandlerInstance} handler
   */
  constructor (handler) {
    const { ydb, url } = handler
    this.handler = handler
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
     * @type {queue.Queue<queue.QueueValue<Uint8Array>>}
     */
    this._readMessageQueue = queue.create()
    this.streamController = new AbortController()
    this.wsconnected = false
    /**
     * @type {WritableStream<Array<Uint8Array|dbtypes.OpValue>>}
     */
    this.writer = new WritableStream({
      write: (message) => {
        if (!this.wsconnected) {
          return this.destroy()
        }
        const encodedMessage = encoding.encode(encoder => {
          for (let i = 0; i < message.length; i++) {
            const m = message[i]
            if (m instanceof Uint8Array) {
              encoding.writeUint8Array(encoder, m)
            } else {
              protocol.writeOps(encoder, /** @type {Array<dbtypes.OpValue>} */ (message))
            }
          }
        })
        this.ws.send(encodedMessage)
        const maxBufferedAmount = 3000_000
        if ((this.ws?.bufferedAmount || 0) > maxBufferedAmount) {
          return promise.until(100, () => (this.ws?.bufferedAmount || 0) < maxBufferedAmount)
        }
      }
    })
    ydb.comms.add(this)
    const ws = new WS(url)
    this.ws = ws
    ws.binaryType = 'arraybuffer'
    ws.onmessage = (event) => {
      addReadMessage(this, new Uint8Array(/** @type {ArrayBuffer} */ (event.data)))
    }
    ws.onerror = /** @param {any} event */ (event) => {
      log(this, 'error', event)
      handler.emit('connection-error', [/** @type {ErrorEvent} */(event), handler])
    }
    ws.onclose = (event) => {
      handler.emit('status', [{
        status: 'disconnected'
      }, handler])
      this.destroy()
      handler.emit('connection-close', [/** @type {any} */(event), handler])
      log(this, 'close', 'close-code: ', event.code)
    }
    ws.onopen = () => {
      log(this, 'open')
      this.wsconnected = true
      handler.wsUnsuccessfulReconnects = 0
      ws.send(encoding.encode(encoder => protocol.writeInfo(encoder, ydb, this)))
      handler.emit('status', [{
        status: 'connected'
      }, handler])
    }
    handler.emit('status', [{
      status: 'connecting'
    }, handler])
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

  destroy () {
    console.log('destroyed comm')
    debugger
    this.ws.close()
    this.isDestroyed = true
    this.ydb.comms.delete(this)
    this._readMessageQueue = queue.create()
    this.streamController.abort('destroyed')
    if (this.wsconnected) {
      this.handler.wsUnsuccessfulReconnects++
    }
    this.wsconnected = false
    this.handler._setupNewComm()
  }
}

/**
 * @implements comm.CommHandler
 * @extends ObservableV2<{ synced: function(WebSocketHandlerInstance):any, "connection-error": function(ErrorEvent, WebSocketHandlerInstance):any, "connection-close": function(CloseEvent, WebSocketHandlerInstance):any, status: function({ status: 'connecting'|'connected'|'disconnected' }, WebSocketHandlerInstance):any }>
 */
class WebSocketHandlerInstance extends ObservableV2 {
  /**
   * @param {import('../ydb.js').Ydb} ydb
   * @param {string} url
   */
  constructor (ydb, url) {
    super()
    this.ydb = ydb
    this.url = url
    this.shouldConnect = true
    this.wsUnsuccessfulReconnects = 0
    this.maxBackoffTime = 60000
    /**
     * @type {WebSocketCommInstance?}
     */
    this.comm = null
    if (this.shouldConnect) {
      this._setupNewComm()
    }
  }

  _setupNewComm () {
    // Start with no reconnect timeout and increase timeout by
    // using exponential backoff starting with 100ms
    const setup = () => {
      if (this.shouldConnect) {
        this.comm = new WebSocketCommInstance(this)
      }
    }
    if (this.wsUnsuccessfulReconnects === 0) {
      setup()
    } else {
      setTimeout(
        setup,
        math.min(
          math.pow(2, this.wsUnsuccessfulReconnects) * 100,
          this.maxBackoffTime
        )
      )
    }
  }

  destroy () {
    super.destroy()
    this.shouldConnect = false
    this.comm?.destroy()
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
    return new WebSocketHandlerInstance(ydb, this.url)
  }
}
