import * as Y from 'yjs'
import * as bc from 'lib0/broadcastchannel'
import * as buffer from 'lib0/buffer'
import * as env from 'lib0/environment'
import * as actions from './actions.js'
import * as operations from './operations.js'
import * as promise from 'lib0/promise'

/**
 * @typedef {import('./index.js').Ystream} Ystream
 */

/**
 * @param {Ystream} ystream
 * @param {string} owner
 * @param {string} collection
 * @param {string} doc
 * @param {Y.Doc} ydoc - should be an empty doc
 */
export const bindydoc = async (ystream, owner, collection, doc, ydoc) => {
  const bcroom = `ystream#${ystream.dbname}#${owner}#${collection}#${doc}`
  const ownerBin = buffer.fromBase64(owner)
  // const currentClock = ..
  ydoc.on('updateV2', /** @type {function(Uint8Array, any)} */ (update, origin) => {
    if (origin !== ystream) {
      /* c8 ignore next 3 */
      if (env.isBrowser) {
        // @todo could use more efficient encoding - allow Uint8Array in lib0/bc
        bc.publish(bcroom, buffer.toBase64(update), origin)
      } else {
        // @todo iterate through opened documents in ystream and apply update
        // Thought: iterating through the docs should be the default
      }
      actions.addOp(ystream, ownerBin, collection, doc, new operations.OpYjsUpdate(update))
    }
  })
  const updates = await ystream.childTransaction(async () => {
    const [
      updates,
      isDeleted
    ] = await promise.all([
      actions.getDocOps(ystream, ownerBin, collection, doc, operations.OpYjsUpdateType, 0),
      actions.isDocDeleted(ystream, ownerBin, collection, doc)
    ])
    return isDeleted ? null : updates
  })
  if (updates === null) {
    console.error('[ystream] You opened a deleted document. The doc will be destroyed.')
    ydoc.destroy()
    return null
  }
  /* c8 ignore start */
  if (env.isBrowser) {
    const sub = bc.subscribe(bcroom, (data, origin) => {
      if (origin !== ystream) {
        Y.applyUpdateV2(ydoc, buffer.fromBase64(data), ystream)
      }
    })
    ydoc.on('destroy', () => {
      bc.unsubscribe(bcroom, sub)
    })
  }
  /* c8 ignore end */
  updates.length > 0 && Y.transact(ydoc, () => {
    updates.forEach(update => {
      if (update.op.type === operations.OpYjsUpdateType) {
        Y.applyUpdateV2(ydoc, update.op.update)
      }
    })
  }, ystream, false)
  ydoc.emit('load', [])
}
