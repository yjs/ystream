import * as Y from 'yjs'
import * as map from 'lib0/map'
import { bindydoc } from './bindydoc.js'
import * as promise from 'lib0/promise'
import * as isodb from 'isodb' // eslint-disable-line
import * as db from './db.js' // eslint-disable-line
import { Observable } from 'lib0/observable'
import * as random from 'lib0/random'

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
   * @param {string} docname
   */
  getYdoc (collection, docname) {
    const col = map.setIfUndefined(this.collections, collection, () => new Map())
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
    return this.db.destroy()
  }
}
