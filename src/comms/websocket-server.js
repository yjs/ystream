/* A few users have reported having issues understanding backpressure and how to deal with it.
 *
 * Backpressure is the buildup of unacknowledged data; you can't just call ws.send without checking for backpressure.
 * Data doesn't just, poof, immediately jump from your server to the receiver - the receiver has to actually... receive it.
 * That happens with ACKs, controlling the transmission window.
 *
 * See https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/bufferedAmount
 *
 * Backpressure applies to all streams, files, sockets, queues, and so on. If you're building
 * web services without taking backpressure into account you're not developing proper solutions - you're dicking around.
 *
 * Any slow receiver can DOS your whole server if you're not taking backpressure into account.
 *
 * The following is a (ridiculous) example of how data can be pushed according to backpressure.
 * Do not take this as a way to actually write code, this is horrible, but it shows the concept clearly.
 *
 */

import * as uws from 'uws'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as protocol from '../protocol.js'
import * as comm from '../comm.js' // eslint-disable-line
import * as Ystream from '../index.js'
import * as promise from 'lib0/promise'
import * as error from 'lib0/error'
import * as webcrypto from 'lib0/webcrypto'
import * as authentication from '../api/authentication.js'
import * as dbtypes from '../dbtypes.js' // eslint-disable-line
import * as utils from '../utils.js'
import * as logging from 'lib0/logging'
import * as observable from 'lib0/observable'
import * as actions from '../actions.js'

const expectedBufferedAmount = 512 * 1024 // 512kb

const _log = logging.createModuleLogger('@y/stream/websocket')
/**
 * @param {WSClient} comm
 * @param {string} type
 * @param {...any} args
 */
const log = (comm, type, ...args) => _log(logging.PURPLE, `(local=${comm.ystream.clientid.toString(36).slice(0, 4)},remote=${comm.clientid.toString(36).slice(0, 4)}) `, logging.ORANGE, '[' + type + '] ', logging.GREY, ...args.map(arg => typeof arg === 'function' ? arg() : arg))

/**
 * @implements comm.Comm
 * @extends {observable.ObservableV2<{ authenticated: (comm: WSClient) => void }>}
 */
class WSClient extends observable.ObservableV2 {
  /**
   * @param {uws.WebSocket<{ client: WSClient }>} ws
   * @param {Ystream.Ystream} ystream
   */
  constructor (ws, ystream) {
    super()
    this.ystream = ystream
    this.clientid = -1
    /**
     * @type {import('../dbtypes.js').UserIdentity|null}
     */
    this.user = null
    /**
     * @type {import('../dbtypes.js').DeviceClaim|null}
     */
    this.deviceClaim = null
    this.ws = ws
    /**
     * @type {Array<function (encoding.Encoder): Promise<boolean>>}
     */
    this.nextOps = []
    this._isDraining = false
    this.isDestroyed = false
    this.synced = new utils.CollectionsSet()
    this.isAuthenticated = false
    this.sentChallengeAnswer = false
    this.challenge = webcrypto.getRandomValues(new Uint8Array(64))
    this.streamController = new AbortController()
    /**
     * @type {WritableStream<{ messages: Array<dbtypes.OpValue|Uint8Array>, origin: any }>}
     */
    this.writer = new WritableStream({
      write: ({ messages, origin }) => {
        if (origin === this) return
        log(this, 'sending ops', () => { return `number of ops=${messages.length}, first=` }, () => {
          const m = messages[0]
          if (m instanceof dbtypes.OpValue) {
            const { clock, localClock, client } = m
            return { clock, localClock, client }
          } else {
            return 'control message'
          }
        })
        const encodedMessage = encoding.encode(encoder => {
          for (let i = 0; i < messages.length; i++) {
            const m = messages[i]
            if (m instanceof Uint8Array) {
              encoding.writeUint8Array(encoder, m)
            } else {
              let len = 1
              for (; i + len < messages.length && messages[i + len] instanceof dbtypes.OpValue; len++) { /* nop */ }
              protocol.writeOps(encoder, /** @type {Array<dbtypes.OpValue>} */ (messages.slice(i, i + len)))
              i += len - 1
            }
          }
        })
        this.send(encodedMessage)
        const maxBufferedAmount = 3000_000
        if (this.ws.getBufferedAmount() > maxBufferedAmount) {
          // @todo make timeout (30s) configurable
          return promise.until(30000, () => this.isDestroyed || this.ws.getBufferedAmount() < maxBufferedAmount)
        }
      }
    })
    this.on('authenticated', async () => {
      const encoder = encoding.createEncoder()
      const clock = await actions.getClock(ystream, this.clientid, null, null)
      protocol.writeRequestAllOps(encoder, clock)
      this.send(encoding.toUint8Array(encoder))
    })
  }

