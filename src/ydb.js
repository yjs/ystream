import * as Y from 'yjs'
import * as map from 'lib0/map'
import { bindydoc } from './bindydoc.js'
import * as promise from 'lib0/promise'
import * as isodb from 'isodb' // eslint-disable-line
import * as db from './db.js' // eslint-disable-line
import { ObservableV2 } from 'lib0/observable'
import * as random from 'lib0/random'
import * as actions from './actions.js'
import * as array from 'lib0/array'
import * as dbtypes from './dbtypes.js' // eslint-disable-line
import * as eventloop from 'lib0/eventloop'
import * as bc from 'lib0/broadcastchannel'

/**
 * @typedef {Object} YdbConf
 * @property {Array<import('./comm.js').CommConfiguration>} [YdbConf.comms]
 * @property {boolean} [YdbConf.acceptNewUsers]
 */

/**
 * @param {dbtypes.OpValue} a
 * @param {dbtypes.OpValue} b
 */
const _sortOpsHelper = (a, b) => a.localClock - b.localClock

/**
 * @param {Ydb} ydb
 * @param {Array<dbtypes.OpValue>} ops
 */
const _emitOpsEvent = (ydb, ops) => {
  if (ops.length === 0) {
    return
  }
  const eclock = ydb._eclock
  ops.sort(_sortOpsHelper)
  ydb._eops.push(...ops)
  if (eclock != null && ops[0].localClock > eclock) {
    return
  }
  if (ydb._eev == null) {
    ydb._eev = eventloop.timeout(0, () => {
      // @TODO emit some event here so that other threads pull the op
      const eops = ydb._eops
      eops.sort(_sortOpsHelper)
      let i = 0
      if (ydb._eclock == null) ydb._eclock = eops[0].localClock
      while (i < eops.length) {
        const opclock = eops[i].localClock
        if (opclock === ydb._eclock) {
          ydb._eclock++
          i++
        } else if (opclock < /** @type {number} */ (ydb._eclock)) {
          eops.splice(i, 1)
        } else {
          break
        }
      }
      let opsToEmit
      if (i === eops.length) {
        opsToEmit = eops
        ydb._eops = []
      } else {
        opsToEmit = eops.splice(0, i)
      }
      if (opsToEmit.length > 0) ydb.emit('ops', [opsToEmit, true])
      ydb._eev = null
    })
  }
}

/**
 * @param {Ydb} ydb
 * @param {Array<dbtypes.OpValue>} ops
 */
export const emitOpsEvent = (ydb, ops) => {
  if (ops.length > 0) {
    _emitOpsEvent(ydb, ops)
    bc.publish('ydb#' + ydb.dbname, ops.map(op => op.localClock), ydb)
  }
}

/**
 * @extends ObservableV2<{ sync:function():void, ops:function(Array<dbtypes.OpValue>,boolean):void, authenticate:function():void }>
 */
export class Ydb extends ObservableV2 {
  /**
   * @param {Array<string>} collections
   * @param {string} dbname
   * @param {isodb.IDB<typeof db.def>} _db
   * @param {dbtypes.UserIdentity|null} user
   * @param {dbtypes.DeviceClaim|null} deviceClaim
   * @param {YdbConf} conf
   */
  constructor (collections, dbname, _db, user, deviceClaim, { comms = [], acceptNewUsers = false } = {}) {
    super()
    this.dbname = dbname
    /**
     * @type {isodb.IDB<typeof db.def>}
     */
    this.db = _db
    /**
     * Whether to sync all collections (i.e. `collections = ['*']`)
     *
     * @type {boolean}
     */
    this.syncsEverything = array.some(collections, c => c === '*')
    this.acceptNewUsers = acceptNewUsers
    /**
     * @type {Map<string,Map<string,Set<Y.Doc>>>}
     */
    this.collections = new Map()
    collections.forEach(collectionName => { this.collections.set(collectionName, new Map()) })
    /**
     * @type {Set<string>}
     */
    this.syncedCollections = new Set()
    this.isSynced = false
    this.whenSynced = promise.create(resolve =>
      this.once('sync', resolve)
    )
    this.clientid = random.uint32()
    /**
     * @type {dbtypes.UserIdentity|null}
     */
    this.user = user
    /**
     * @type {dbtypes.DeviceClaim|null}
     */
    this.deviceClaim = deviceClaim
    /**
     * Instance is authenticated once a user identity is set and the device claim has been set.
     */
    this.isAuthenticated = false
    this.whenAuthenticated = promise.create(resolve => this.once('authenticate', resolve))
    /**
     * Clock of latest emitted clock.
     * @type {number|null}
     */
    this._eclock = null
    /**
     * Ops to emit.
     *
     * @type {Array<dbtypes.OpValue>}
     */
    this._eops = []
    /**
     * Timeout object for emitting ops.
     *
     * @type {eventloop.TimeoutObject|null}
     */
    this._eev = null
    /**
     * Ops to emit once ops from the database are fetched.
     *
     * @type {Array<function(Array<dbtypes.OpValue>,boolean):void>}
     */
    this._els = []
    /**
     * Subscribe to broadcastchannel event that is fired whenever an op is added to the database.
     */
    this._esub = bc.subscribe('ydb#' + this.dbname, /** @param {Array<number>} opids */ async (opids, origin) => {
      if (origin !== this) {
        const ops = await actions.getOps(this, opids[0])
        _emitOpsEvent(this, ops)
      }
    })
    /**
     * @type {Set<import('./comm.js').Comm>}
     */
    this.comms = new Set()
    comms.forEach(comm =>
      this.comms.add(comm.init(this))
    )
  }

  /**
   * @param {string} collection
   * @param {string} docname
   */
  getYdoc (collection, docname) {
    const col = this.collections.get(collection)
    if (col == null) { throw new Error('Collection was not specified') }
    const docset = map.setIfUndefined(col, docname, () => new Set())
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
    this.comms.forEach(comm => comm.destroy())
    this._eev?.destroy()
    bc.unsubscribe('ydb#' + this.dbname, this._esub)
    return this.db.destroy()
  }
}
