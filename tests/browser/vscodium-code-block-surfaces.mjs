async function webviewTargets(endpoint) {
  const targets = await fetch(`${endpoint}/json/list`).then(response => response.json())
  return targets.filter(candidate => candidate.type === 'iframe' && candidate.url.startsWith('vscode-webview://'))
}

async function evaluateTarget(target, expression) {
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
  try {
    await send('Runtime.enable')
    const response = await send('Runtime.evaluate', { expression, returnByValue: true })
    if (response.result.exceptionDetails) {
      throw new Error(response.result.exceptionDetails.exception?.description ?? 'Webview evaluation failed')
    }
    return response.result.result.value
  } finally {
    socket.close()
  }
}

const snapshotExpression = `(() => {
  const inner = document.querySelector('#active-frame')?.contentDocument
  if (!inner) return null
  const kind = inner.body.classList.contains('comparing') ? 'comparison'
    : inner.body.dataset.editorKind === 'readonly-commit' ? 'readonly' : 'normal'
  const editors = [...inner.querySelectorAll('.cm-editor')]
  return {
    kind,
    mode: inner.querySelector('#toggle-view')?.textContent ?? null,
    configurationError: inner.querySelector('#configuration-error')?.textContent ?? null,
    editors: editors.map((editor, index) => {
      const sourceLine = [...editor.querySelectorAll('.cm-codeblock-line')]
        .find(element => (element.textContent?.length ?? 0) > 80) ?? null
      const widget = editor.querySelector('.cm-shiki-codeblock')
      const code = widget?.querySelector('code, .cm-render-error-source') ?? null
      const logicalLine = code
        ? [...code.querySelectorAll('.line')].find(element => (element.textContent?.length ?? 0) > 80) ?? code
        : sourceLine
      const container = widget?.querySelector('pre') ?? sourceLine
      const range = logicalLine ? inner.createRange() : null
      if (range) range.selectNodeContents(logicalLine)
      const style = code ? getComputedStyle(code) : logicalLine ? getComputedStyle(logicalLine) : null
      const scroller = editor.querySelector('.cm-scroller')
      return {
        index,
        sameEditor: Array.isArray(globalThis.__perwriteCodeBlockEditors)
          ? editor === globalThis.__perwriteCodeBlockEditors[index] : null,
        generation: Number(editor.dataset.codeBlockWrapGeneration),
        enabled: editor.classList.contains('cm-codeblock-wrap-enabled'),
        disabled: editor.classList.contains('cm-codeblock-wrap-disabled'),
        whiteSpace: style?.whiteSpace ?? null,
        overflowWrap: style?.overflowWrap ?? null,
        clientWidth: container?.clientWidth ?? null,
        scrollWidth: container?.scrollWidth ?? null,
        rectTops: range ? [...new Set([...range.getClientRects()].map(rect => Math.round(rect.top * 100) / 100))] : [],
        editorClientWidth: scroller?.clientWidth ?? null,
        editorScrollWidth: scroller?.scrollWidth ?? null,
        editable: editor.querySelector('.cm-content')?.getAttribute('contenteditable') ?? null,
      }
    }),
  }
})()`

export async function inspectCodeBlockSurfaces(endpoint) {
  const targets = await webviewTargets(endpoint)
  return (await Promise.all(targets.map(async target => {
    const surface = await evaluateTarget(target, snapshotExpression)
    return surface ? { targetId: target.id, ...surface } : null
  }))).filter(Boolean)
}

export async function rememberCodeBlockEditors(endpoint) {
  const targets = await webviewTargets(endpoint)
  await Promise.all(targets.map(target => evaluateTarget(target, `(() => {
    const inner = document.querySelector('#active-frame')?.contentDocument
    if (!inner) return false
    globalThis.__perwriteCodeBlockEditors = [...inner.querySelectorAll('.cm-editor')]
    return true
  })()`)))
}

export function validateCodeBlockSurfaces(surfaces, expectedWrap, requireSameEditor = false) {
  const editors = surfaces.flatMap(surface => surface.editors)
  const kinds = surfaces.map(surface => surface.kind).sort()
  const generations = [...new Set(editors.map(editor => editor.generation))]
  const threeKinds = ['comparison', 'normal', 'readonly'].every(kind => kinds.includes(kind))
  const common = surfaces.length >= 3 && editors.length >= 4 && threeKinds &&
    surfaces.every(surface => surface.configurationError === null) &&
    generations.length === 1 && Number.isInteger(generations[0]) &&
    editors.every(editor => editor.editorScrollWidth <= editor.editorClientWidth + 1) &&
    (!requireSameEditor || editors.every(editor => editor.sameEditor))
  const geometry = expectedWrap
    ? editors.every(editor => editor.enabled && !editor.disabled && editor.whiteSpace === 'break-spaces' &&
        editor.overflowWrap === 'anywhere' && editor.scrollWidth <= editor.clientWidth + 1 &&
        editor.rectTops.length >= 2)
    : editors.every(editor => !editor.enabled && editor.disabled && editor.whiteSpace === 'pre' &&
        editor.overflowWrap === 'normal' && editor.scrollWidth > editor.clientWidth &&
        editor.rectTops.length === 1)
  if (!common || !geometry) {
    throw new Error(`Invalid ${expectedWrap ? 'enabled' : 'disabled'} code block surfaces: ${JSON.stringify({ surfaces, kinds, generations })}`)
  }
  return { surfaces, kinds, generations }
}

export async function waitForCodeBlockSurfaces(endpoint, expectedWrap, requireSameEditor = false) {
  let last = []
  for (let count = 0; count < 80; count++) {
    try {
      last = await inspectCodeBlockSurfaces(endpoint)
      return validateCodeBlockSurfaces(last, expectedWrap, requireSameEditor)
    } catch {
      await new Promise(accept => setTimeout(accept, 250))
    }
  }
  return validateCodeBlockSurfaces(last, expectedWrap, requireSameEditor)
}
