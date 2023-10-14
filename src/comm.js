/**
 * Communication channel API
 */

import * as error from 'lib0/error'
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
   * @type {Set<string>}
   */
  get synced () { return new Set() }
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
   * @param {Uint8Array} _message
   */
  send (_message) {
    error.methodUnimplemented()
  }

  destroy () {
    error.methodUnimplemented()
  }
}
/* c8 ignore end */

/* c8 ignore start */
/**
 * @interface
 */
export class CommConfiguration {
  /**
   * @param {Ydb} _ydb
   * @return {Comm}
   */
  init (_ydb) {
    error.methodUnimplemented()
  }
}
/* c8 ignore end */
