import test from 'node:test'
import assert from 'node:assert/strict'
import { satisfiesVscodeVersion } from './vscode-version.mjs'

test('VSCodium version adapter', () => {
  assert.equal(satisfiesVscodeVersion('1.120.0'), true)
  assert.equal(satisfiesVscodeVersion('1.121.4'), true)
  assert.equal(satisfiesVscodeVersion('1.120.0-insider'), true)
  assert.equal(satisfiesVscodeVersion('1.119.9'), false)
  assert.equal(satisfiesVscodeVersion('broken'), false)
  assert.equal(satisfiesVscodeVersion('1.120.0', 'broken'), false)
})
