/**
 * Communication channel API
 */

import * as error from 'lib0/error'
import * as utils from './utils.js'
import * as observable from 'lib0/observable'

// @todo rename all interfacses to have I* prefix.

/**
 * @typedef {import('./ystream.js').Ystream} Ystream
 */

/**
 * @typedef {import('./api/dbtypes.js').OpValue} OpValue
 */

/* c8 ignore start */
/**
 * Interface that describes a communication channel.
 *
 * @interface
 * @extends observable.ObservableV2<{ authenticated: (comm:Comm) => void }>
 */
export class Comm extends observable.ObservableV2 {
  get clientid () { return -1 }
  set clientid (_v) { error.methodUnimplemented() }
  /**
   * @type {import('./api/dbtypes.js').UserIdentity|null}
   */
  get user () { return error.methodUnimplemented() }
  set user (_u) { error.methodUnimplemented() }
  /**
   * @type {import('./api/dbtypes.js').DeviceClaim|null}
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
  get sentChallengeAnswer () { return false }
  set sentChallengeAnswer (_v) { error.methodUnimplemented() }

  /**
   * @type {WritableStream<{ messages: Array<Uint8Array>, origin: any }>}
   */
  get writer () { return error.methodUnimplemented() }
  /**
   * @type {AbortController}
   */
  get streamController () { return error.methodUnimplemented() }
  /**
   * The next expected clock from the remote client.
   * @type {number}
   */
  get nextClock () { return error.methodUnimplemented() }
  set nextClock (_v) { error.methodUnimplemented() }

  destroy () {
    error.methodUnimplemented()
  }

  /**
   * @param {number} [code]
   * @param {string} [reason]
   */
  close (code, reason) {
    error.methodUnimplemented()
  }
}
/* c8 ignore end */

/* c8 ignore start */
export class CommHandler {
  destroy () {}
}
/* c8 ignore end */

/* c8 ignore start */
/**
 * @interface
 */
export class CommConfiguration {
  /**
   * @param {Ystream} _ystream
   * @return {CommHandler}
   */
  init (_ystream) {
    error.methodUnimplemented()
  }
}
/* c8 ignore end */
