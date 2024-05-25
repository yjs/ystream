import { WebSocket as WS } from '@y/stream/utils/websocket'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as protocol from '../protocol.js'
import * as queue from 'lib0/queue'
import { ObservableV2 } from 'lib0/observable'
import * as math from 'lib0/math'
import * as comm from '../comm.js' // eslint-disable-line
import * as logging from 'lib0/logging'
import { Ystream } from '../ystream.js' // eslint-disable-line
import * as webcrypto from 'lib0/webcrypto'
import * as utils from '../utils.js'
import * as promise from 'lib0/promise'
import * as dbtypes from '../api/dbtypes.js' // eslint-disable-line
import * as actions from '../api/actions.js'
import * as buffer from 'lib0/buffer'

const _log = logging.createModuleLogger('@y/stream/websocket')
/**
 * @param {WebSocketCommInstance} comm
 * @param {string} type
 * @param {...any} args
 */
const log = (comm, type, ...args) => _log(logging.PURPLE, `(local=${comm.ystream.clientid.toString(36).slice(0, 4)},remote=${comm.clientid.toString(36).slice(0, 4)}) `, logging.ORANGE, '[' + type + '] ', logging.GREY, ...args.map(arg => typeof arg === 'function' ? arg() : arg))

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
    log(comm, 'read message', { clientid: comm.clientid, len: currMessage.length })
    const reply = await protocol.readMessage(encoding.createEncoder(), decoding.createDecoder(currMessage), comm.ystream, comm)
    if (reply) {
      comm.send(encoding.toUint8Array(reply))
    }
    queue.dequeue(readMessageQueue)
  }
}

/**
 * @implements comm.Comm
 * @extends {ObservableV2<{ authenticated: (comm:WebSocketCommInstance) => void }>}
 */
class WebSocketCommInstance extends ObservableV2 {
  /**
   * @param {WebSocketHandlerInstance} handler
   */
  constructor (handler) {
    super()
    const { ystream, url } = handler
    this.handler = handler
    this.synced = new utils.CollectionsSet()
    this.isDestroyed = false
    this.comm = true
    this.ystream = ystream
    this.url = url
    this.clientid = -1
    this.isAuthenticated = false
    this.sentChallengeAnswer = false
    /**
     * @type {import('../api/dbtypes.js').UserIdentity|null}
     */
    this.user = null
    /**
     * @type {Uint8Array}
     */
    this.challenge = webcrypto.getRandomValues(new Uint8Array(64))
    /**
     * @type {import('../api/dbtypes.js').DeviceClaim|null}
     */
    this.deviceClaim = null
    /**
     * @type {queue.Queue<queue.QueueValue<Uint8Array>>}
     */
    this._readMessageQueue = queue.create()
    this.streamController = new AbortController()
    this.wsconnected = false
    this.nextClock = 0
    const randomIdentifier = Math.random() // @todo remove
    /**
     * @type {WritableStream<{ messages: Array<Uint8Array>, origin: any }>}
     */
    this.writer = new WritableStream({
      write: ({ messages, origin }) => {
        if (!this.wsconnected) {
          return this.destroy()
        }
        log(this, 'sending ops', () => `buffered amount=${this.ws?.bufferedAmount}, `, () => { return `number of ops=${messages.length}, first=` }, () => {
          const m = messages[0]
          if (m instanceof dbtypes.OpValue) {
            const { clock, localClock, client } = m
            return { clock, localClock, client, randomIdentifier }
          } else {
            return 'control message'
          }
        })
        for (let i = 0; i < messages.length; i++) {
          this.send(messages[i])
        }
        const maxBufferedAmount = 3000_000
        if ((this.ws?.bufferedAmount || 0) > maxBufferedAmount) {
          // @todo make timeout (30000ms) configurable
          return promise.until(30000, () => (this.ws?.bufferedAmount || 0) < maxBufferedAmount)
        }
      }
    })
    ystream.comms.add(this)
    const ws = new WS(url)
    this.ws = ws
    ws.binaryType = 'arraybuffer'
    ws.onmessage = (event) => {
      addReadMessage(this, new Uint8Array(/** @type {ArrayBuffer} */ (event.data)))
    }
    ws.onerror = /** @param {any} event */ (event) => {
      log(this, 'error', event)
      handler.emit('connection-error', [/** @type {ErrorEvent} */(event), handler])
      this.destroy()
    }
    ws.onclose = (event) => {
      handler.emit('status', [{
        status: 'disconnected',
        comm: this
      }, handler])
      handler.emit('connection-close', [/** @type {any} */(event), handler])
      log(this, 'close', 'close-code: ', event.code)
      this.destroy()
    }
    ws.onopen = () => {
      log(this, 'open')
      this.wsconnected = true
      handler.wsUnsuccessfulReconnects = 0
      this.send(encoding.encode(encoder => protocol.writeInfo(encoder, ystream, this)))
      handler.emit('status', [{
        status: 'connected',
        comm: this
      }, handler])
    }
    handler.emit('status', [{
      status: 'connecting',
      comm: this
    }, handler])
    this.on('authenticated', async () => {
      const encoder = encoding.createEncoder()
      await ystream.transact(tr =>
        actions.getClock(tr, ystream, this.clientid, handler.collection.owner, handler.collection.name).then(clock => {
          this.nextClock = clock
          return protocol.writeRequestOps(encoder, handler.collection.owner, handler.collection.name, clock)
        })
      )
      this.send(encoding.toUint8Array(encoder))
    })
  }

