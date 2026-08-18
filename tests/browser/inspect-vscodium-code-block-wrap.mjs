import { readFileSync } from 'node:fs'
import { inspectCodeBlockSurfaces, validateCodeBlockSurfaces } from './vscodium-code-block-surfaces.mjs'

const endpoint = process.env.CDP_ENDPOINT
const settingsPath = process.env.VSCODE_SETTINGS_PATH
const expectedPid = Number(process.env.EXPECTED_VSCODE_PID)
const expectedWrap = process.env.EXPECTED_CODE_BLOCK_WRAP === 'true'
if (!endpoint || !settingsPath || !Number.isInteger(expectedPid) || expectedPid <= 0
  || !['true', 'false'].includes(process.env.EXPECTED_CODE_BLOCK_WRAP ?? '')) {
  throw new Error('CDP_ENDPOINT, VSCODE_SETTINGS_PATH, EXPECTED_VSCODE_PID, and EXPECTED_CODE_BLOCK_WRAP are required')
}

const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
if (settings['perwrite.codeBlockWrap'] !== expectedWrap) {
  throw new Error(`perwrite.codeBlockWrap must be persisted as ${expectedWrap}`)
}

const surfaces = await inspectCodeBlockSurfaces(endpoint)
const validated = validateCodeBlockSurfaces(surfaces, expectedWrap)
console.log(JSON.stringify({
  pid: expectedPid,
  expectedWrap,
  settingsValue: settings['perwrite.codeBlockWrap'],
  ...validated,
}, null, 2))
