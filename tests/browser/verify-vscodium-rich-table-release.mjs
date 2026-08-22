import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const themeVersion = JSON.parse(readFileSync(join(root, 'theme-source', 'package.json'), 'utf8')).version
const extensionVsixPath = process.env.PERWRITE_VSIX_PATH ?? join(root, `perwrite-${packageVersion}.vsix`)
const expectedExtension = `barineco.perwrite@${packageVersion}`
const themeVsixPath = process.env.PERWRITE_THEME_VSIX_PATH
  ?? join(root, 'theme-source', `perwrite-theme-source-${themeVersion}.vsix`)
const codiumApplication = '/Applications/VSCodium - Insiders.app/Contents/MacOS/VSCodium - Insiders'
const temp = mkdtempSync('/tmp/perwrite-rich-table-release-')
const userDataDir = join(temp, 'user-data')
const extensionsDir = join(temp, 'extensions')
const workspace = join(temp, 'workspace')
const probeExtension = join(temp, 'surface-probe')
const targetPath = join(workspace, 'target.md')
const resultPath = join(temp, 'probe-result.json')
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
  await new Promise(resolve => server.close(resolve))
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

function fixtureContent() {
  const longAscii = 'a'.repeat(120)
  const longUnicode = '日本語😀'.repeat(36)
  const filler = 'The parser must retain this source line while the release probe waits for the table projection. '.repeat(8)
  return [
    '# Rich table release probe',
    '',
    '```ts',
    'const releaseProbe = true',
    '```',
    '',
    ...Array.from({ length: 20 }, (_, index) => `filler ${String(index).padStart(3, '0')} ${filler}`),
    '',
    '| label | value |',
    '|---|---|',
    `| 漢字😀 | ${longAscii} |`,
    '',
    'between tables',
    '',
    '| item | detail |',
    '|---|---|',
    `| second | ${longUnicode} |`,
    '',
  ].join('\n')
}

function installVsix(vsixPath) {
  if (!existsSync(vsixPath)) throw new Error(`VSIX package is unavailable: ${vsixPath}`)
  execFileSync('codium-insiders', ['--install-extension', vsixPath, '--force', `--extensions-dir=${extensionsDir}`], { encoding: 'utf8' })
}

function createFixture() {
  mkdirSync(join(userDataDir, 'User'), { recursive: true })
  mkdirSync(extensionsDir, { recursive: true })
  mkdirSync(workspace, { recursive: true })
  mkdirSync(probeExtension, { recursive: true })
  writeFileSync(join(userDataDir, 'User', 'settings.json'), JSON.stringify({
    'perwrite.defaultViewMode': 'rich',
    'perwrite.editorWidth': 960,
    'perwrite.contentPadding': 24,
    'perwrite.gutterGap': 24,
    'workbench.startupEditor': 'none',
    'window.restoreWindows': 'none',
    'security.workspace.trust.enabled': false,
  }, null, 2))
  writeFileSync(targetPath, fixtureContent())
  writeFileSync(join(workspace, 'perwrite.code-workspace'), JSON.stringify({ folders: [{ path: '.' }] }))
  writeFileSync(join(probeExtension, 'package.json'), JSON.stringify({
    name: 'perwrite-rich-table-release-probe',
    version: '0.0.0',
    publisher: 'perwrite-test',
    engines: { vscode: '^1.120.0' },
    main: './extension.js',
    activationEvents: ['onStartupFinished'],
  }))
  writeFileSync(join(probeExtension, 'extension.js'), `'use strict'\nconst fs = require('fs')\nconst vscode = require('vscode')\nconst sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))\nconst targetPath = ${JSON.stringify(targetPath)}\nconst resultPath = ${JSON.stringify(resultPath)}\nasync function activate() {\n  const uri = vscode.Uri.file(targetPath)\n  await vscode.commands.executeCommand('vscode.openWith', uri, 'perwrite.markdownEditor')\n  await sleep(1200)\n  fs.writeFileSync(resultPath, JSON.stringify({ opened: true }))\n}\nexports.activate = () => { void activate().catch(error => fs.writeFileSync(resultPath, JSON.stringify({ error: String(error?.stack ?? error) }))) }\n`)
}