  /**
   * @todo this should only be called once we know this connection is synced and that ops is the
   * next expected op. Otherwise, fall back to unsynced and sync all local ops to backend.
   * @param {Uint8Array} message
   */
  send (message) {
    if (this.ws && this.wsconnected) {
      log(this, 'sending message', `Message len: ${message.length}`)
      // @todo handle the case that message could not be sent
      this.ws.send(message)
      return
    }
    this.destroy()
  }

  /**
   * @param {number} [code]
   * @param {string} [reason]
   */
  close (code, reason) {
    this.wsconnected = false
    this.ws.close(code, reason)
    this.destroy()
  }

  destroy () {
    if (this.isDestroyed) return
    const shouldrecreate = this.handler.comm === this
    super.destroy()
    this.streamController.abort('destroyed')
    this.ystream.comms.delete(this)
    this.isDestroyed = true
    this.handler.comm = null
    this.wsconnected && this.ws.close()
    this._readMessageQueue = queue.create()
    if (this.wsconnected) {
      this.handler.wsUnsuccessfulReconnects++
    }
    this.wsconnected = false
    if (shouldrecreate) {
      this.handler._setupNewComm()
    }
  }
}

/**
 * @implements comm.CommHandler
 * @extends ObservableV2<{ synced: function(WebSocketHandlerInstance):any, "connection-error": function(ErrorEvent, WebSocketHandlerInstance):any, "connection-close": function(CloseEvent, WebSocketHandlerInstance):any, status: function({ status: 'connecting'|'connected'|'disconnected', comm: WebSocketCommInstance }, WebSocketHandlerInstance):any }>
 */
class WebSocketHandlerInstance extends ObservableV2 {
  /**
   * @param {import('../ystream.js').Ystream} ystream
   * @param {string} url
   * @param {{ owner: Uint8Array, name: string }} collection
   */
  constructor (ystream, url, collection) {
    super()
    this.ystream = ystream
    this.url = url
    this.collection = collection
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
    if (!this.shouldConnect) return
    const prevComm = this.comm
    this.comm = null
    prevComm?.destroy()
    // Start with no reconnect timeout and increase timeout by
    // using exponential backoff starting with 100ms
    const setup = () => {
      if (this.shouldConnect && this.comm === null) {
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
    this.comm?.close()
  }
}

/**
 * @implements {comm.CommConfiguration}
 */
export class WebSocketComm {
  /**
   * @param {string} url
   * @param {{ owner: string, name: string }} collection
   */
  constructor (url, collection) {
    this.url = url
    this.collection = collection
  }

  /**
   * @param {Ystream} ystream
   */
  init (ystream) {
    return new WebSocketHandlerInstance(ystream, this.url, { owner: buffer.fromBase64(this.collection.owner), name: this.collection.name })
  }
}
