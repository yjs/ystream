import fs from 'fs'
import * as t from 'lib0/testing' // eslint-disable-line
import * as helpers from './helpers.js'
import Yfs from '@y/stream/fs'
import cp from 'child_process'
import * as number from 'lib0/number'
import * as promise from 'lib0/promise'

/**
 * Testing loading from the database.
 *
 * @param {t.TestCase} tc
 */
export const testYfsBasics = async tc => {
  try {
    fs.rmdirSync('./tmp', { recursive: true })
  } catch (e) {}
  fs.mkdirSync('./tmp')
  fs.cpSync('./src', './tmp/init', { recursive: true })
  fs.mkdirSync('./tmp/clone')

  const th = await helpers.createTestScenario(tc)
  const [{ collection: ycollection1 }, { collection: ycollection2 }] = await th.createClients(2)
  const yfs1 = new Yfs(ycollection1, { observePath: './tmp/init' })
  const yfs2 = new Yfs(ycollection2, { observePath: './tmp/clone' })
  const waitFilesSynced = async () => {
    await helpers.waitCollectionsSynced(ycollection1, ycollection2)
    await promise.untilAsync(() => {
      const numOfInitFiles = number.parseInt(cp.execSync('find ./tmp/init | wc -l').toString()) - 1
      const numOfClonedFiles = number.parseInt(cp.execSync('find ./tmp/clone | wc -l').toString()) - 1
      console.log({ numOfClonedFiles, numOfInitFiles })
      return numOfClonedFiles === numOfInitFiles
    }, 0, 300)
  }
  await ycollection1.setLww('k', 'v')
  await waitFilesSynced()
  t.info('successfully synced initial files')
  cp.execSync('rm -rf ./tmp/clone/actions.js')
  await waitFilesSynced()
  t.info('successfully synced file delete')
  cp.execSync('rm -rf ./tmp/clone/api')
  await waitFilesSynced()
  t.info('successfully synced folder delete')
  cp.execSync('cp -rf ./src ./tmp/init/src-copy')
  await waitFilesSynced()
  t.info('succeffsully synced copied folder')
  cp.execSync('mv ./tmp/init/src-copy ./tmp/init/src-moved')
  await waitFilesSynced()
  t.info('succeffsully moved folder')
  cp.execSync('echo newcontent > ./tmp/clone/index.js')
  await waitFilesSynced()
  t.compare(fs.readFileSync('./tmp/init/index.js').toString(), 'newcontent\n')
  t.info('succeffsully edited file')
  yfs1.destroy()
  yfs2.destroy()
  await th.destroy()
}
