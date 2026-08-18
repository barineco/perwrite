export const endpoint = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9440'

export async function connectWorkbench() {
  const targets = await fetch(`${endpoint}/json/list`).then(response => response.json())
  const target = targets.find(candidate => candidate.type === 'page' && candidate.url.startsWith('vscode-file:'))
  if (!target) throw new Error('VSCodium workbench target is not available')
  return connect(target)
}

export async function connect(target) {
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
  const evaluate = expression => send('Runtime.evaluate', {
    expression,
    returnByValue: true,
  }).then(message => {
    if (message.result.exceptionDetails) {
      throw new Error(message.result.exceptionDetails.exception?.description ?? 'Evaluation failed')
    }
    return message.result.result.value
  })
  return { socket, send, evaluate }
}

export const wait = milliseconds => new Promise(accept => setTimeout(accept, milliseconds))

export async function key(client, type, value, code, modifiers = 0) {
  await client.send('Input.dispatchKeyEvent', { type, key: value, code, modifiers })
}

export async function press(client, value, code, modifiers = 0) {
  await key(client, 'keyDown', value, code, modifiers)
  await key(client, 'keyUp', value, code, modifiers)
}

export async function commandPalette(client, command) {
  await key(client, 'keyDown', 'Meta', 'MetaLeft', 4)
  await key(client, 'keyDown', 'Shift', 'ShiftLeft', 12)
  await key(client, 'keyDown', 'P', 'KeyP', 12)
  await key(client, 'keyUp', 'P', 'KeyP', 12)
  await key(client, 'keyUp', 'Shift', 'ShiftLeft', 4)
  await key(client, 'keyUp', 'Meta', 'MetaLeft', 0)
  await wait(300)
  await client.send('Input.insertText', { text: command })
  await wait(500)
  await press(client, 'Enter', 'Enter')
}

export async function quickOpen(client, target) {
  await key(client, 'keyDown', 'Meta', 'MetaLeft', 4)
  await key(client, 'keyDown', 'P', 'KeyP', 4)
  await key(client, 'keyUp', 'P', 'KeyP', 4)
  await key(client, 'keyUp', 'Meta', 'MetaLeft', 0)
  await wait(300)
  await client.send('Input.insertText', { text: target })
  await wait(500)
  await press(client, 'Enter', 'Enter')
}

export async function clickElementCenter(client, expression) {
  const point = await client.evaluate(`(() => {
    const element = ${expression}
    if (!element) return null
    const rect = element.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  if (!point) return false
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1,
  })
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1,
  })
  return true
}

export async function inspectPerwriteWebviews(predicate) {
  const targets = await fetch(`${endpoint}/json/list`).then(response => response.json())
  for (const target of targets.filter(candidate =>
    candidate.type === 'iframe' && candidate.url.startsWith('vscode-webview:'))) {
    const client = await connect(target)
    const result = await client.evaluate(`(() => {
      const inner = document.querySelector('#active-frame')?.contentDocument
      if (!inner) return null
      return (${predicate})(inner)
    })()`)
    client.socket.close()
    if (result) return result
  }
  return null
}

export async function inspectAllPerwriteWebviews(predicate) {
  const targets = await fetch(`${endpoint}/json/list`).then(response => response.json())
  const results = []
  for (const target of targets.filter(candidate =>
    candidate.type === 'iframe' && candidate.url.startsWith('vscode-webview:'))) {
    const client = await connect(target)
    results.push(await client.evaluate(`(() => {
      const inner = document.querySelector('#active-frame')?.contentDocument
      if (!inner) return null
      return (${predicate})(inner)
    })()`))
    client.socket.close()
  }
  return results
}
