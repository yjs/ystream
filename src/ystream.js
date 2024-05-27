import * as Y from 'yjs'
import * as map from 'lib0/map'
import { bindydoc } from './bindydoc.js'
import * as promise from 'lib0/promise'
import * as isodb from 'isodb' // eslint-disable-line
import * as db from './db.js' // eslint-disable-line
import { ObservableV2 } from 'lib0/observable'
import * as actions from './api/actions.js'
import * as dbtypes from './api/dbtypes.js' // eslint-disable-line
import * as bc from 'lib0/broadcastchannel'
import * as buffer from 'lib0/buffer'
import * as logging from 'lib0/logging'

const _log = logging.createModuleLogger('@y/stream')
/**
 * @param {Ystream} ystream
 * @param {string} type
 * @param {...any} args
 */
const log = (ystream, type, ...args) => _log(logging.PURPLE, `(local=${ystream.clientid.toString(36).slice(0, 4)}${ystream.syncsEverything ? ',server=true' : ''}) `, logging.ORANGE, '[' + type + '] ', logging.GREY, ...args.map(arg => typeof arg === 'function' ? arg() : arg))

/**
 * @typedef {Object} YstreamConf
 * @property {Array<import('./comm.js').CommConfiguration>} [YstreamConf.comms]
 * @property {boolean} [YstreamConf.acceptNewUsers]
 * @property {boolean} [YstreamConf.syncsEverything]
 */

/**
 * Fires the `ops` event.
 *
 * The `ops` event guarantees that ops are emitted in-order (sorted by localClock).
 *
 * However, because of async ops from other threads, we can't guarantee that `_emitOpsEvent`
 * receives ops in order. So we need to wait before emitting ops.
 *
 * This happens from inside of a transaction, so it can't overlap with other transactions.
 *
 * @param {YTransaction} tr
 * @param {Ystream} ystream
 * @param {Array<dbtypes.OpValue>} ops
 * @param {any} origin
 */
const emitOpsEvent = async (tr, ystream, ops, origin) => {
  if (ops.length > 0) {
    if (ystream._eclock == null) {
      ystream._eclock = ops[0].localClock
    }
    const eclock = ystream._eclock
    ops.sort((o1, o2) => o1.localClock - o2.localClock)
    while (ops[0].localClock < eclock) {
      ops.shift()
    }
    for (let i = 0; i < ops.length - 1; i++) {
      if (ops[i].localClock + 1 !== ops[i + 1].localClock) {
        throw new Error('expected emitted ops to be without holes')
      }
    }
    if (ops[0].localClock !== eclock) {
      origin = 'db'
      // not expected op, pull from db again
      ops = await tr.tables.oplog.getEntries({
        start: new isodb.AutoKey(eclock)
      }).then(colEntries => colEntries.map(update => {
        update.value.localClock = update.key.v
        if (update.value.client === ystream.clientid) {
          update.value.clock = update.key.v
        }
        return update.value
      }))
    }
    if (ops.length > 0) {
      bc.publish('@y/stream#' + ystream.dbname, ops[ops.length - 1].localClock, ystream)
      ystream._eclock = ops[ops.length - 1].localClock + 1
      setImmediate(() => {
        // @todo make this a proper log
        log(ystream, 'emitting ops', () => `localClockRange=${ops[0].localClock}-${ops[ops.length - 1].localClock}`)
        ystream.emit('ops', [ops, tr.origin, tr.isRemote])
      })
    }
  }
}

export class YTransaction {
  /**
   * @param {isodb.ITransaction<typeof db.def>} db
   * @param {any} origin
   */
  constructor (db, origin) {
    this.db = db
    this.tables = db.tables
    this.objects = db.objects
    /**
     * @type {Array<import('./api/dbtypes.js').OpValue>}
     */
    this.ops = []
    this.origin = origin
    this.isRemote = false
  }
}

/**
 * @extends ObservableV2<{ ops:function(Array<dbtypes.OpValue>,any,boolean):void, authenticate:function():void, "collection-opened":(collection:Collection)=>void, "destroy": (ystream: Ystream)=>void }>
 */
