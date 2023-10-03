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
import { openYdb } from '../index.js'

const expectedBufferedAmount = 512 * 1024 // 512kb

/**
 * @implements comm.Comm
 */
class WSClient {
  /**
   * @param {uws.WebSocket<{ client: WSClient }>} ws
   */
  constructor (ws) {
    this.ws = ws
    /**
     * @type {Array<function (encoding.Encoder): Promise<boolean>>}
     */
    this.nextOps = []
    this._isDraining = false
    this.isDestroyed = false
    this.synced = false
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
    let bufferedAmount = this.ws.getBufferedAmount()
    while (this.nextOps.length > 0 && bufferedAmount < expectedBufferedAmount) {
      const encoder = encoding.createEncoder()
      if (!(await this.nextOps[0](encoder))) {
        this.nextOps.shift()
      }
      if (encoding.hasContent(encoder)) {
        const message = encoding.toUint8Array(encoder)
        bufferedAmount += message.byteLength
        !this.isDestroyed && this.send(message)
      }
    }
    this._isDraining = false
  }

  destroy () {
    this.nextOps = []
    this.isDestroyed = true
  }
}

const ydb = await openYdb('.ydb-websocket-server', ['*'], {})

const port = 9000

uws.App({}).ws('/*', /** @type {uws.WebSocketBehavior<{ client: WSClient }>} */ ({
  /* Options */
  compression: uws.SHARED_COMPRESSOR,
  maxPayloadLength: 70 * 1024 * 1024,
  idleTimeout: 60,
  /* Handlers */
  open: (ws) => {
    const client = new WSClient(ws)
    ws.getUserData().client = client
    client.send(encoding.encode(encoder => {
      protocol.writeInfo(encoder, ydb)
    }))
  },
  message: (ws, message) => {
    const decoder = decoding.createDecoder(new Uint8Array(message.slice(0))) // copy buffer because uws will reuse the memory space
    const client = ws.getUserData().client
    client.queueMessage(async (encoder) => {
      const reply = await protocol.readMessage(encoder, decoder, ydb, client)
      if (reply && !client.isDestroyed) {
        ws.send(encoding.toUint8Array(reply), true)
      }
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
  } else {
    console.log('Failed to listen to port ' + port)
  }
})
