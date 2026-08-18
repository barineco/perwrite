import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => {
  class Position {
    constructor(public readonly line: number, public readonly character: number) {}
  }

  class Range {
    constructor(public readonly start: Position, public readonly end: Position) {}
  }

  class WorkspaceEdit {
    readonly replacements: Array<{ readonly uri: { toString(): string }; readonly range: Range; readonly content: string }> = []

    replace(uri: { toString(): string }, range: Range, content: string): void {
      this.replacements.push({ uri, range, content })
    }
  }

  return {
    Position,
    Range,
    WorkspaceEdit,
    textDocuments: [] as Array<{ readonly uri: { toString(): string } }>,
    applyEdit: vi.fn(),
    openTextDocument: vi.fn(),
  }
})

vi.mock('vscode', () => ({
  Position: runtime.Position,
  Range: runtime.Range,
  WorkspaceEdit: runtime.WorkspaceEdit,
  workspace: {
    get textDocuments() { return runtime.textDocuments },
    applyEdit: runtime.applyEdit,
    openTextDocument: runtime.openTextDocument,
  },
}))

import { applyWorkspaceEditWithObservation } from '../src/editor-adapter'
import { contentHash } from '../src/protocol'

interface TestDocument {
  readonly uri: { toString(): string }
  readonly version: number
  getText(): string
  positionAt(offset: number): InstanceType<typeof runtime.Position>
  offsetAt(position: InstanceType<typeof runtime.Position>): number
  setContent(content: string): void
}

function createDocument(documentId: string, initialContent: string): TestDocument {
  let content = initialContent
  let version = 1
  const uri = { toString: () => documentId }
  return {
    uri,
    get version() { return version },
    getText() { return content },
    positionAt(offset) {
      const lines = content.slice(0, offset).split('\n')
      return new runtime.Position(lines.length - 1, lines.at(-1)?.length ?? 0)
    },
    offsetAt(position) {
      const lines = content.split('\n')
      return lines.slice(0, position.line).reduce((total, line) => total + line.length + 1, 0) + position.character
    },
    setContent(nextContent) { content = nextContent; version += 1 },
  }
}

function requestFor(document: TestDocument, changes: readonly { readonly from: number; readonly to: number; readonly insert: string }[]) {
  return {
    editId: 'edit-1',
    target: { kind: 'editing' as const, documentId: document.uri.toString() },
    sessionGeneration: 7,
    baseDocumentVersion: document.version,
    changes,
  }
}

beforeEach(() => {
  runtime.textDocuments.length = 0
  runtime.applyEdit.mockReset()
  runtime.openTextDocument.mockReset()
})

describe('applyWorkspaceEditWithObservation', () => {
  it('正常な編集の実測前後スナップショットを返す', async () => {
    const document = createDocument('file:///workspace/normal.md', 'alpha')
    const request = requestFor(document, [{ from: 5, to: 5, insert: '!' }])
    runtime.textDocuments.push(document)
    runtime.applyEdit.mockImplementation(async (workspaceEdit: InstanceType<typeof runtime.WorkspaceEdit>) => {
      const replacement = workspaceEdit.replacements[0]
      const from = document.offsetAt(replacement.range.start)
      const to = document.offsetAt(replacement.range.end)
      document.setContent(`${document.getText().slice(0, from)}${replacement.content}${document.getText().slice(to)}`)
      return true
    })

    const outcome = await applyWorkspaceEditWithObservation(document as never, request)

    expect(runtime.applyEdit).toHaveBeenCalledTimes(1)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.value.before).toEqual({
      target: request.target,
      sessionGeneration: request.sessionGeneration,
      documentVersion: 1,
      content: 'alpha',
      contentHash: contentHash('alpha'),
    })
    expect(outcome.value.after).toEqual({
      target: request.target,
      sessionGeneration: request.sessionGeneration,
      documentVersion: document.version,
      content: document.getText(),
      contentHash: contentHash(document.getText()),
    })
  })

  it('介入した外部内容を observation-mismatch の実測スナップショットとして返す', async () => {
    const document = createDocument('file:///workspace/interleaving.md', 'alpha')
    const request = requestFor(document, [{ from: 5, to: 5, insert: '!' }])
    const externalContent = 'external update'
    runtime.textDocuments.push(document)
    runtime.applyEdit.mockImplementation(async () => {
      document.setContent(externalContent)
      return true
    })

    const outcome = await applyWorkspaceEditWithObservation(document as never, request)

    expect(runtime.applyEdit).toHaveBeenCalledTimes(1)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error.kind).toBe('observation-mismatch')
    expect(outcome.error.snapshot).toEqual({
      target: request.target,
      sessionGeneration: request.sessionGeneration,
      documentVersion: document.version,
      content: externalContent,
      contentHash: contentHash(externalContent),
    })
  })
})
