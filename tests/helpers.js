import * as promise from 'lib0/promise'
import * as t from 'lib0/testing' // eslint-disable-line
import * as Ydb from '../src/index.js'
import * as Y from 'yjs'
import * as array from 'lib0/array'
import * as wscomm from '../src/comms/websocket.js'
import * as env from 'lib0/environment'
import * as random from 'lib0/random'
import * as authentication from '../src/api/authentication.js'
import * as authorization from '../src/api/authorization.js'
import * as json from 'lib0/json'
import * as buffer from 'lib0/buffer'
import * as dbtypes from '../src/dbtypes.js'
import * as decoding from 'lib0/decoding'
import * as ecdsa from 'lib0/crypto/ecdsa'

/**
 * New test runs shouldn't reuse old data
 */
const randTestRunName = random.uint32().toString(32)
console.log('random db name prefix: ' + randTestRunName)

const testUserRaw = {
  privateKey: '{"key_ops":["sign"],"ext":true,"kty":"EC","x":"pAUmLYc-UFmPIt7leafPTbhxQyygcaW7__nPcUNCuu0wH27yS9P_pWFP1GwcsoAN","y":"u3109KjrPGsNUn2k5Whn2uHLAckQPdLNqtM4GpBEpUJwlvVDvk71-lS3YOEYJ_Sq","crv":"P-384","d":"OHnRw5an9hlSqSKg966lFRvB7dow669pVSn7sFZUi7UQh_Y9Xc95SQ6pEWsofsYD"}',
  user: 'AMgBeyJrZXlfb3BzIjpbInZlcmlmeSJdLCJleHQiOnRydWUsImt0eSI6IkVDIiwieCI6InBBVW1MWWMtVUZtUEl0N2xlYWZQVGJoeFF5eWdjYVc3X19uUGNVTkN1dTB3SDI3eVM5UF9wV0ZQMUd3Y3NvQU4iLCJ5IjoidTMxMDlLanJQR3NOVW4yazVXaG4ydUhMQWNrUVBkTE5xdE00R3BCRXBVSndsdlZEdms3MS1sUzNZT0VZSl9TcSIsImNydiI6IlAtMzg0In0='
}

const testServerIdentityRaw = {
  privateKey: '{"key_ops":["sign"],"ext":true,"kty":"EC","x":"CYwMakpn0onaNeCa-wqLn4Fzsris_UY4Z5gRQUA9xQOoh94YG9OHhItr6rovaYpZ","y":"74Ulju86IUMJZsYsSjxSjusLjj9U6rozZwbK9Xaqj3MgIWtnjNyjL1D-NzOP3FJ7","crv":"P-384","d":"-yKNOty9EshGL0yAOQ2q6c_b_PNCpeEK9FVPoB0wc9EUyt9BR4DZuqrC9t_DgNaF"}',
  user: 'AMgBeyJrZXlfb3BzIjpbInZlcmlmeSJdLCJleHQiOnRydWUsImt0eSI6IkVDIiwieCI6IkNZd01ha3BuMG9uYU5lQ2Etd3FMbjRGenNyaXNfVVk0WjVnUlFVQTl4UU9vaDk0WUc5T0hoSXRyNnJvdmFZcFoiLCJ5IjoiNzRVbGp1ODZJVU1KWnNZc1NqeFNqdXNMamo5VTZyb3pad2JLOVhhcWozTWdJV3Ruak55akwxRC1Oek9QM0ZKNyIsImNydiI6IlAtMzg0In0='
}

const testUser = {
  privateKey: await ecdsa.importKeyJwk(json.parse(testUserRaw.privateKey)),
  user: dbtypes.UserIdentity.decode(decoding.createDecoder(buffer.fromBase64(testUserRaw.user)))
}

const testServerIdentity = {
  privateKey: await ecdsa.importKeyJwk(json.parse(testServerIdentityRaw.privateKey)),
  user: dbtypes.UserIdentity.decode(decoding.createDecoder(buffer.fromBase64(testServerIdentityRaw.user)))
}

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
  server = await createWSServer({ dbname: `.test_dbs/${randTestRunName}-server`, identity: testServerIdentity })
  await authentication.registerUser(server.ydb, testUser.user)
  // @todo add roles and default permissions to colletcions
  authorization.updateCollaborator(server.ydb, 'c1', 'ydoc', testUser.user, 'admin')
  authorization.updateCollaborator(server.ydb, 'c2', 'ydoc', testUser.user, 'admin')
  authorization.updateCollaborator(server.ydb, 'c3', 'ydoc', testUser.user, 'admin')
  authorization.updateCollaborator(server.ydb, 'collection', 'ydoc', testUser.user, 'admin')
  console.log('server registered user hashes: ', await authentication.getAllRegisteredUserHashes(server.ydb))
}

/**
 * @param {t.TestCase} tc
 */
export const getDbName = tc => `.test_dbs/${randTestRunName}/${tc.moduleName}/${tc.testName}`

export const emptyUpdate = Y.encodeStateAsUpdateV2(new Y.Doc())

class TestClient {
  /**
   * @param {Ydb.Ydb} ydb
   */
  constructor (ydb) {
    this.ydb = ydb
    this.doc1 = ydb.getYdoc('c1', 'ydoc')
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
    await authentication.setUserIdentity(ydb, testUser.user, await testUser.user.publicKey, testUser.privateKey)
    await authentication.registerUser(ydb, testServerIdentity.user)
    // @todo if collection content is empty, we should simply trust the server
    authorization.updateCollaborator(ydb, 'c1', 'ydoc', testServerIdentity.user, 'admin')
    authorization.updateCollaborator(ydb, 'c2', 'ydoc', testServerIdentity.user, 'admin')
    authorization.updateCollaborator(ydb, 'c3', 'ydoc', testServerIdentity.user, 'admin')
    authorization.updateCollaborator(ydb, 'collection', 'ydoc', testServerIdentity.user, 'admin')
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
