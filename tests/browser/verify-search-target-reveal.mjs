import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { satisfiesVscodeVersion } from './vscode-version.mjs'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const startedAt = performance.now()
const temp = mkdtempSync(join(tmpdir(), 'perwrite-search-reveal-'))
const userDataDir = join(temp, 'user-data')
const workspace = join(temp, 'workspace')
const testExtension = join(temp, 'command-probe')
const targetPath = join(workspace, 'target.md')
const mismatchPath = join(workspace, 'mismatch.md')
const resultPath = join(temp, 'command-results.json')
let child = null

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function unusedPort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not allocate a CDP port')
  const { port } = address
  await new Promise(resolve => server.close(resolve))
  return port
}

async function retry(label, operation, attempts = 80, pause = 250) {
  let error
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await operation()
      if (result) return result
    } catch (caught) {
      error = caught
    }
    await delay(pause)
  }
  throw new Error(`${label} did not become ready after ${attempts} attempts${error ? `: ${error.message}` : ''}`)
}

function commandProbeSource() {
  return `'use strict'
const fs = require('fs')
const vscode = require('vscode')

const resultPath = ${JSON.stringify(resultPath)}
const targetPath = ${JSON.stringify(targetPath)}
const mismatchPath = ${JSON.stringify(mismatchPath)}
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function revealUntilSent(input) {
  let result = null
  const attempts = []
  for (let attempt = 0; attempt < 80; attempt++) {
    result = await vscode.commands.executeCommand('perwrite.revealTarget', input)
    attempts.push(result)
    if (result && result.status === 'sent') return { result, attempts }
    if (result?.status !== 'editor-not-ready' && result?.status !== 'target-not-found') return { result, attempts }
    await sleep(250)
  }
  return { result, attempts }
}

async function activate() {
  const target = vscode.Uri.file(targetPath)
  await vscode.commands.executeCommand('vscode.openWith', target, 'perwrite.markdownEditor')
  const validAttempt = await revealUntilSent({
    uri: target,
    range: new vscode.Range(new vscode.Position(55, 7), new vscode.Position(55, 13)),
  })
  const valid = validAttempt.result
  const mismatch = await vscode.commands.executeCommand('perwrite.revealTarget', {
    uri: vscode.Uri.file(mismatchPath),
    range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
  })
  const invalid = await vscode.commands.executeCommand('perwrite.revealTarget', { uri: target, range: 'invalid' })
  fs.writeFileSync(resultPath, JSON.stringify({ valid, validAttempts: validAttempt.attempts, mismatch, invalid }))
}

exports.activate = () => {
  void activate().catch(error => fs.writeFileSync(resultPath, JSON.stringify({ error: String(error && error.stack || error) })))
}
`
}

function createTestWorkspace() {
  mkdirSync(userDataDir, { recursive: true })
  mkdirSync(workspace, { recursive: true })
  mkdirSync(testExtension, { recursive: true })
  const lines = Array.from({ length: 100 }, (_, index) =>
    index === 55 ? 'line 055 target needle is here' : `line ${String(index).padStart(3, '0')} filler text`,
  )
  writeFileSync(targetPath, `${lines.join('\n')}\n`)
  writeFileSync(mismatchPath, 'mismatch\n')
  writeFileSync(join(workspace, 'perwrite.code-workspace'), JSON.stringify({ folders: [{ path: '.' }] }))
  writeFileSync(join(testExtension, 'package.json'), JSON.stringify({
    name: 'perwrite-search-reveal-command-probe',
    version: '0.0.0',
    publisher: 'perwrite-test',
    engines: { vscode: '^1.120.0' },
    main: './extension.js',
    activationEvents: ['onStartupFinished'],
  }))
  writeFileSync(join(testExtension, 'extension.js'), commandProbeSource())
}

function codiumVersion() {
  const output = execFileSync('codium-insiders', ['--version'], { encoding: 'utf8' })
  const version = output.split(/\r?\n/).find(line => /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(line.trim()))?.trim()
  if (!version) throw new Error(`Could not parse codium-insiders version: ${JSON.stringify(output)}`)
  return version
}

