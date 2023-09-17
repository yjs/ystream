import * as promise from 'lib0/promise'
import * as t from 'lib0/testing' // eslint-disable-line
import * as Ydb from '../src/index.js'
import * as Y from 'yjs'
import * as array from 'lib0/array'
import * as wscomm from '../src/comms/websocket.js'
import '../src/comms/websocket-server.js'

/**
 * @param {t.TestCase} tc
 */
const getDbName = tc => `.test_dbs/${tc.moduleName}/${tc.testName}`

export const emptyUpdate = Y.encodeStateAsUpdateV2(new Y.Doc())

class TestClients {
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
  }

  async createClient () {
    const dbname = `${this.name}-${this.cliNum++}`
    await Ydb.deleteYdb(dbname)
    const ydb = await Ydb.openYdb(dbname, ['c1', 'c2', 'c3'], {
      comms: [new wscomm.WebSocketComm('ws://localhost:9000')]
    })
    this.clients.push(ydb)
    return ydb
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
export const createTestHelper = tc => new TestClients(getDbName(tc))

/**
 * @todo this should return a class that creates Ydb instances. Also rename this to Udb.
 *
 * @param {t.TestCase} tc
 */
export const getTestClients = async tc => {
  await promise.all([
    Ydb.deleteYdb(getDbName(tc) + '-1'),
    Ydb.deleteYdb(getDbName(tc) + '-2'),
    Ydb.deleteYdb(getDbName(tc) + '-3'),
    Ydb.deleteYdb(getDbName(tc) + '-4')
  ])
  const [ydb1, ydb2, ydb3, ydb4] = await promise.all([
    Ydb.openYdb(getDbName(tc) + '-1', ['c1', 'c2', 'c3']),
    Ydb.openYdb(getDbName(tc) + '-2', ['c1', 'c2', 'c3']),
    Ydb.openYdb(getDbName(tc) + '-3', ['c1', 'c2', 'c3']),
    Ydb.openYdb(getDbName(tc) + '-4', ['c1', 'c2', 'c3'])
  ])
  return {
    ydb1,
    ydb2,
    ydb3,
    ydb4
  }
}

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
