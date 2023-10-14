import * as promise from 'lib0/promise'
import * as t from 'lib0/testing' // eslint-disable-line
import * as Ydb from '../src/index.js'
import * as Y from 'yjs'
import * as array from 'lib0/array'
import * as wscomm from '../src/comms/websocket.js'
import * as env from 'lib0/environment'
import * as random from 'lib0/random'
import * as authentication from '../src/api/authentication.js'

/**
 * New test runs shouldn't reuse old data
 */
const randTestRunName = random.uint32().toString(32)
console.log('random db name prefix: ' + randTestRunName)

/**
 * @type {import('../src/comms/websocket-server.js').WSServer|null}
 */
let server = null

if (env.isNode) {
  const fs = await import('fs')
  try {
    fs.rmSync('./.test_dbs', { recursive: true })
  } catch (e) {}
  const { createWSServer } = await import('../src/comms/websocket-server.js')
  server = await createWSServer({ dbname: `.test_dbs/${randTestRunName}-server` })
}

/**
 * @param {t.TestCase} tc
 */
const getDbName = tc => `.test_dbs/${randTestRunName}/${tc.moduleName}/${tc.testName}`

export const emptyUpdate = Y.encodeStateAsUpdateV2(new Y.Doc())

class TestClient {
  /**
   * @param {Ydb.Ydb} ydb
   */
  constructor (ydb) {
    this.ydb = ydb
    this.doc1 = ydb.getYdoc('c1', 'testdoc')
  }
}

/**
 * @typedef {Object} TestClientOptions
 * @property {Array<string>} [TestClientOptions.collections]
 */

class TestScenario {
  /**
   * @param {string} name
   */
  constructor (name) {
    this.name = name
    /**
     * @type {Array<Ydb.Ydb>}
     */
    this.clients = []
    this.cliNum = 0
    this.server = server
  }

  /**
   * @param {TestClientOptions} options
   */
  async createClient ({ collections = ['c1', 'c2', 'c3'] } = {}) {
    const dbname = `.test_dbs/${randTestRunName}-${this.name}-${this.cliNum++}`
    await Ydb.deleteYdb(dbname)
    const ydb = await Ydb.openYdb(dbname, collections, {
      comms: [new wscomm.WebSocketComm('ws://localhost:9000')]
    })
    await authentication.generateUserIdentity(ydb)
    server
    this.clients.push(ydb)
    return new TestClient(ydb)
  }

  /**
   * @param {number} num
   */
  async createClients (num) {
    return promise.all(array.unfold(num, () => this.createClient()))
  }
}

/**
 * @param {t.TestCase} tc
 */
export const createTestScenario = tc => new TestScenario(getDbName(tc))

/**
 * @param {Y.Doc} ydoc1
 * @param {Y.Doc} ydoc2
 */
export const waitDocsSynced = (ydoc1, ydoc2) =>
  promise.until(0, () => {
    const e1 = Y.encodeStateAsUpdateV2(ydoc1)
    const e2 = Y.encodeStateAsUpdateV2(ydoc2)
    return array.equalFlat(e1, e2)
  })
