import { readFileSync, writeFileSync } from 'node:fs'
import {
  rememberCodeBlockEditors,
  waitForCodeBlockSurfaces,
} from './vscodium-code-block-surfaces.mjs'

const endpoint = process.env.CDP_ENDPOINT
const settingsPath = process.env.VSCODE_SETTINGS_PATH
if (!endpoint || !settingsPath) {
  throw new Error('CDP_ENDPOINT and VSCODE_SETTINGS_PATH are required')
}

const targets = await fetch(`${endpoint}/json/list`).then(response => response.json())
const target = targets.find(candidate => candidate.type === 'iframe' && candidate.url.startsWith('vscode-webview://'))
if (!target) throw new Error('Perwrite Webview target is not available')

const socket = new WebSocket(target.webSocketDebuggerUrl)
const pending = new Map()
let nextId = 0
socket.onmessage = event => {
  const message = JSON.parse(event.data)
  const accept = pending.get(message.id)
  if (!accept) return
  pending.delete(message.id)
  accept(message)
}
await new Promise((accept, reject) => { socket.onopen = accept; socket.onerror = reject })
const send = (method, params = {}) => new Promise(accept => {
  const id = ++nextId
  pending.set(id, accept)
  socket.send(JSON.stringify({ id, method, params }))
})
await send('Runtime.enable')
const evaluate = expression => send('Runtime.evaluate', { expression, returnByValue: true })
  .then(message => message.result.result.value)
const inner = `document.querySelector('#active-frame')?.contentDocument`
const snapshot = () => evaluate(`(() => {
  const inner = ${inner}
  const svg = inner?.querySelector('.cm-mermaid-overview > svg')
  return {
    editor: Boolean(inner?.querySelector('.cm-editor')),
    error: inner?.querySelector('#configuration-error')?.textContent ?? null,
    mode: inner?.querySelector('#toggle-view')?.textContent ?? null,
    katex: inner?.querySelectorAll('.cm-katex-inline, .cm-katex-block').length ?? 0,
    geometry: svg ? {
      viewBox: svg.getAttribute('viewBox'),
      nodes: [...svg.querySelectorAll('.node')].map(element => element.getAttribute('transform')),
      edges: [...svg.querySelectorAll('.edgePath path, .edgePaths path')].map(element => element.getAttribute('d')),
    } : null,
    sameEditor: globalThis.__perwriteEditor
      ? inner?.querySelector('.cm-editor') === globalThis.__perwriteEditor
      : null,
  }
})()`)
const waitFor = async predicate => {
  for (let count = 0; count < 40; count++) {
    const value = await snapshot()
    if (predicate(value)) return value
    await new Promise(accept => setTimeout(accept, 250))
  }
  throw new Error(`Timed out waiting for settings transition: ${JSON.stringify(await snapshot())}`)
}
const base = JSON.parse(readFileSync(settingsPath, 'utf8'))
const writeSettings = values => writeFileSync(settingsPath, JSON.stringify({ ...base, ...values }, null, 2))

try {
  const initialInvalid = process.env.INSPECT_SETTINGS_EXISTING_ACTIVE === '1'
    ? { skipped: true, reason: 'existing active surfaces' }
    : await waitFor(value => !value.editor && value.error?.includes('perwrite.'))
  writeSettings({
    'perwrite.defaultViewMode': 'render', 'perwrite.mermaidLayout': 'elk',
    'perwrite.texRendering': true, 'perwrite.codeBlockWrap': true,
  })
  const activeElk = await waitFor(value => value.editor && !value.error && value.katex > 0 && value.geometry)
  const enabledSurfaces = await waitForCodeBlockSurfaces(endpoint, true)
  await evaluate(`globalThis.__perwriteEditor = ${inner}.querySelector('.cm-editor')`)
  await rememberCodeBlockEditors(endpoint)

  writeSettings({
    'perwrite.defaultViewMode': 'render', 'perwrite.mermaidLayout': 'elk',
    'perwrite.texRendering': 'invalid', 'perwrite.codeBlockWrap': true,
  })
  const activeInvalid = await waitFor(value => value.editor && value.error?.includes('perwrite.texRendering'))

  writeSettings({
    'perwrite.defaultViewMode': 'raw', 'perwrite.mermaidLayout': 'dagre',
    'perwrite.texRendering': false, 'perwrite.codeBlockWrap': false,
  })
  const activeDagre = await waitFor(value => value.sameEditor && !value.error && value.katex === 0 && value.geometry)
  const disabledSurfaces = await waitForCodeBlockSurfaces(endpoint, false, true)

  const result = { initialInvalid, activeElk, activeInvalid, activeDagre, enabledSurfaces, disabledSurfaces }
  console.log(JSON.stringify(result, null, 2))
  if (
    activeElk.mode !== 'Render' ||
    activeInvalid.sameEditor !== true ||
    activeDagre.mode !== 'Render' ||
    JSON.stringify(activeDagre.geometry) === JSON.stringify(activeElk.geometry) ||
    disabledSurfaces.generations[0] <= enabledSurfaces.generations[0]
  ) process.exitCode = 1
} finally {
  socket.close()
}
