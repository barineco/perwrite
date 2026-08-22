import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => {
  class Uri {
    constructor(readonly value: string) {}
    static joinPath(uri: Uri, ...parts: string[]) { return new Uri([uri.value, ...parts].join('/')) }
    toString() { return this.value }
    get path() { return this.value }
  }
  const configurationListeners: Array<(event: { affectsConfiguration(id: string): boolean }) => void> = []
  return { Uri, configurationListeners }
})

vi.mock('vscode', () => ({
  Uri: runtime.Uri,
  workspace: {
    onDidChangeConfiguration: (listener: (event: { affectsConfiguration(id: string): boolean }) => void) => { runtime.configurationListeners.push(listener); return { dispose() {} } },
    getConfiguration: () => ({ get: () => undefined }),
  },
  extensions: { getExtension: () => undefined },
  env: { openExternal: vi.fn() },
  commands: { executeCommand: vi.fn() },
}))

vi.mock('../src/perwrite-document', () => ({ PerwriteDocument: { open: vi.fn() } }))

import { PerwriteEditorProvider } from '../src/editor-provider'

interface MockPanel {
  readonly webview: {
    options: unknown
    html: string
    readonly messages: unknown[]
    asWebviewUri(uri: { toString(): string }): { toString(): string }
    postMessage(message: unknown): Promise<boolean>
    onDidReceiveMessage(listener: (message: unknown) => void): { dispose(): void }
  }
  receive(message: unknown): void
}

function panel(): MockPanel {
  let receive = (_message: unknown) => {}
  const webview = {
    options: undefined as unknown,
    html: '',
    messages: [] as unknown[],
    asWebviewUri: (uri: { toString(): string }) => ({ toString: () => `webview:${uri.toString()}` }),
    postMessage: vi.fn(async (message: unknown) => { webview.messages.push(message); return true }),
    onDidReceiveMessage: (listener: (message: unknown) => void) => { receive = listener; return { dispose() {} } },
  }
  return { webview, receive: message => receive(message), onDidDispose: () => ({ dispose() {} }) } as unknown as MockPanel
}

function document() {
  const stateListeners: Array<() => void> = []
  const state = {
    uri: 'file:note.md', generation: 3,
    savedSnapshot: { content: 'Saved', contentHash: 'saved', selection: [] },
    draftSnapshot: { content: 'Draft', contentHash: 'draft', selection: [2, 1] },
    externalChange: null,
  }
  return {
    uri: new runtime.Uri('file:note.md'), documentState: state, isDirty: true,
    onDidChange: () => ({ dispose() {} }),
    onDidChangeState: (listener: () => void) => { stateListeners.push(listener); return { dispose() {} } },
    applyEdit: vi.fn(() => false),
  }
}

async function flush(): Promise<void> { await new Promise(resolve => setTimeout(resolve, 0)) }

describe('PerwriteEditorProvider sessions', () => {
  beforeEach(() => { runtime.configurationListeners.length = 0 })

  it('broadcasts an identical canonical snapshot to each ready session and resynchronizes a rejected edit', async () => {
    const provider = new PerwriteEditorProvider({ extensionUri: new runtime.Uri('file:extension'), subscriptions: [] } as any)
    const shared = document()
    const first = panel(); const second = panel()
    await provider.resolveCustomEditor(shared as any, first as any)
    await provider.resolveCustomEditor(shared as any, second as any)

    first.receive({ type: 'ready' }); second.receive({ type: 'ready' })
    await flush()
    const firstSnapshot = first.webview.messages.find((message: any) => message.type === 'draft-snapshot')
    const secondSnapshot = second.webview.messages.find((message: any) => message.type === 'draft-snapshot')
    expect(firstSnapshot).toEqual(secondSnapshot)
    expect(firstSnapshot).toMatchObject({ content: 'Draft', contentHash: 'draft', selection: [2, 1], generation: 3, dirty: true })

    first.receive({ type: 'draft-edit', uri: 'file:note.md', generation: 3, beforeHash: 'wrong', changes: [], selection: [0, 0] })
    await flush()
    expect(shared.applyEdit).toHaveBeenCalledTimes(1)
    expect(first.webview.messages.filter((message: any) => message.type === 'draft-snapshot')).toHaveLength(2)
    expect(first.webview.messages.at(-1)).toEqual(firstSnapshot)
    expect(shared.documentState.draftSnapshot).toMatchObject({ content: 'Draft', selection: [2, 1] })
  })
})
