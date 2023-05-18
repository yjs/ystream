import * as Y from 'yjs'
import * as bc from 'lib0/broadcastchannel'
import * as buffer from 'lib0/buffer'
import * as env from 'lib0/environment'
import * as db from './db.js'
import * as dbtypes from './dbtypes.js'

/**
 * @typedef {import('./index.js').Ydb} Ydb
 */

/**
 * @param {Ydb} ydb
 * @param {string} collection
 * @param {string} doc
 * @param {Y.Doc} ydoc - should be an empty doc
 */
export const bindydoc = async (ydb, collection, doc, ydoc) => {
  const bcroom = `${ydb.dbname}#${collection}#${doc}`
  // const currentClock = ..
  ydoc.on('updateV2', /** @type {function(Uint8Array, any)} */ (update, origin) => {
    if (origin !== ydb) {
      /* c8 ignore next 3 */
      if (env.isBrowser) {
        // @todo could use more efficient encoding - allow Uint8Array in lib0/bc
        bc.publish(bcroom, buffer.toBase64(update), origin)
      } else {
        // @todo iterate through opened documents in ydb and apply update
        // Thought: iterating through the docs should be the default
      }
      ydb.addUpdate(collection, doc, update)
    }
  })
  /* c8 ignore start */
  if (env.isBrowser) {
    const sub = bc.subscribe(bcroom, (data, origin) => {
      if (origin !== ydb) {
        Y.applyUpdateV2(ydoc, buffer.fromBase64(data), ydb)
      }
    })
    ydoc.on('destroy', () => {
      bc.unsubscribe(bcroom, sub)
    })
  }
  /* c8 ignore end */
  const updates = await db.getDocOps(ydb, collection, doc, 0) // currentClock
  Y.transact(ydoc, () => {
    updates.forEach(update => {
      if (update.op.type === dbtypes.OpYjsUpdateType) {
        Y.applyUpdateV2(ydoc, /** @type {dbtypes.OpYjsUpdate} */ (update.op).update)
      }
    })
  }, ydb, false)
  ydoc.emit('load', [])
}
