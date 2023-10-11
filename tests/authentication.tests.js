import * as t from 'lib0/testing'
import * as authentication from '../src/api/authentication.js'
import * as dby from '../src/index.js'
import * as map from 'lib0/map'

/**
 * @type {Map<string, Array<dby.Ydb>>}
 */
const instances = new Map()

/**
 * @param {t.TestCase} tc
 */
const createTestDb = async tc => {
  const testInstances = map.setIfUndefined(instances, tc.testName, () => /** @type {any} */ ([]))
  const dbname = `./.test_dbs/${tc.moduleName}-${tc.testName}-${testInstances.length}`
  await dby.deleteYdb(dbname)
  const y = await dby.openYdb(dbname, [])
  testInstances.push(testInstances)
  return y
}

/**
 * @param {t.TestCase} tc
 */
export const testBasic = async tc => {
  const db1 = await createTestDb(tc)
  t.assert(db1.isAuthenticated === false)
  await authentication.generateUserIdentity(db1)
  t.assert(db1.isAuthenticated)
  const db2 = await createTestDb(tc)
  const device2 = await authentication.getDeviceIdentity(db2)
  // @todo maybe createDeviceClaim should return a dbtypes.DeviceClaim
  const claim1 = await authentication.createDeviceClaim(db1, device2)
  await authentication.useDeviceClaim(db2, claim1)
  t.assert(db2.isAuthenticated)
  const uid1 = await authentication.getUserIdentity(db1)
  const uid2 = await authentication.getUserIdentity(db2)
  t.assert(uid1.ekey === uid2.ekey)
}
