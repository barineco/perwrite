import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const codiumApplication = '/Applications/VSCodium - Insiders.app/Contents/MacOS/VSCodium - Insiders'
const temp = mkdtempSync('/tmp/pw-wrap-')
const userDataDir = join(temp, 'user-data')
const extensionsDir = join(temp, 'extensions')
const workspace = join(temp, 'workspace')
const probeExtension = join(temp, 'surface-probe')
const settingsPath = join(userDataDir, 'User', 'settings.json')
const probeResultPath = join(temp, 'probe-result.json')
const targetPath = join(workspace, 'target.md')
let child = null

const delay = milliseconds => new Promise(accept => setTimeout(accept, milliseconds))

async function unusedPort() {
  const server = createServer()
  await new Promise((accept, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', accept)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not allocate a CDP port')
  await new Promise(accept => server.close(accept))
  return address.port
}

async function retry(label, operation, attempts = 120) {
  let error = null
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const result = await operation()
      if (result) return result
    } catch (caught) {
      error = caught
    }
    await delay(250)
  }
  throw new Error(`${label} did not become ready${error ? `: ${error.message}` : ''}`)
}

function git(...args) {
  const result = spawnSync('git', args, {
    cwd: workspace,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'Perwrite Test', GIT_AUTHOR_EMAIL: 'perwrite@test.invalid', GIT_COMMITTER_NAME: 'Perwrite Test', GIT_COMMITTER_EMAIL: 'perwrite@test.invalid' },
  })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout.trim()
}

function fixtureContent(label) {
  return [
    `# ${label}`,
    '',
    'Inline math $x^2 + y^2$.',
    '',
    '```mermaid',
    'flowchart LR',
    '  A --> B',
    '  A --> C',
    '```',
    '',
    '```ts',
    `const ascii = "${label}-${'a'.repeat(180)}";`,
    `const url = "https://example.test/${'segment/'.repeat(30)}";`,
    `const unicode = "日本語é😀${'長い文字列'.repeat(36)}";`,
    '```',
    '',
  ].join('\n')
}

function createFixture() {
  mkdirSync(join(userDataDir, 'User'), { recursive: true })
  mkdirSync(extensionsDir, { recursive: true })
  mkdirSync(workspace, { recursive: true })
  mkdirSync(probeExtension, { recursive: true })
  writeFileSync(settingsPath, JSON.stringify({
    'perwrite.defaultViewMode': 'render',
    'perwrite.mermaidLayout': 'elk',
    'perwrite.texRendering': true,
    'perwrite.codeBlockWrap': true,
    'workbench.startupEditor': 'none',
    'window.restoreWindows': 'none',
    'security.workspace.trust.enabled': false,
  }, null, 2))
  writeFileSync(targetPath, fixtureContent('root'))
  git('init', '-q')
  git('add', 'target.md')
  git('commit', '-q', '-m', 'root')
  const rootHash = git('rev-parse', 'HEAD')
  writeFileSync(targetPath, fixtureContent('second'))
  git('add', 'target.md')
  git('commit', '-q', '-m', 'second')
  const secondHash = git('rev-parse', 'HEAD')
  writeFileSync(targetPath, fixtureContent('working'))
  writeFileSync(join(workspace, 'perwrite.code-workspace'), JSON.stringify({ folders: [{ path: '.' }] }))
  writeFileSync(join(probeExtension, 'package.json'), JSON.stringify({
    name: 'perwrite-code-block-surface-probe',
    version: '0.0.0',
    publisher: 'perwrite-test',
    engines: { vscode: '^1.120.0' },
    main: './extension.js',
    activationEvents: ['onStartupFinished'],
  }))
  writeFileSync(join(probeExtension, 'extension.js'), `'use strict'
const fs = require('fs')
const vscode = require('vscode')
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const targetPath = ${JSON.stringify(targetPath)}
const rootHash = ${JSON.stringify(rootHash)}
const secondHash = ${JSON.stringify(secondHash)}
const resultPath = ${JSON.stringify(probeResultPath)}
const gitUri = ref => vscode.Uri.from({ scheme: 'git', path: targetPath, query: JSON.stringify({ path: targetPath, ref }) })
async function activate() {
  await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(targetPath), 'perwrite.markdownEditor')
  await sleep(500)
  await vscode.commands.executeCommand('vscode.openWith', gitUri(secondHash), 'perwrite.markdownEditor')
  await sleep(500)
  await vscode.commands.executeCommand('vscode.openWith', gitUri(rootHash), 'perwrite.markdownEditor')
  fs.writeFileSync(resultPath, JSON.stringify({ rootHash, secondHash, opened: true }))
}
exports.activate = () => { void activate().catch(error => fs.writeFileSync(resultPath, JSON.stringify({ error: String(error?.stack ?? error) }))) }
`)
  return { rootHash, secondHash }
}