export class Ystream extends ObservableV2 {
  /**
   * @param {string} dbname
   * @param {isodb.IDB<typeof db.def>} _db
   * @param {number} clientid
   * @param {dbtypes.UserIdentity|null} user
   * @param {dbtypes.DeviceClaim|null} deviceClaim
   * @param {YstreamConf} conf
   */
  constructor (dbname, _db, clientid, user, deviceClaim, { comms = [], acceptNewUsers = false, syncsEverything = false } = {}) {
    super()
    this.dbname = dbname
    /**
     * @type {isodb.IDB<typeof db.def>}
     */
    this._db = _db
    this.acceptNewUsers = acceptNewUsers
    /**
     * @type {Map<string,Map<string,Collection>>}
     */
    this.collections = new Map()
    /**
     * Whether to sync all collections (usually only done by a server)
     */
    this.syncsEverything = syncsEverything
    this.clientid = clientid
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
     * Next expected localClock for emitting ops.
     * @type {number|null}
     */
    this._eclock = null
    /**
     * Subscribe to broadcastchannel event that is fired whenever an op is added to the database.
     * The localClock of the last op will be emitted.
     */
    this._esub = bc.subscribe('@y/stream#' + this.dbname, /** @param {number} lastOpId */ async (lastOpId, origin) => {
      if (origin !== this) {
        log(this, 'received ops via broadcastchannel', lastOpId)
        // @todo reintroduce pulling from a database
        // const ops = await actions.getOps(this, opids[0])
        // _emitOpsEvent(this, ops, 'broadcastchannel')
      }
    })
    /**
     * @type {Set<import('./comm.js').Comm>}
     */
    this.comms = new Set()
    /**
     * @type {Set<import('./comm.js').CommHandler>}
     */
    this.commHandlers = new Set()
    this.whenAuthenticated.then(() => {
      log(this, 'adding comms', comms)
      comms.forEach(comm =>
        this.commHandlers.add(comm.init(this))
      )
    })
    this.isDestroyed = false
  }

  /**
   * @param {string} owner
   * @param {string} collection
   */
  getCollection (owner, collection) {
    return map.setIfUndefined(map.setIfUndefined(this.collections, owner, map.create), collection, () => new Collection(this, owner, collection))
  }

  /**
   * @todo Transactions should have an origin, children should only be added if they have the same
   * origin, never to system transactions
   * @template T
   * @param {(tr:YTransaction) => Promise<T>} f
   * @param {any} origin
   * @return {Promise<T>}
   */
  transact (f, origin = null) {
    return this._db.transact(async db => {
      const tr = new YTransaction(db, origin)
      const res = await f(tr)
      await emitOpsEvent(tr, this, tr.ops, tr.origin)
      return res
    })
  }

  destroy () {
    if (this.isDestroyed) return
    this.isDestroyed = true
    this.collections.forEach(owner => {
      owner.forEach(collection => {
        collection.destroy()
      })
    })
    this.commHandlers.forEach(handler => handler.destroy())
    bc.unsubscribe('@y/stream#' + this.dbname, this._esub)
    this.emit('destroy', [this])
    return this._db.destroy()
  }
}

/**
 * @extends ObservableV2<{ sync:function():void, ops:function(Array<dbtypes.OpValue>,any,boolean):void }>
 */
export class Collection extends ObservableV2 {
  /**
   * @param {Ystream} stream
   * @param {string} owner
   * @param {string} collection
   */
  constructor (stream, owner, collection) {
    super()
    this.ystream = stream
    this.owner = owner
    this.ownerBin = buffer.fromBase64(owner)
    this.collection = collection
    /**
     * @type {Map<string, Set<Y.Doc>>}
     */
    this.docs = new Map()
    this.isSynced = false
    this.whenSynced = promise.create(resolve =>
      this.once('sync', resolve)
    )
    stream.emit('collection-opened', [this])
  }

  /**
   * @param {string} docname
   */
  getYdoc (docname) {
    const docset = map.setIfUndefined(this.docs, docname, () => new Set())
    const ydoc = new Y.Doc({
      guid: docname
    })
    docset.add(ydoc)
    ydoc.on('destroy', () => {
      docset.delete(ydoc)
    })
    bindydoc(this.ystream, this.owner, this.collection, docname, ydoc)
    return ydoc
  }

