import * as dbtypes from './dbtypes.js'
import * as Y from 'yjs'
import * as map from 'lib0/map'
import { setIfUndefined } from 'lib0/map.js'
import { bindydoc } from './bindydoc.js'
import * as env from 'lib0/environment'
import * as bc from 'lib0/broadcastchannel'
import * as promise from 'lib0/promise'
import * as buffer from 'lib0/buffer'
import * as isodb from 'isodb' // eslint-disable-line
import * as db from './db.js' // eslint-disable-line
import { Observable } from 'lib0/observable'
import * as random from 'lib0/random'

/**
 * @todo use lib0/array/uniqueBy
 * @template T
 * @template M
 * @param {Array<T>} arr
 * @param {function(T):M} mapper
 * @return {Array<T>}
 */
const uniqueBy = (arr, mapper) => {
  /**
   * @type {Set<M>}
   */
  const happened = new Set()
  /**
   * @type {Array<T>}
   */
  const result = []
  for (let i = 0; i < arr.length; i++) {
    const el = arr[i]
    const mapped = mapper(el)
    if (!happened.has(mapped)) {
      happened.add(mapped)
      result.push(el)
    }
  }
  return result
}

/**
 * @typedef {Object} YdbConf
 * @property {Array<import('./comm.js').CommConfiguration>} [YdbConf.comms]
 */

/**
 * @extends Observable<'sync'>
 */
export class Ydb extends Observable {
  /**
   * @param {string} dbname
   * @param {isodb.IDB<typeof db.def>} _db
   * @param {YdbConf} conf
   */
  constructor (dbname, _db, { comms = [] } = {}) {
    super()
    this.dbname = dbname
    /**
     * @type {isodb.IDB<typeof db.def>}
     */
    this.db = _db
    /**
     * @type {Map<string,Map<string,Set<Y.Doc>>>}
     */
    this.collections = new Map()
    /**
     * @type {Set<import('./comm.js').Comm>}
     */
    this.comms = new Set()
    this.whenSynced = promise.create(resolve => {
      this.once('sync', resolve)
    })
    comms.forEach(comm => {
      this.comms.add(comm.init(this))
    })
    this.clientid = random.uint32()
  }

  /**
   * @param {string} collection
   * @param {string} doc
   * @param {Uint8Array} update
   */
  async addUpdate (collection, doc, update) {
    const op = await this.db.transact(async tr => {
      const op = new dbtypes.OpValue(this.clientid, 0, collection, doc, new dbtypes.YjsOp(update))
      const key = await tr.tables.oplog.add(op)
      op.clock = key.v
      tr.tables.clocks.set(op.client, new dbtypes.ClientClockValue(op.clock, op.clock))
      return op
    })
    this.comms.forEach(comm => {
      comm.broadcast([op])
    })
  }

  getClocks () {
    return this.db.transactReadonly(async tr => {
      const entries = await tr.tables.clocks.getEntries({})
      /**
       * @type {Map<number,dbtypes.ClientClockValue>}
       */
      const clocks = new Map()
      entries.forEach(entry => {
        clocks.set(entry.key.v, entry.value)
      })
      const lastKey = await tr.tables.oplog.getKeys({ reverse: true, limit: 1 })
      if (lastKey.length >= 0) {
        clocks.set(this.clientid, new dbtypes.ClientClockValue(lastKey[0].v, lastKey[0].v))
      }
      return clocks
    })
  }

  /**
   * @todo this should be move to bindydoc.js
   * @param {Array<dbtypes.OpValue>} ops
   * @param {boolean} shouldFilter Filter operations with older client-id - this should only be true if the connection is
   *                               synced
   */
  applyOps (ops, shouldFilter) {
    const p = this.db.transact(async tr => {
      /**
*      * Maps from clientid to clock
       * @type {Map<number,number>}
       */
      const clocks = new Map()
      // wait for all clock requests
      await promise.all(uniqueBy(ops, op => op.client).map(op =>
        tr.tables.clocks.get(op.client).then(clock => {
          clock && clocks.set(op.client, clock.clock)
        })
      ))
      /**
       * @type {Map<number,dbtypes.ClientClockValue>}
       */
      const clientClockEntries = new Map()
      // 1. Filter ops that have already been applied 2. apply ops 3. update clocks table
      await promise.all((!shouldFilter ? ops : ops.filter(op => op.clock >= (clocks.get(op.client) || 0))).map(op =>
        tr.tables.oplog.add(op).then(localClock => {
          clientClockEntries.set(op.client, new dbtypes.ClientClockValue(op.clock, localClock.v))
        })
      ))
      clientClockEntries.forEach((clockValue, client) => {
        tr.tables.clocks.set(client, clockValue)
      })
      console.log(this.dbname, 'wrote ops', ops)
    })
    /**
     * @type {Map<string, Map<string, Array<dbtypes.OpValue>>>}
     */
    const sorted = new Map()
    ops.forEach(op => {
      map.setIfUndefined(map.setIfUndefined(sorted, op.collection, map.create), op.doc, () => /** @type {Array<dbtypes.OpValue>} */ ([])).push(op)
    })
    sorted.forEach((col, colname) => {
      const docs = this.collections.get(colname)
      if (docs) {
        col.forEach((docupdates, docname) => {
          const docset = docs.get(docname)
          /* c8 ignore next */
          if ((docset && docset.size > 0) || env.isBrowser) {
            const mergedUpdate = Y.mergeUpdatesV2(docupdates.map(op => op.op.update))
            if (docset && docset.size > 0) {
              console.log(this.dbname, 'applying docupdates', docupdates)
              docset.forEach(doc => Y.applyUpdateV2(doc, mergedUpdate))
            }
            /* c8 ignore start */
            if (env.isBrowser) {
              // @todo could use more efficient encoding - allow Uint8Array in lib0/bc
              const mergedUpdate = Y.mergeUpdatesV2(ops.map(op => op.op.update))
              // @todo this should be generated by a function
              const bcroom = `${this.dbname}#${colname}#${docname}`
              bc.publish(bcroom, buffer.toBase64(mergedUpdate), this)
            }
            /* c8 ignore end */
          }
        })
      }
    })
    return p
  }

  /**
   * @param {string} collection
   * @param {string} docname
   */
  getYdoc (collection, docname) {
    const col = setIfUndefined(this.collections, collection, () => new Map())
    const docset = setIfUndefined(col, docname, () => new Set())
    const ydoc = new Y.Doc({
      guid: `${collection}#${docname}`
    })
    docset.add(ydoc)
    bindydoc(this, collection, docname, ydoc)
    return ydoc
  }

  destroy () {
    this.collections.forEach(collection => {
      collection.forEach(docs => {
        docs.forEach(doc => doc.destroy())
      })
    })
    return this.db.destroy()
  }
}
