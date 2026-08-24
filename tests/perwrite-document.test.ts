import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => {
  class Uri { constructor(readonly value: string) {} static parse(value: string) { return new Uri(value) }; static joinPath(uri: Uri, part: string) { return new Uri(`${uri.value}/${part}`) }; get path() { return this.value }; toString() { return this.value } }
  class RelativePattern { constructor(readonly base: Uri, readonly pattern: string) {} }
  class FileSystemError extends Error { constructor(readonly code: string) { super(code) } }
  const listeners = { change: [] as Array<() => void>, create: [] as Array<() => void>, delete: [] as Array<() => void> }
  return { Uri, RelativePattern, FileSystemError, files: new Map<string, string>(), writes: [] as string[], failWrite: false, listeners }
})
vi.mock('vscode', () => ({
  Uri: runtime.Uri, RelativePattern: runtime.RelativePattern, FileSystemError: runtime.FileSystemError,
  workspace: {
    fs: { readFile: vi.fn(async (uri: any) => { const value = runtime.files.get(uri.toString()); if (value === undefined) throw new runtime.FileSystemError('FileNotFound'); return new TextEncoder().encode(value) }), writeFile: vi.fn(async (uri: any, bytes: Uint8Array) => { if (runtime.failWrite) throw new Error('write failed'); runtime.writes.push(uri.toString()); runtime.files.set(uri.toString(), new TextDecoder().decode(bytes)) }), delete: vi.fn() },
    createFileSystemWatcher: vi.fn(() => ({
      onDidChange: (listener: () => void) => { runtime.listeners.change.push(listener) },
      onDidCreate: (listener: () => void) => { runtime.listeners.create.push(listener) },
      onDidDelete: (listener: () => void) => { runtime.listeners.delete.push(listener) },
      dispose() {},
    })),
  },
}))
import { PerwriteDocument } from '../src/perwrite-document'
import { backupPayload, writeBackup } from '../src/document-persistence'
import { snapshot } from '../src/perwrite-document-state'
const uri = (value: string) => new runtime.Uri(value) as any

beforeEach(() => {
  runtime.files.clear(); runtime.writes.length = 0; runtime.failWrite = false
  runtime.listeners.change.length = 0; runtime.listeners.create.length = 0; runtime.listeners.delete.length = 0
})
async function opened(content = 'A') { runtime.files.set('file:a', content); return PerwriteDocument.open(uri('file:a')) }

describe('PerwriteDocument durability', () => {
  it('restores the current physical content over a clean backup', async () => {
    runtime.files.set('backup', JSON.stringify(backupPayload('file:a', snapshot('A'), snapshot('A', [1, 1]), 2))); runtime.files.set('file:a', 'B')
    const document = await PerwriteDocument.open(uri('file:a'), 'backup')
    expect(document.documentState.draftSnapshot).toMatchObject({ content: 'B', selection: [] }); expect(document.documentState.externalChange).toBeNull(); expect(document.isDirty).toBe(false)
  })
  it('restores backup draft D for physical B and physical A as dirty', async () => {
    runtime.files.set('backup', JSON.stringify(backupPayload('file:a', snapshot('A'), snapshot('D', [1, 0]), 2))); runtime.files.set('file:a', 'B')
    const conflicting = await PerwriteDocument.open(uri('file:a'), 'backup')
    expect(conflicting.isDirty).toBe(true); expect(conflicting.documentState.externalChange?.content).toBe('B')
    runtime.files.set('file:a', 'A'); const recovered = await PerwriteDocument.open(uri('file:a'), 'backup')
    expect(recovered.isDirty).toBe(true); expect(recovered.documentState.draftSnapshot.selection).toEqual([1, 0]); expect(recovered.documentState.externalChange).toBeNull()
  })
  it('applies watcher observations to a clean untracked document without edit events', async () => {
    const document = await opened(); const states: string[] = []; const edits: unknown[] = []
    document.onDidChangeState(state => states.push(state.draftSnapshot.content)); document.onDidChange(event => edits.push(event))
    expect(runtime.listeners.change).toHaveLength(1); expect(runtime.listeners.create).toHaveLength(1)
    runtime.files.set('file:a', 'B'); runtime.listeners.change[0](); await vi.waitFor(() => expect(states).toEqual(['B']))
    expect(document.documentState.draftSnapshot.content).toBe('B'); expect(document.isDirty).toBe(false); expect(edits).toHaveLength(0)
  })
  it('keeps undo redo after failed save and missing file observation', async () => {
    const document = await opened(); const events: any[] = []; document.onDidChange(event => events.push(event))
    expect(document.applyEdit({ uri: 'file:a', generation: 0, beforeHash: snapshot('A').contentHash, changes: [{ from: 1, to: 1, insert: 'D' }], selection: [2, 2] })).toBe(true)
    runtime.failWrite = true
    expect(await document.save()).toBe('write-failed'); expect(document.documentState.draftSnapshot.content).toBe('AD')
    await events[0].undo(); expect(document.documentState.draftSnapshot.content).toBe('A'); await events[0].redo(); expect(document.documentState.draftSnapshot.content).toBe('AD')
    runtime.files.delete('file:a'); await document.observeExternalChange(); expect(document.documentState.draftSnapshot.content).toBe('AD'); expect(await document.save()).toBe('file-missing')
  })
})
