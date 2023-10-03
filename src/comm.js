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
  get synced () { return false }
  set synced (_v) { error.methodUnimplemented() }
  get isDestroyed () { return false }

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