  /**
   * @param {import('@y/stream').YTransaction} tr
   * @param {string} docid
   */
  getYdocUpdates (tr, docid) {
    return actions.getYDocUpdates(tr, this.ystream, this.ownerBin, this.collection, docid)
  }

  /**
   * @param {import('@y/stream').YTransaction} tr
   * @param {string} docid
   * @param {Uint8Array} update
   */
  addYdocUpdate (tr, docid, update) {
    return actions.addYDocUpdate(tr, this.ystream, this.ownerBin, this.collection, docid, update)
  }

  /**
   * @param {import('@y/stream').YTransaction} tr
   * @param {string} docid
   * @return {Promise<{ name: string, parent: null | string, ftype: 'dir'|'binary'|'text' } | null>}
   */
  async getFileInfo (tr, docid) {
    return actions.getFileInfo(tr, this.ystream, this.ownerBin, this.collection, docid)
  }

  /**
   * This functions sets the fileinfo - making it possible to represent this as a file on a
   * filesystem.
   *
   * It is possible to query the children of a parent. The children can be identified by the docid
   * (immutable) OR the docname (mutable, but not guaranteed to be unique across devices).
   *
   * This function does not overwrite content. The existing file should be deleted manually.
   *
   * @param {import('@y/stream').YTransaction} tr
   * @param {string} docid
   * @param {string} docname
   * @param {string|null} parentDoc
   * @param {'dir'|'binary'|'text'} ftype
   */
  async setFileInfo (tr, docid, docname, parentDoc, ftype) {
    return actions.setFileInfo(tr, this.ystream, this.ownerBin, this.collection, docid, docname, parentDoc, ftype)
  }

  /**
   * @param {import('@y/stream').YTransaction} tr
   * @param {string} docid
   * @param {number} [endLocalClock]
   */
  getDocPath (tr, docid, endLocalClock) {
    return actions.getDocPath(tr, this.ystream, this.ownerBin, this.collection, docid, endLocalClock)
  }

  /**
   * @param {import('@y/stream').YTransaction} tr
   * @param {string|null} rootid
   * @param {Array<string>} path
   * @return {Promise<Array<string>>}
   */
  getDocIdsFromPath (tr, rootid, path) {
    return actions.getDocIdsFromPath(tr, this.ystream, this.ownerBin, this.collection, rootid, path)
  }

  /**
   * This function retrieves the children on a document. It simulates the behavior of the `ls` unix
   * command.
   *
   * @param {import('@y/stream').YTransaction} tr
   * @param {string?} docid
   * @return {Promise<Array<{ docid: string, docname: string }>>}
   */
  getDocChildren (tr, docid) {
    return actions.getDocChildren(tr, this.ystream, this.ownerBin, this.collection, docid)
  }

  /**
   * This function retrieves the children on a document. It simulates the behavior of the `ls **\/*
   * -l` unix command.
   *
   * @param {import('@y/stream').YTransaction} tr
   * @param {string?} docname
   */
  getDocChildrenRecursive (tr, docname) {
    return actions.getDocChildrenRecursive(tr, this.ystream, this.ownerBin, this.collection, docname)
  }

  /**
   * @param {import('@y/stream').YTransaction} tr
   * @param {string} key
   * @returns {any|undefined} undefined if the value was not defined previously
   */
  getLww (tr, key) {
    return actions.getLww(tr, this.ystream, this.ownerBin, this.collection, key)
  }

  /**
   * @param {import('@y/stream').YTransaction} tr
   * @param {string} key
   * @param {any} val
   * @return the previous values
   */
  setLww (tr, key, val) {
    return actions.setLww(tr, this.ystream, this.ownerBin, this.collection, key, val)
  }

  /**
   * @param {import('@y/stream').YTransaction} tr
   * @param {string} docid
   */
  deleteDoc (tr, docid) {
    return actions.deleteDoc(tr, this.ystream, this.ownerBin, this.collection, docid)
  }

  /**
   * @param {import('@y/stream').YTransaction} tr
   * @param {string} docid
   */
  isDocDeleted (tr, docid) {
    return actions.isDocDeleted(tr, this.ystream, this.ownerBin, this.collection, docid)
  }

  destroy () {
    this.ystream.collections.get(this.owner)?.delete(this.collection)
  }
}
