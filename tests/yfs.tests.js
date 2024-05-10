import fs from 'fs'
import * as t from 'lib0/testing'
import * as helpers from './helpers.js'
import Yfs from '@y/stream/fs'
import * as promise from 'lib0/promise'
import cp from 'child_process'
import * as number from 'lib0/number'

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
  await promise.wait(2000)

  const numOfClonedFiles = number.parseInt(cp.execSync('find ./tmp/clone | wc -l').toString()) - 1
  console.log({ numOfFiles: numOfClonedFiles })
}