function assert(condition, message, evidence) {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(evidence)}`)
}

async function readCommandResults() {
  return retry('command probe result', async () => {
    try {
      return JSON.parse(readFileSync(resultPath, 'utf8'))
    } catch {
      return null
    }
  })
}

async function main() {
  const version = codiumVersion()
  assert(satisfiesVscodeVersion(version, manifest.engines.vscode), 'Unsupported VSCodium version', {
    version,
    engines: manifest.engines.vscode,
  })
  createTestWorkspace()
  const port = await unusedPort()
  const endpoint = `http://127.0.0.1:${port}`
  process.env.CDP_ENDPOINT = endpoint
  const { connectWorkbench, inspectPerwriteWebviews } = await import('./vscodium-cdp.mjs')
  child = spawn('codium-insiders', [
    `--extensionDevelopmentPath=${root}`,
    `--extensionDevelopmentPath=${testExtension}`,
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${port}`,
    '--disable-workspace-trust',
    workspace,
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  await retry('VSCodium workbench', async () => {
    try {
      return await connectWorkbench()
    } catch {
      return null
    }
  }).then(client => client.socket.close())

  const commandResults = await readCommandResults()
  assert(!commandResults.error, 'Probe extension failed', commandResults)
  assert(commandResults.valid?.status === 'sent', 'Valid public command did not send', commandResults)
  assert(commandResults.mismatch?.status === 'target-not-found', 'URI mismatch did not report target-not-found', commandResults)
  assert(commandResults.invalid?.status === 'invalid-arguments', 'Invalid command input did not report invalid-arguments', commandResults)

  const observed = await retry('Perwrite reveal decoration', () => inspectPerwriteWebviews(inner => {
    const line = inner.querySelector('.cm-reveal-target-line')
    const exact = inner.querySelector('.cm-reveal-target-exact')
    const scroller = inner.querySelector('.cm-scroller')
    const content = inner.querySelector('.cm-content')
    if (!line || !exact || !scroller || !content) return null
    const lineRect = line.getBoundingClientRect()
    const exactRect = exact.getBoundingClientRect()
    const contentRect = content.getBoundingClientRect()
    const scrollRect = scroller.getBoundingClientRect()
    const lineHeight = lineRect.height
    const safeBand = { top: scrollRect.top + lineHeight, bottom: scrollRect.bottom - lineHeight }
    const observed = {
      lineRect: { left: lineRect.left, right: lineRect.right, top: lineRect.top, bottom: lineRect.bottom, width: lineRect.width, height: lineRect.height },
      exactRect: { left: exactRect.left, right: exactRect.right, top: exactRect.top, bottom: exactRect.bottom, width: exactRect.width, height: exactRect.height },
      contentRect: { left: contentRect.left, right: contentRect.right, width: contentRect.width },
      scrollTop: scroller.scrollTop,
      safeBand,
      lineBackground: getComputedStyle(line).backgroundColor,
      exactBackground: getComputedStyle(exact).backgroundColor,
    }
    return observed.scrollTop > 0 && observed.lineRect.top >= observed.safeBand.top &&
      observed.lineRect.bottom <= observed.safeBand.bottom ? observed : null
  }))
  assert(observed.lineRect.width >= observed.contentRect.width - 1 &&
    Math.abs(observed.lineRect.left - observed.contentRect.left) <= 1 &&
    Math.abs(observed.lineRect.right - observed.contentRect.right) <= 1,
  'Reveal line does not span the editor content width', observed)
  assert(observed.exactRect.width > 0 && observed.exactRect.left >= observed.lineRect.left &&
    observed.exactRect.right <= observed.lineRect.right, 'Reveal exact mark is not within the target line', observed)
  assert(observed.lineBackground !== 'rgba(0, 0, 0, 0)' && observed.exactBackground !== 'rgba(0, 0, 0, 0)',
    'Reveal backgrounds are not computed', observed)
  assert(observed.scrollTop > 0 && observed.lineRect.top >= observed.safeBand.top && observed.lineRect.bottom <= observed.safeBand.bottom,
    'Reveal target was not scrolled into the safe band', observed)

  console.log(JSON.stringify({
    version,
    engines: manifest.engines.vscode,
    commandStatuses: {
      valid: commandResults.valid.status,
      mismatch: commandResults.mismatch.status,
      invalid: commandResults.invalid.status,
    },
    observed,
    durationMs: Math.round(performance.now() - startedAt),
  }))
}

try {
  await main()
} finally {
  if (child && !child.killed) {
    child.kill('SIGTERM')
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)])
    if (!child.killed) child.kill('SIGKILL')
  }
  rmSync(temp, { recursive: true, force: true })
}
