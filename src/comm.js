/**
 * Communication channel API
 */

import * as error from 'lib0/error'
import * as utils from './utils.js'

// @todo rename all interfacses to have I* prefix.

/**
 * @typedef {import('./ydb.js').Ydb} Ydb
 */

/**
 * @typedef {import('./dbtypes.js').OpValue} OpValue
 */

/* c8 ignore start */
/**
 * Interface that describes a communication channel.
 * @interface
 */
export class Comm {
  get clientid () { return -1 }
  set clientid (_v) { error.methodUnimplemented() }
  /**
   * @type {import('./dbtypes.js').UserIdentity|null}
   */
  get user () { return error.methodUnimplemented() }
  set user (_u) { error.methodUnimplemented() }
  /**
   * @type {import('./dbtypes.js').DeviceClaim|null}
   */
  get deviceClaim () { return error.methodUnimplemented() }
  set deviceClaim (_u) { error.methodUnimplemented() }
  /**
   * Set of synced collections
   * @type {utils.CollectionsSet}
   */
  get synced () { return new utils.CollectionsSet() }
  set synced (_v) { error.methodUnimplemented() }
  /**
   * Set of synced collections
   * @type {Uint8Array}
   */
  get challenge () { return new Uint8Array() }
  get isDestroyed () { return false }
  get isAuthenticated () { return false }
  set isAuthenticated (_v) { error.methodUnimplemented() }

  /**
   * @type {WritableStream<Array<Uint8Array|import('./dbtypes.js').OpValue>>}
   */
  get writer () { return error.methodUnimplemented() }
  /**
   * @type {AbortController}
   */
  get streamController () { return error.methodUnimplemented() }

  destroy () {
    error.methodUnimplemented()
  }
}
/* c8 ignore end */

/* c8 ignore start */
export class CommHandler {

}
/* c8 ignore end */

/* c8 ignore start */
/**
 * @interface
 */
export class CommConfiguration {
  /**
   * @param {Ydb} _ydb
   * @return {CommHandler}
   */
  init (_ydb) {
    error.methodUnimplemented()
  }
}
/* c8 ignore end */