  /**
   * @param {Uint8Array} message
   */
  send (message) {
    !this.isDestroyed && this.ws.send(message, true)
  }

  /**
   * @param {function (encoding.Encoder): Promise<boolean>} f
   */
  queueMessage (f) {
    const opsSize = this.nextOps.push(f)
    if (opsSize === 1 || this.ws.getBufferedAmount() < expectedBufferedAmount) {
      this._drain()
    }
  }

  async _drain () {
    if (this._isDraining) return
    this._isDraining = true
    try {
      let bufferedAmount = this.ws.getBufferedAmount()
      while (this.nextOps.length > 0 && bufferedAmount < expectedBufferedAmount) {
        // @todo create a test that makes sure that _drain is eventually called once buffer is freed
        const encoder = encoding.createEncoder()
        if (!(await this.nextOps[0](encoder))) {
          this.nextOps.shift()
        }
        if (encoding.hasContent(encoder)) {
          const message = encoding.toUint8Array(encoder)
          bufferedAmount += message.byteLength
          this.send(message)
        }
      }
    } finally {
      this._isDraining = false
      // @todo destroy conn in case of an error
    }
  }

  destroy () {
    super.destroy()
    console.log('destroyed comm')
    this.nextOps = []
    this.isDestroyed = true
    this.streamController.abort('destroyed')
  }
}

/**
 * @param {Object} options
 * @param {number} [options.port]
 * @param {string} [options.dbname]
 * @param {boolean} [options.acceptNewUsers]
 * @param {{ user: dbtypes.UserIdentity, privateKey: CryptoKey }} [options.identity]
 */
export const createWSServer = async ({ port = 9000, dbname = '.ystream/server', acceptNewUsers = true, identity } = {}) => {
  const db = await Ystream.open(dbname, { acceptNewUsers, syncsEverything: true })
  const server = new WSServer(db, port)
  if (!db.isAuthenticated) {
    if (identity) {
      await authentication.setUserIdentity(db, identity.user, await identity.user.publicKey, identity.privateKey)
    } else {
      const user = await authentication.createUserIdentity()
      await authentication.setUserIdentity(db, user.userIdentity, user.publicKey, user.privateKey)
    }
  }
  await server.ready
  return server
}

export class WSServer {
  /**
   * @param {Ystream.Ystream} ystream
   * @param {number} port
   */
  constructor (ystream, port) {
    /**
     * @type {Ystream.Ystream}
     */
    this.ystream = ystream
    this.ready = ystream.whenAuthenticated.then(() => promise.create((resolve, reject) => {
      console.log('starting websocket server')
      uws.App({}).ws('/*', /** @type {uws.WebSocketBehavior<{ client: WSClient }>} */ ({
        /* Options */
        compression: uws.SHARED_COMPRESSOR,
        maxPayloadLength: 70 * 1024 * 1024,
        idleTimeout: 60,
        /* Handlers */
        open: (ws) => {
          const client = new WSClient(ws, ystream)
          ws.getUserData().client = client
          client.send(encoding.encode(encoder => {
            protocol.writeInfo(encoder, ystream, client)
          }))
        },
        message: (ws, message) => {
          const decoder = decoding.createDecoder(new Uint8Array(message.slice(0))) // copy buffer because uws will reuse the memory space
          const client = ws.getUserData().client
          client.queueMessage(async (encoder) => {
            await protocol.readMessage(encoder, decoder, ystream, client)
            return false
          })
        },
        drain: ws => {
          ws.getUserData().client._drain()
        },
        close: ws => {
          ws.getUserData().client.destroy()
        }
      })).any('/*', (res, _req) => {
        res.end('Oh no, you found me 🫣')
      }).listen(port, (token) => {
        if (token) {
          console.log('Listening to port ' + port)
          resolve(port)
        } else {
          const m = 'Failed to listen to port ' + port
          reject(error.create(m))
          console.log(m)
        }
      })
    }))
  }
}