async function start(port) {
  const endpoint = `http://127.0.0.1:${port}`
  rmSync(probeResultPath, { force: true })
  child = spawn(codiumApplication, [
    `--extensionDevelopmentPath=${root}`,
    `--extensionDevelopmentPath=${join(root, 'theme-source')}`,
    `--extensionDevelopmentPath=${probeExtension}`,
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`,
    `--remote-debugging-port=${port}`,
    '--enable-proposed-api', 'barineco.perwrite',
    '--disable-workspace-trust',
    '--new-window',
    join(workspace, 'perwrite.code-workspace'),
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  await retry('VSCodium CDP endpoint', async () => {
    if (child.exitCode !== null) throw new Error(`VSCodium exited with ${child.exitCode}: ${stderr}`)
    const response = await fetch(`${endpoint}/json/list`)
    return response.ok
  })
  await retry('surface probe', () => {
    if (child.exitCode !== null) throw new Error(`VSCodium exited with ${child.exitCode}: ${stderr}`)
    try {
      const result = JSON.parse(readFileSync(probeResultPath, 'utf8'))
      if (result.error) throw new Error(result.error)
      return result.opened
    } catch (error) {
      if (error instanceof SyntaxError || error.code === 'ENOENT') return false
      throw error
    }
  })
  return { endpoint, pid: child.pid, stderr: () => stderr }
}

async function stop() {
  if (!child) return
  const running = child
  child = null
  running.kill('SIGTERM')
  await Promise.race([new Promise(accept => running.once('exit', accept)), delay(10000)])
  if (running.exitCode === null) {
    running.kill('SIGKILL')
    await new Promise(accept => running.once('exit', accept))
  }
}

function inspect(script, environment) {
  return execFileSync(process.execPath, [join(root, 'tests/browser', script)], {
    cwd: root,
    env: { ...process.env, ...environment },
    encoding: 'utf8',
  }).trim()
}

async function main() {
  const version = execFileSync('codium-insiders', ['--version'], { encoding: 'utf8' }).split(/\r?\n/)[0]
  const revisions = createFixture()
  const first = await start(await unusedPort())
  const trueWitness = inspect('inspect-vscodium-code-block-wrap.mjs', {
    CDP_ENDPOINT: first.endpoint,
    VSCODE_SETTINGS_PATH: settingsPath,
    EXPECTED_VSCODE_PID: String(first.pid),
    EXPECTED_CODE_BLOCK_WRAP: 'true',
  })
  const settingsWitness = inspect('inspect-settings.mjs', {
    CDP_ENDPOINT: first.endpoint,
    VSCODE_SETTINGS_PATH: settingsPath,
    INSPECT_SETTINGS_EXISTING_ACTIVE: '1',
  })
  const falseWitness = inspect('inspect-vscodium-code-block-wrap.mjs', {
    CDP_ENDPOINT: first.endpoint,
    VSCODE_SETTINGS_PATH: settingsPath,
    EXPECTED_VSCODE_PID: String(first.pid),
    EXPECTED_CODE_BLOCK_WRAP: 'false',
  })
  await stop()

  const second = await start(await unusedPort())
  if (second.pid === first.pid) throw new Error(`VSCodium PID was reused: ${second.pid}`)
  const restartWitness = inspect('inspect-vscodium-code-block-wrap.mjs', {
    CDP_ENDPOINT: second.endpoint,
    VSCODE_SETTINGS_PATH: settingsPath,
    EXPECTED_VSCODE_PID: String(second.pid),
    EXPECTED_CODE_BLOCK_WRAP: 'false',
  })
  console.log(JSON.stringify({
    version,
    fixture: temp,
    settingsPath,
    revisions,
    firstPid: first.pid,
    secondPid: second.pid,
    trueWitness: JSON.parse(trueWitness),
    settingsWitness: JSON.parse(settingsWitness),
    falseWitness: JSON.parse(falseWitness),
    restartWitness: JSON.parse(restartWitness),
  }, null, 2))
}

try {
  if (process.env.KEEP_VSCODIUM_FIXTURE === '1') console.error(`VSCodium fixture: ${temp}`)
  await main()
} finally {
  await stop()
  if (process.env.KEEP_VSCODIUM_FIXTURE !== '1') rmSync(temp, { recursive: true, force: true })
}
