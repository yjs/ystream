import * as promise from 'lib0/promise'
import * as t from 'lib0/testing' // eslint-disable-line
import * as Ystream from '../src/index.js'
import * as actions from '@y/stream/api/actions'
import * as Y from 'yjs'
import * as array from 'lib0/array'
import * as wscomm from '../src/comms/websocket.js'
import * as env from 'lib0/environment'
import * as random from 'lib0/random'
import * as authentication from '../src/api/authentication.js'
import * as json from 'lib0/json'
import * as buffer from 'lib0/buffer'
import * as dbtypes from '../src/dbtypes.js'
import * as decoding from 'lib0/decoding'
import * as ecdsa from 'lib0/crypto/ecdsa'
import * as fun from 'lib0/function'

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
 * @typedef {Object} TestClientOptions
 */

export const owner = testUser.user.hash
export const collectionsDefiniton = [
  { owner: buffer.toBase64(owner), collection: 'c1' }
]

/**
 * @type {import('../src/comms/websocket-server.js').WSServer|null}
 */
export let server = null

if (env.isNode) {
  const fs = await import('node:fs')
  try {
    fs.rmSync('./.test_dbs', { recursive: true })
  } catch (e) {}
  const { createWSServer } = await import('../src/comms/websocket-server.js')
  server = await createWSServer({ dbname: `.test_dbs/${randTestRunName}-server`, identity: testServerIdentity })
  await authentication.registerUser(server.ystream, testUser.user)
  // @todo add roles and default permissions to colletcions
  // await authorization.updateCollaborator(server.ystream, owner, 'c1', 'ydoc', testUser.user, 'admin')
  console.log('server registered user hashes: ', await authentication.getAllRegisteredUserHashes(server.ystream))
}

/**
 * @param {t.TestCase} tc
 */
export const getDbName = tc => `.test_dbs/${randTestRunName}/${tc.moduleName}/${tc.testName}`

export const emptyUpdate = Y.encodeStateAsUpdateV2(new Y.Doc())

class TestClient {
  /**
   * @param {Ystream.Ystream} ystream
   * @param {{ owner: string, collection: string }} collectionDef
   */
  constructor (ystream, { owner, collection }) {
    this.ystream = ystream
    this.collection = ystream.getCollection(owner, collection)
    this.doc1 = this.collection.getYdoc('ydoc')
  }

  async destroy () {
    this.doc1.destroy()
    await promise.all([this.ystream.destroy()])
  }
}

class TestScenario {
  /**
   * @param {string} name
   */
  constructor (name) {
    this.name = name
    this.collectionDef = { owner: buffer.toBase64(owner), collection: this.name }
    /**
     * @type {Array<TestClient>}
     */
    this.clients = []
    this.cliNum = 0
    this.server = server
  }

  /**
   * @param {TestClientOptions} _options
   */
  async createClient (_options = {}) {
    const dbname = `.test_dbs/${randTestRunName}-${this.name}-${this.cliNum++}`
    await Ystream.remove(dbname)
    const ystream = await Ystream.open(dbname, {
      comms: [new wscomm.WebSocketComm('ws://localhost:9000', [this.collectionDef])]
    })
    console.log('registering server', testServerIdentity.user, testServerIdentity.user.hash)
    await authentication.registerUser(ystream, testServerIdentity.user, { isTrusted: true })
    await authentication.setUserIdentity(ystream, testUser.user, await testUser.user.publicKey, testUser.privateKey)
    const client = new TestClient(ystream, this.collectionDef)
    this.clients.push(client)
    return client
  }

  /**
   * @param {number} num
   */
  async createClients (num) {
    return promise.all(array.unfold(num, () => this.createClient()))
  }

  async destroy () {
    await promise.all(this.clients.map(client => client.destroy()))
  }
}

/**
 * @type {TestScenario?}
 */
let currTestScenario = null

/**
 * @param {t.TestCase} tc
 */
export const createTestScenario = async tc => {
  await currTestScenario?.destroy()
  currTestScenario = new TestScenario(getDbName(tc))
  return currTestScenario
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

/**
 * @param {Ystream.Collection} ycollection1
 * @param {Ystream.Collection} ycollection2
 */
export const waitCollectionsSynced = (ycollection1, ycollection2) =>
  promise.untilAsync(async () => {
    const sv1 = await actions.getStateVector(ycollection1.ystream, ycollection1.ownerBin, ycollection1.collection)
    const sv2 = await actions.getStateVector(ycollection2.ystream, ycollection2.ownerBin, ycollection2.collection)
    console.log({ sv1, sv2 })
    return fun.equalityDeep(sv1, sv2)
  }, 0, 100)
