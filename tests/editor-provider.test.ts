import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => {
  class Uri {
    constructor(readonly value: string) {}
    static joinPath(uri: Uri, ...parts: string[]) { return new Uri([uri.value, ...parts].join('/')) }
    static file(value: string) { return new Uri(value.startsWith('file:') ? value : `file:${value}`) }
    toString() { return this.value }
    get path() { return this.value }
  }
  const configurationListeners: Array<(event: { affectsConfiguration(id: string): boolean }) => void> = []
  return { Uri, configurationListeners, openDocument: undefined as any }
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

vi.mock('../src/perwrite-document', () => ({ PerwriteDocument: { open: vi.fn(async () => runtime.openDocument) } }))
vi.mock('../src/git-source', () => ({
  resolveUriComparison: vi.fn(() => ({ ok: true, value: { actualFsPath: 'file:note.md', comparison: { original: { kind: 'index' }, modified: { kind: 'working-tree' } } } })),
  readRevisionSnapshot: vi.fn(async (_provider: unknown, _uri: unknown, revision: any, _side: unknown, working?: any) => ({ ok: true, value: revision.kind === 'working-tree' ? { physicalUri: 'file:note.md', revisionIdentity: { kind: 'working-tree' }, content: working.content, contentHash: 'draft', provenance: { kind: 'working-tree', documentVersion: working.documentVersion } } : { physicalUri: 'file:note.md', revisionIdentity: { kind: 'index' }, content: 'Index', contentHash: 'index', provenance: { kind: 'index', documentVersion: 0 } } })),
  revisionLabel: (revision: any) => revision.kind === 'working-tree' ? 'Working Tree' : revision.kind === 'index' ? 'Index' : revision.ref,
  editableSideFor: (original: any, modified: any) => original.kind === 'working-tree' ? 'original' : modified.kind === 'working-tree' ? 'modified' : null,
}))

import { PerwriteEditorProvider } from '../src/editor-provider'

interface MockPanel {
  dispose(): void
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
  let disposePanel = () => {}
  const webview = {
    options: undefined as unknown,
    html: '',
    messages: [] as unknown[],
    asWebviewUri: (uri: { toString(): string }) => ({ toString: () => `webview:${uri.toString()}` }),
    postMessage: vi.fn(async (message: unknown) => { webview.messages.push(message); return true }),
    onDidReceiveMessage: (listener: (message: unknown) => void) => { receive = listener; return { dispose() {} } },
  }
  return { webview, receive: message => receive(message), dispose: () => disposePanel(), onDidDispose: (listener: () => void) => { disposePanel = listener; return { dispose() {} } } } as unknown as MockPanel
}

function document() {
  const stateListeners: Array<() => void> = []
  const stateSubscription = { dispose: vi.fn() }
  const state = {
    uri: 'file:note.md', generation: 3,
    savedSnapshot: { content: 'Saved', contentHash: 'saved', selection: [] },
    draftSnapshot: { content: 'Draft', contentHash: 'draft', selection: [2, 1] },
    externalChange: null,
  }
  return {
    uri: new runtime.Uri('file:note.md'), documentState: state, isDirty: true,
    onDidChange: vi.fn(() => ({ dispose() {} })),
    onDidChangeState: vi.fn((listener: () => void) => { stateListeners.push(listener); return stateSubscription }),
    applyEdit: vi.fn(() => false),
    save: vi.fn(async () => null),
  }
}

async function flush(): Promise<void> { await new Promise(resolve => setTimeout(resolve, 0)) }

describe('PerwriteEditorProvider sessions', () => {
  beforeEach(() => { runtime.configurationListeners.length = 0 })

  it('resolves proposal documents into comparison-init, edits the durable working tree, and refuses the revision side', async () => {
    const provider = new PerwriteEditorProvider({ extensionUri: new runtime.Uri('file:extension'), subscriptions: [] } as any)
    const original = document(); original.uri = new runtime.Uri('git:note.md')
    const modified = document(); modified.applyEdit.mockReturnValue(true); runtime.openDocument = modified
    const inline = panel()
    await provider.resolveCustomEditorInlineDiff({ original, modified } as any, inline as any, {} as any)
    inline.receive({ type: 'ready' }); await flush()
    const init = inline.webview.messages.find((message: any) => message.type === 'comparison-init') as any
    expect(init.result.value.modified.snapshot.content).toBe('Draft')
    expect(init.result.value.modified.documentId).toBe('file:note.md')
    expect(init.result.value.editableSide).toBe('modified')
    expect(original.onDidChange).toHaveBeenCalledTimes(1)
    expect(modified.onDidChange).toHaveBeenCalledTimes(1)
    inline.receive({ type: 'draft-edit', uri: 'file:note.md', generation: 3, beforeHash: 'draft', changes: [], selection: [0, 0] })
    inline.receive({ type: 'draft-edit', uri: 'file:note.md?revision=index', generation: 3, beforeHash: 'index', changes: [], selection: [] })
    inline.receive({ type: 'save', documentId: 'file:note.md' })
    await flush()
    expect(modified.applyEdit).toHaveBeenCalledTimes(1)
    expect(modified.save).toHaveBeenCalledTimes(1)
    inline.dispose()
    expect(modified.onDidChangeState.mock.results[0].value.dispose).toHaveBeenCalledTimes(1)
  })

  it('uses the freshly opened physical snapshot when the same URI is reopened', async () => {
    const provider = new PerwriteEditorProvider({ extensionUri: new runtime.Uri('file:extension'), subscriptions: [] } as any)
    const firstDocument = document()
    const reopenedDocument = document()
    reopenedDocument.documentState.savedSnapshot = { content: 'External', contentHash: 'external', selection: [] }
    reopenedDocument.documentState.draftSnapshot = { content: 'External', contentHash: 'external', selection: [] }
    reopenedDocument.documentState.generation = 0
    reopenedDocument.isDirty = false

    runtime.openDocument = firstDocument
    expect(await provider.openCustomDocument(firstDocument.uri, {})).toBe(firstDocument)
    runtime.openDocument = reopenedDocument
    const reopened = await provider.openCustomDocument(reopenedDocument.uri, {})
    expect(reopened).toBe(reopenedDocument)

    const reopenedPanel = panel()
    await provider.resolveCustomEditor(reopened as any, reopenedPanel as any)
    reopenedPanel.receive({ type: 'ready' })
    await flush()
    expect(reopenedPanel.webview.messages.find((message: any) => message.type === 'init')).toMatchObject({ content: 'External', documentVersion: 0 })
    expect(reopenedPanel.webview.messages.find((message: any) => message.type === 'draft-snapshot')).toMatchObject({ content: 'External', contentHash: 'external', dirty: false })
    expect(firstDocument.onDidChange).toHaveBeenCalledTimes(1)
    expect(reopenedDocument.onDidChange).toHaveBeenCalledTimes(1)
  })

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
