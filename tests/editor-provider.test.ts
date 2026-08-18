import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => {
  class Uri {
    public readonly scheme: string; public readonly path: string; public readonly fsPath: string; public readonly query: string
    private constructor(value: string, query = '') { const parsed = /^([a-z]+):\/\/(.*)$/i.exec(value); this.scheme = parsed?.[1] ?? 'file'; this.path = parsed ? `/${parsed[2].split('?')[0]}`.replace(/^\/\//, '/') : value; this.fsPath = this.path; this.query = query || (value.split('?')[1] ?? '') }
    static file(path: string) { return new Uri(`file://${path}`) }
    static parse(value: string) { return new Uri(value) }
    static joinPath(uri: Uri, ...parts: string[]) { return Uri.file([uri.fsPath, ...parts].join('/').replace(/\/[^/]+\/\.\.$/, '')) }
    toString() { return `${this.scheme}://${this.fsPath.replace(/^\//, '')}${this.query ? `?${this.query}` : ''}` }
  }
  class Position { constructor(public readonly line: number, public readonly character: number) {} }
  class Range { constructor(public readonly start: Position, public readonly end: Position) {} isEqual(other: Range) { return this.start.line === other.start.line && this.start.character === other.start.character && this.end.line === other.end.line && this.end.character === other.end.character } }
  class WorkspaceEdit {
    public readonly replacements: Array<{ uri: Uri; range: Range; text: string }> = []
    replace(uri: Uri, range: Range, text: string) { this.replacements.push({ uri, range, text }) }
  }
  return {
    Uri, Position, Range, WorkspaceEdit, open: vi.fn(), post: vi.fn(), applyEdit: vi.fn(), gitCommit: vi.fn(), gitShow: vi.fn(), dispose: vi.fn(),
    textDocuments: [] as any[],
    changeListeners: [] as Array<(event: any) => void>,
    configurationListeners: [] as Array<(event: any) => void>,
    configuration: new Map<string, unknown>([
      ['defaultViewMode', 'render'], ['mermaidLayout', 'elk'], ['mermaidMaxEdges', 1024],
      ['mermaidPanStep', 80], ['mermaidZoomStep', 1.5], ['texRendering', true], ['codeBlockWrap', true],
    ]),
  }
})
const { Uri, Position, Range } = runtime

vi.mock('vscode', () => ({
  Uri: runtime.Uri, Range: runtime.Range, Position: runtime.Position, WorkspaceEdit: runtime.WorkspaceEdit,
  workspace: {
    openTextDocument: runtime.open,
    textDocuments: runtime.textDocuments, workspaceFolders: [],
    onDidChangeTextDocument: (listener: (event: any) => void) => {
      runtime.changeListeners.push(listener)
      return { dispose() {} }
    },
    onDidChangeConfiguration: (listener: (event: any) => void) => {
      runtime.configurationListeners.push(listener)
      return { dispose() {} }
    },
    getConfiguration: () => ({ get: (name: string) => runtime.configuration.get(name) }),
    applyEdit: runtime.applyEdit, fs: { stat: vi.fn() },
  },
  window: { onDidChangeActiveColorTheme: () => ({ dispose() {} }) },
  extensions: { getExtension: () => ({ isActive: true, exports: { getAPI: () => ({
    getRepository: () => ({ rootUri: runtime.Uri.file('/repo'), getCommit: runtime.gitCommit, show: runtime.gitShow }),
  }) } }) },
  commands: { executeCommand: vi.fn() }, env: { openExternal: vi.fn() },
}))

import { PerwriteEditorProvider } from '../src/editor-provider'

const uri = Uri.file('/repo/target.md')
const range = new Range(new Position(0, 1), new Position(0, 3))
const context = { extensionUri: Uri.file('/extension'), subscriptions: [] } as any
const textDocument = { uri, getText: () => 'alpha', validateRange: (value: Range) => value, offsetAt: (value: Position) => value.character, positionAt: (offset: number) => new Position(0, offset), save: vi.fn() }

function panel() {
  let received: ((message: any) => void) | undefined
  let disposed: (() => void) | undefined
  const webview = {
    options: {}, html: '', cspSource: 'vscode-webview:', asWebviewUri: (value: Uri) => value,
    postMessage: (...args: any[]) => runtime.post(...args),
    onDidReceiveMessage: (listener: (message: any) => void) => { received = listener; return { dispose() {} } },
  }
  return { webview, onDidDispose: (listener: () => void) => { disposed = listener; return { dispose() {} } }, ready: () => received?.({ type: 'ready' }), editorReady: (documentIds = [uri.toString()]) => received?.({ type: 'editor-ready', documentIds }), emit: (message: unknown) => received?.(message), dispose: () => disposed?.() } as any
}

function editableTextDocument(content: string, version: number) {
  let currentContent = content
  let currentVersion = version
  return {
    uri,
    getText: () => currentContent,
    get version() { return currentVersion },
    validateRange: (value: Range) => value,
    offsetAt: (value: Position) => value.character,
    positionAt: (offset: number) => new Position(0, offset),
    save: vi.fn(),
    apply(replacements: readonly { range: Range; text: string }[]) {
      for (const replacement of [...replacements].sort((left, right) => right.range.start.character - left.range.start.character)) {
        currentContent = currentContent.slice(0, replacement.range.start.character) + replacement.text + currentContent.slice(replacement.range.end.character)
      }
      currentVersion++
    },
    replace(content: string) {
      currentContent = content
      currentVersion++
    },
  }
}

async function settleEdit() {
  await new Promise(resolve => setTimeout(resolve, 0))
  await Promise.resolve()
}

beforeEach(() => {
  runtime.changeListeners.length = 0
  runtime.configurationListeners.length = 0
  runtime.textDocuments.length = 0
  runtime.open.mockReset().mockResolvedValue(textDocument)
  runtime.post.mockReset().mockResolvedValue(true)
  runtime.applyEdit.mockReset().mockResolvedValue(false)
  runtime.gitCommit.mockReset().mockResolvedValue({ hash: 'a'.repeat(40), parents: [] })
  runtime.gitShow.mockReset().mockResolvedValue('commit content')
})

describe('PerwriteEditorProvider verified edit effects', () => {
  it('applies the edit once and posts the reducer success observation after the session snapshot updates', async () => {
    const document = editableTextDocument('alpha', 1)
    runtime.textDocuments.push(document)
    runtime.open.mockResolvedValue(document)
    runtime.applyEdit.mockImplementation(async (workspaceEdit: { replacements: Array<{ range: Range; text: string }> }) => {
      document.apply(workspaceEdit.replacements)
      return true
    })
    const provider = new PerwriteEditorProvider(context)
    const target = panel()
    await provider.resolveCustomTextEditor(document, target, {} as any)
    target.ready()
    await settleEdit()
    target.editorReady()
    runtime.post.mockClear()

    const request = {
      type: 'edit', editId: 'session:0:1', target: { kind: 'editing', documentId: uri.toString() },
      sessionGeneration: 0, baseDocumentVersion: 1, changes: [{ from: 1, to: 4, insert: 'ETA' }],
    }
    target.emit(request)
    await settleEdit()

    expect(runtime.applyEdit).toHaveBeenCalledTimes(1)
    const editResults = runtime.post.mock.calls.map(([message]) => message).filter(message => message.type === 'edit-result')
    expect(editResults).toHaveLength(1)
    expect(editResults[0]).toEqual({
      type: 'edit-result',
      result: {
        ok: true,
        value: {
          request,
          before: {
            target: request.target, sessionGeneration: 0, documentVersion: 1, content: 'alpha',
            contentHash: createHash('sha256').update('alpha', 'utf8').digest('hex'),
          },
          after: {
            target: request.target, sessionGeneration: 0, documentVersion: 2, content: 'aETAa',
            contentHash: createHash('sha256').update('aETAa', 'utf8').digest('hex'),
          },
        },
      },
    })
    expect(Object.keys(editResults[0]).sort()).toEqual(['result', 'type'])
    expect((editResults[0].result.value.after)).toMatchObject({
      documentVersion: document.version, content: document.getText(),
      contentHash: createHash('sha256').update(document.getText(), 'utf8').digest('hex'),
    })
  })

  it('posts observation-mismatch after an external replacement and clears the pending request', async () => {
    const document = editableTextDocument('alpha', 1)
    const externalContent = 'external content'
    runtime.textDocuments.push(document)
    runtime.open.mockResolvedValue(document)
    runtime.applyEdit.mockImplementation(async () => {
      document.replace(externalContent)
      return true
    })
    const provider = new PerwriteEditorProvider(context)
    const target = panel()
    await provider.resolveCustomTextEditor(document, target, {} as any)
    target.ready()
    await settleEdit()
    target.editorReady()
    runtime.post.mockClear()

    const request = {
      type: 'edit', editId: 'session:0:external', target: { kind: 'editing', documentId: uri.toString() },
      sessionGeneration: 0, baseDocumentVersion: 1, changes: [{ from: 0, to: 5, insert: 'edited' }],
    }
    target.emit(request)
    await settleEdit()

    expect(runtime.applyEdit).toHaveBeenCalledTimes(1)
    expect(document.getText()).toBe(externalContent)
    expect(document.version).toBe(2)
    const editResults = runtime.post.mock.calls.map(([message]) => message).filter(message => message.type === 'edit-result')
    expect(editResults).toHaveLength(1)
    expect(editResults[0]).toMatchObject({
      type: 'edit-result',
      result: {
        ok: false,
        error: {
          editId: request.editId,
          target: request.target,
          sessionGeneration: request.sessionGeneration,
          baseDocumentVersion: request.baseDocumentVersion,
          kind: 'observation-mismatch',
          snapshot: {
            target: request.target,
            sessionGeneration: request.sessionGeneration,
            documentVersion: document.version,
            content: externalContent,
            contentHash: createHash('sha256').update(externalContent, 'utf8').digest('hex'),
          },
        },
      },
    })
    expect(editResults.filter(message => message.result.ok)).toHaveLength(0)

    runtime.post.mockClear()
    target.emit({
      ...request,
      editId: 'session:0:retry',
      baseDocumentVersion: document.version,
      changes: [{ from: 0, to: externalContent.length, insert: 'edited again' }],
    })
    await settleEdit()
    expect(runtime.applyEdit).toHaveBeenCalledTimes(2)
    expect(runtime.post.mock.calls.map(([message]) => message).filter(message => message.type === 'edit-result')).toHaveLength(1)
  })

  it('posts the reducer failure effect when VS Code rejects the workspace edit', async () => {
    const document = editableTextDocument('alpha', 1)
    runtime.textDocuments.push(document)
    runtime.open.mockResolvedValue(document)
    runtime.applyEdit.mockResolvedValue(false)
    const provider = new PerwriteEditorProvider(context)
    const target = panel()
    await provider.resolveCustomTextEditor(document, target, {} as any)
    target.ready()
    await settleEdit()
    target.editorReady()
    runtime.post.mockClear()

    target.emit({
      type: 'edit', editId: 'session:0:2', target: { kind: 'editing', documentId: uri.toString() },
      sessionGeneration: 0, baseDocumentVersion: 1, changes: [{ from: 0, to: 1, insert: 'A' }],
    })
    await settleEdit()

    expect(runtime.applyEdit).toHaveBeenCalledTimes(1)
    const editResults = runtime.post.mock.calls.map(([message]) => message).filter(message => message.type === 'edit-result')
    expect(editResults).toHaveLength(1)
    expect(editResults[0]).toMatchObject({
      type: 'edit-result',
      result: { ok: false, error: { kind: 'apply-rejected' } },
    })
  })
})

describe('PerwriteEditorProvider revealTarget', () => {
  it('一回の設定変更を全 session へ同じ generation で配信する', async () => {
    const provider = new PerwriteEditorProvider(context)
    const first = panel()
    const second = panel()
    await provider.resolveCustomTextEditor(textDocument, first, {} as any)
    await provider.resolveCustomTextEditor({ ...textDocument, uri: Uri.file('/repo/second.md') }, second, {} as any)
    runtime.post.mockClear()
    runtime.configuration.set('codeBlockWrap', false)
    runtime.configurationListeners[0]({ affectsConfiguration: (id: string) => id === 'perwrite.codeBlockWrap' })
    const messages = runtime.post.mock.calls.map(([message]) => message)
      .filter(message => message.type === 'configuration-change')
    expect(messages).toHaveLength(2)
    expect(messages[0]).toEqual(messages[1])
    expect(messages[0].configuration.value.rendering).toMatchObject({ generation: 1, codeBlockWrap: false })
    runtime.configuration.set('codeBlockWrap', true)
  })

  it('maps arguments, range, Git, post, and host exceptions to its public statuses', async () => {
    const provider = new PerwriteEditorProvider(context)
    expect(await provider.revealTarget()).toEqual({ status: 'invalid-arguments' })
    expect(await provider.revealTarget({ uri, range }, 'extra')).toEqual({ status: 'invalid-arguments' })
    expect(await provider.revealTarget({ uri, range: new Range(new Position(-1, 0), new Position(0, 0)) })).toEqual({ status: 'invalid-range' })
    expect(await provider.revealTarget({ uri, range })).toEqual({ status: 'target-not-found' })
    runtime.gitCommit.mockRejectedValueOnce(new Error('Git API failed'))
    expect(await provider.revealTarget({ uri, range, revision: { kind: 'commit', ref: 'missing' } })).toEqual({ status: 'internal-error' })
    runtime.gitCommit.mockResolvedValueOnce(undefined)
    expect(await provider.revealTarget({ uri, range, revision: { kind: 'commit', ref: 'missing' } })).toEqual({ status: 'revision-not-found' })
  })

  it('rejects string URI, plain range, URI-only, and validateRange-corrected forms before registry delivery', async () => {
    const provider = new PerwriteEditorProvider(context)
    expect(await provider.revealTarget({ uri: uri.toString(), range })).toEqual({ status: 'invalid-arguments' })
    expect(await provider.revealTarget({ uri, range: { start: range.start, end: range.end } })).toEqual({ status: 'invalid-arguments' })
    expect(await provider.revealTarget({ uri })).toEqual({ status: 'invalid-arguments' })
    const target = panel()
    await provider.resolveCustomTextEditor(textDocument, target, {} as any)
    target.ready(); await Promise.resolve(); await Promise.resolve(); target.editorReady()
    runtime.post.mockClear()
    const corrected = new Range(new Position(0, 0), new Position(0, 1))
    const validateRange = vi.spyOn(textDocument, 'validateRange').mockReturnValue(corrected)
    expect(await provider.revealTarget({ uri, range })).toEqual({ status: 'invalid-range' })
    validateRange.mockRestore()
    expect(runtime.post).not.toHaveBeenCalled()
  })

  it('registers only matching waiting/ready targets and preserves the public sent shape', async () => {
    const provider = new PerwriteEditorProvider(context)
    const unrelated = panel()
    await provider.resolveCustomTextEditor({ ...textDocument, uri: Uri.file('/repo/unrelated.md') }, unrelated, {} as any)
    expect(await provider.revealTarget({ uri, range })).toEqual({ status: 'target-not-found' })
    const target = panel()
    await provider.resolveCustomTextEditor(textDocument, target, {} as any)
    expect(await provider.revealTarget({ uri, range })).toEqual({ status: 'editor-not-ready' })
    target.ready(); await Promise.resolve(); target.editorReady()
    runtime.open.mockRejectedValueOnce(new Error('open failed'))
    expect(await provider.revealTarget({ uri, range })).toEqual({ status: 'internal-error' })
    const sent = await provider.revealTarget({ uri, range })
    expect(sent).toEqual({ status: 'sent', uri, from: 1, to: 3 })
    expect(Object.keys(sent).sort()).toEqual(['from', 'status', 'to', 'uri'])
    expect(runtime.post).toHaveBeenLastCalledWith({ type: 'reveal-target', documentId: uri.toString(), from: 1, to: 3, source: 'external' })
    runtime.post.mockResolvedValueOnce(false)
    expect(await provider.revealTarget({ uri, range })).toEqual({ status: 'post-message-failed' })
    runtime.post.mockRejectedValueOnce(new Error('closed'))
    expect(await provider.revealTarget({ uri, range })).toEqual({ status: 'post-message-failed' })
    target.dispose()
    expect(await provider.revealTarget({ uri, range })).toEqual({ status: 'target-not-found' })
  })


  it('uses the selected revision content for commit range validation and offsets', async () => {
    const provider = new PerwriteEditorProvider(context)
    const target = panel()
    await provider.resolveCustomTextEditor(textDocument, target, {} as any)
    target.ready(); await Promise.resolve(); target.editorReady()
    const resolved = comparison('revision-content', 'b'.repeat(40))
    resolved.value.original.snapshot.content = 'prefix\ncommit'
    vi.spyOn(provider as any, 'resolveRequestedComparison').mockResolvedValue(resolved)
    target.emit({ type: 'comparison-request', requestId: 1, original: { kind: 'commit', ref: 'short' }, modified: { kind: 'working-tree' } })
    await Promise.resolve(); await Promise.resolve()
    target.editorReady([resolved.value.original.documentId, resolved.value.modified.documentId])
    runtime.gitCommit.mockResolvedValue({ hash: 'b'.repeat(40), parents: [] })
    const commitRange = new Range(new Position(1, 1), new Position(1, 3))
    expect(await provider.revealTarget({ uri, range: commitRange, revision: { kind: 'commit', ref: 'short' } }))
      .toEqual({ status: 'sent', uri, revision: { kind: 'commit', ref: 'short' }, from: 8, to: 10 })
    expect(runtime.post).toHaveBeenLastCalledWith({
      type: 'reveal-target', documentId: resolved.value.original.documentId, from: 8, to: 10, source: 'external',
    })
    const invalidForCommit = new Range(new Position(2, 0), new Position(2, 0))
    expect(await provider.revealTarget({ uri, range: invalidForCommit, revision: { kind: 'commit', ref: 'short' } }))
      .toEqual({ status: 'invalid-range' })
  })
})


function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function comparison(identity: string, revision: string) {
  const physicalUri = uri.toString()
  const snapshot = (content: string, revisionIdentity: any, provenance: any) => ({ physicalUri, revisionIdentity, content, contentHash: createHash('sha256').update(content, 'utf8').digest('hex'), provenance })
  const original = { snapshot: snapshot(identity, { kind: 'commit', fullHash: revision }, { kind: 'commit', requestedRef: revision, documentVersion: 0 }), label: revision, documentId: `${physicalUri}?revision=${revision}-original`, baseResourceUri: physicalUri }
  const modified = { snapshot: snapshot(identity, { kind: 'working-tree' }, { kind: 'working-tree', documentVersion: 1 }), label: 'Working Tree', documentId: `${physicalUri}?revision=${revision}-modified`, baseResourceUri: physicalUri }
  return { ok: true as const, value: { identity, original, modified, editableSide: 'modified' as const } }
}

describe('comparison request ordering', () => {
  it('applies only the newest host request and waits for its editor-ready ids', async () => {
    const provider = new PerwriteEditorProvider(context)
    const target = panel()
    await provider.resolveCustomTextEditor(textDocument, target, {} as any)
    target.ready(); await Promise.resolve(); target.editorReady()
    const first = deferred<any>()
    const second = deferred<any>()
    vi.spyOn(provider as any, 'resolveRequestedComparison')
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    target.emit({ type: 'comparison-request', requestId: 1, original: { kind: 'commit', ref: 'one' }, modified: { kind: 'working-tree' } })
    target.emit({ type: 'comparison-request', requestId: 2, original: { kind: 'commit', ref: 'two' }, modified: { kind: 'working-tree' } })
    runtime.gitCommit.mockResolvedValue({ hash: 'two', parents: [] })
    second.resolve(comparison('second', 'two'))
    await Promise.resolve(); await Promise.resolve()
    // A successful replacement is not targetable until the new webview ids arrive.
    expect(await provider.revealTarget({ uri, range, revision: { kind: 'commit', ref: 'two' } })).toEqual({ status: 'editor-not-ready' })
    target.editorReady([`${uri.toString()}?revision=two-original`, `${uri.toString()}?revision=two-modified`])
    runtime.gitCommit.mockResolvedValue({ hash: 'two', parents: [] })
    expect((await provider.revealTarget({ uri, range, revision: { kind: 'commit', ref: 'two' } })).status).toBe('sent')
    first.resolve(comparison('first', 'one'))
    await Promise.resolve(); await Promise.resolve()
    runtime.gitCommit.mockResolvedValue({ hash: 'one', parents: [] })
    // The stale result never becomes an active host target or response.
    expect((await provider.revealTarget({ uri, range, revision: { kind: 'commit', ref: 'one' } })).status).toBe('target-not-found')
    expect(runtime.post.mock.calls.filter(([message]: any[]) => message.type === 'comparison-result').map(([message]: any[]) => message.requestId)).toEqual([2])
  })

  it('routes a physical document change to the editable comparison side', async () => {
    const provider = new PerwriteEditorProvider(context)
    const target = panel()
    await provider.resolveCustomTextEditor(textDocument, target, {} as any)
    target.ready(); await Promise.resolve(); target.editorReady()
    const resolved = comparison('comparison', 'b'.repeat(40))
    vi.spyOn(provider as any, 'resolveRequestedComparison').mockResolvedValue(resolved)
    target.emit({ type: 'comparison-request', requestId: 1, original: { kind: 'commit', ref: 'short' }, modified: { kind: 'working-tree' } })
    await Promise.resolve(); await Promise.resolve()
    target.editorReady([resolved.value.original.documentId, resolved.value.modified.documentId])
    runtime.post.mockClear()

    const onDocumentChange = runtime.changeListeners.at(-1)
    expect(onDocumentChange).toBeDefined()
    const content = 'working-edited'
    onDocumentChange?.({ document: { uri, version: 2, getText: () => content } })

    expect(runtime.post).toHaveBeenCalledWith({
      type: 'host-document-observation',
      observation: {
        target: { kind: 'comparison', documentId: resolved.value.modified.documentId, side: 'modified' },
        sessionGeneration: 1, documentVersion: 2, content,
        contentHash: createHash('sha256').update(content, 'utf8').digest('hex'),
      },
    })
    expect(runtime.post.mock.calls.some(([message]: any[]) => message.observation?.target.side === 'original')).toBe(false)
  })
})