function assert(condition, message, evidence) {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(evidence)}`)
}

async function main() {
  createFixture()
  installVsix(themeVsixPath)
  installVsix(extensionVsixPath)
  const port = await unusedPort()
  const endpoint = `http://127.0.0.1:${port}`
  child = spawn(codiumApplication, [
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
    return (await fetch(`${endpoint}/json/list`)).ok
  })
  await retry('probe extension', () => {
    try {
      const result = JSON.parse(readFileSync(resultPath, 'utf8'))
      if (result.error) throw new Error(result.error)
      return result.opened
    } catch (error) {
      if (error instanceof SyntaxError || error.code === 'ENOENT') return false
      throw error
    }
  })
  const targets = await fetch(`${endpoint}/json/list`).then(response => response.json())
  const target = targets.find(candidate => candidate.type === 'iframe' && candidate.url.startsWith('vscode-webview:') && candidate.url.includes('extensionId=barineco.perwrite'))
  if (!target) throw new Error(`Perwrite Webview target is unavailable: ${JSON.stringify(targets.map(value => ({ type: value.type, url: value.url })))}`)
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  const pending = new Map()
  const runtimeEvents = []
  let nextId = 0
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown' || message.method === 'Runtime.consoleAPICalled') runtimeEvents.push(message)
    const accept = pending.get(message.id)
    if (!accept) return
    pending.delete(message.id)
    accept(message)
  }
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  const send = (method, params = {}) => new Promise(resolve => {
    const id = ++nextId
    pending.set(id, resolve)
    socket.send(JSON.stringify({ id, method, params }))
  })
  await send('Runtime.enable')
  const evaluate = expression => send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then(message => {
    if (message.result.exceptionDetails) throw new Error(message.result.exceptionDetails.exception?.description ?? 'Evaluation failed')
    return message.result.result.value
  })
  try {
    await retry('editor view', () => evaluate(`Boolean(document.querySelector('#active-frame')?.contentDocument?.querySelector('.cm-editor'))`))
  } catch (error) {
    throw new Error(`${error.message}: ${JSON.stringify(runtimeEvents.slice(-10))}`)
  }
  await evaluate(`(async () => {
    const root = document.querySelector('#active-frame')?.contentDocument
    const editorView = root?.querySelector('.cm-content')?.cmTile?.view
    if (!editorView) return false
    editorView.focus()
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    editorView.dispatch({ selection: { anchor: editorView.state.doc.length }, scrollIntoView: true })
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return true
  })()`)
  const tableWitness = await retry('rich table surface', async () => {
    const witness = await evaluate(`(() => {
      const root = document.querySelector('#active-frame')?.contentDocument
      const editorView = root?.querySelector('.cm-content')?.cmTile?.view
      return {
        editor: Boolean(root?.querySelector('.cm-editor')),
        mode: root?.querySelector('#toggle-view')?.textContent ?? null,
        widgets: root?.querySelectorAll('.cm-table-widget').length ?? 0,
        document: editorView?.state.doc.toString() ?? '',
      }
    })()`)
    if (!witness.editor || witness.widgets !== 2) throw new Error(JSON.stringify({ ...witness, runtimeEvents: runtimeEvents.slice(-5) }))
    return witness
  })
  const selectionWitness = await evaluate(`(async () => {
    const frame = document.querySelector('#active-frame')
    const root = frame?.contentDocument
    const content = root.querySelector('.cm-content')
    const editorView = content?.cmTile?.view
    if (!editorView) return { error: 'editor view unavailable' }
    const source = editorView.state.doc.toString()
    const anchor = source.indexOf('漢字😀')
    frame.focus()
    frame.contentWindow?.focus()
    editorView.contentDOM.focus()
    editorView.contentDOM.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
    editorView.dispatch({ selection: { anchor } })
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return {
      focused: editorView.hasFocus,
      selection: editorView.state.selection.main.head,
      expectedSelection: anchor,
      widgets: root.querySelectorAll('.cm-table-widget').length,
      document: editorView.state.doc.toString(),
      sourceVisible: root.querySelector('.cm-content')?.textContent?.includes('| label | value |') ?? false,
    }
  })()`)
  assert(tableWitness.widgets === 2, 'Rich mode did not render both tables as TableWidget', tableWitness)
  assert(selectionWitness.widgets === 1 && selectionWitness.sourceVisible, 'Table selection did not reveal the complete source block', selectionWitness)
  const raw = await evaluate(`(async () => {
    const root = document.querySelector('#active-frame')?.contentDocument
    const toggle = root?.querySelector('#toggle-view')
    if (!toggle) return { error: 'view toggle unavailable' }
    toggle.click()
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    toggle.click()
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const editorView = root.querySelector('.cm-content')?.cmTile?.view
    return {
      mode: toggle.textContent,
      docPreserved: editorView?.state?.doc?.toString?.() === ${JSON.stringify(fixtureContent())},
      tables: root.querySelectorAll('.cm-table-widget').length,
      codeblock: root.querySelectorAll('.cm-codeblock').length,
      widgets: root.querySelectorAll('.cm-shiki-codeblock, .cm-mermaid-block, .cm-katex-block, .cm-katex-inline, .cm-table-widget').length,
    }
  })()`)
  assert(raw.mode === 'Raw', 'View toggle did not reach Raw mode', raw)
  assert(raw.docPreserved, 'Raw mode did not preserve the document value', raw)
  assert(raw.tables === 0 && raw.codeblock === 0 && raw.widgets === 0, 'Raw mode retained rendered decorations or widgets', raw)
  const result = {
    version: execFileSync('codium-insiders', ['--version'], { encoding: 'utf8' }).split(/\r?\n/)[0],
    extension: execFileSync('codium-insiders', ['--list-extensions', '--show-versions', `--extensions-dir=${extensionsDir}`], { encoding: 'utf8' }).split(/\r?\n/).find(line => line === expectedExtension),
    tableWitness,
    selectionWitness,
    raw,
  }
  console.log(JSON.stringify(result, null, 2))
  socket.close()
}

try {
  await main()
} finally {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM')
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(10000)])
    if (child.exitCode === null) child.kill('SIGKILL')
  }
  rmSync(temp, { recursive: true, force: true })
}
