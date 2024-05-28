import fs from 'fs'
import * as t from 'lib0/testing' // eslint-disable-line
import * as helpers from './helpers.js'
import Yfs from '@y/stream/extensions/fs'
import cp from 'child_process'
import * as number from 'lib0/number'
import * as promise from 'lib0/promise'
import * as logging from 'lib0/logging'

/**
 * Testing loading from the database.
 *
 * @param {t.TestCase} tc
 */
export const testYfsQuickTest = async tc => {
  try {
    fs.rmSync('./tmp', { recursive: true })
  } catch (e) {}
  fs.mkdirSync('./tmp')
  fs.mkdirSync('./tmp/init')
  fs.cpSync('./bin', './tmp/init/bin', { recursive: true })
  fs.mkdirSync('./tmp/clone')
  const th = await helpers.createTestScenario(tc)
  const [{ collection: ycollection1 }, { collection: ycollection2 }] = await th.createClients(2)
  const yfs1 = new Yfs(ycollection1, { observePath: './tmp/init' })
  const yfs2 = new Yfs(ycollection2, { observePath: './tmp/clone' })
  const waitFilesSynced = async () => {
    console.log('before wait coll')
    await helpers.waitCollectionsSynced(ycollection1, ycollection2)
    console.log('after wait coll')
    await promise.untilAsync(async () => {
      const numOfInitFiles = number.parseInt(cp.execSync('find ./tmp/init | wc -l').toString()) - 1
      const numOfClonedFiles = number.parseInt(cp.execSync('find ./tmp/clone | wc -l').toString()) - 1
      const cs1 = await ycollection1.ystream.transact(tr => ycollection1.getDocChildrenRecursive(tr, null))
      const cs2 = await ycollection2.ystream.transact(tr => ycollection2.getDocChildrenRecursive(tr, null))
      console.log({ numOfClonedFiles, numOfInitFiles })
      console.log({ cs1: JSON.stringify(cs1), cs2: JSON.stringify(cs2) })
      return numOfClonedFiles === numOfInitFiles
    }, 0, 300)
  }
  console.log('before wait files synced')
  await waitFilesSynced()
  t.info('successfully synced initial files')
  yfs1.destroy()
  yfs2.destroy()
  await th.destroy()
}

/**
 * Testing loading from the database.
 *
 * @param {t.TestCase} tc
 */
export const testYfsBasics = async tc => {
  try {
    fs.rmSync('./tmp', { recursive: true })
  } catch (e) {}
  fs.mkdirSync('./tmp')
  fs.cpSync('./src', './tmp/init', { recursive: true })
  fs.mkdirSync('./tmp/clone')
  const th = await helpers.createTestScenario(tc)
  const [{ collection: ycollection1 }, { collection: ycollection2 }] = await th.createClients(2)
  const yfs1 = new Yfs(ycollection1, { observePath: './tmp/init' })
  const yfs2 = new Yfs(ycollection2, { observePath: './tmp/clone' })
  const waitFilesSynced = async (otherCollection = ycollection2, otherdir = './tmp/clone') => {
    await helpers.waitCollectionsSynced(ycollection1, otherCollection)
    await promise.untilAsync(async () => {
      const numOfInitFiles = number.parseInt(cp.execSync('find ./tmp/init | wc -l').toString()) - 1
      const numOfClonedFiles = number.parseInt(cp.execSync(`find ${otherdir} | wc -l`).toString()) - 1
      // const cs1 = await ycollection1.ystream.transact(tr => ycollection1.getDocChildrenRecursive(tr, null))
      // const cs2 = await other.ystream.transact(tr => other.getDocChildrenRecursive(tr, null))
      logging.print('yfs file sync status', { numOfClonedFiles, numOfInitFiles })
      // console.log({ cs1, cs2 })
      return numOfClonedFiles === numOfInitFiles
    }, 0, 300)
  }
  await t.measureTimeAsync('sync initial files', async () => {
    await waitFilesSynced()
  })
  await t.measureTimeAsync('sync file delete', async () => {
    cp.execSync('rm -rf ./tmp/clone/actions.js')
    await waitFilesSynced()
  })
  await t.measureTimeAsync('sync folder delete', async () => {
    cp.execSync('rm -rf ./tmp/clone/api')
    await waitFilesSynced()
  })
  await t.measureTimeAsync('sync copied folder', async () => {
    cp.execSync('cp -rf ./src ./tmp/init/src-copy')
    await waitFilesSynced()
  })
  await t.measureTimeAsync('move folder', async () => {
    cp.execSync('mv ./tmp/init/src-copy ./tmp/init/src-moved')
    await waitFilesSynced()
  })
  await t.measureTimeAsync('edit file', async () => {
    cp.execSync('echo newcontent > ./tmp/clone/index.js')
    await promise.wait(300)
    await waitFilesSynced()
    let fileContent = fs.readFileSync('./tmp/init/index.js').toString('utf8')
    while (fileContent[fileContent.length - 1] === '\n') {
      fileContent = fileContent.slice(0, -1)
    }
    t.compare(fileContent, 'newcontent')
  })
  await t.measureTimeAsync('copy node_modules', async () => {
    cp.execSync('cp -rf ./node_modules ./tmp/init/')
    await waitFilesSynced()
  })
  await t.measureTimeAsync('complete a full sync with a third client', async () => {
    fs.mkdirSync('./tmp/clone2')
    const [{ collection: ycollection3 }] = await th.createClients(1)
    const yfs3 = new Yfs(ycollection3, { observePath: './tmp/clone2' })
    await waitFilesSynced(ycollection3, './tmp/clone2')
    t.info('successfully completed a full sync with a third client')
    yfs3.destroy()
  })
  await yfs1.destroy()
  await yfs2.destroy()
  await th.destroy()
}
