import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => {
  class Uri { constructor(readonly value: string) {} static parse(value: string) { return new Uri(value) }; static joinPath(uri: Uri, part: string) { return new Uri(`${uri.value}/${part}`) }; get path() { return this.value }; toString() { return this.value } }
  class RelativePattern { constructor(readonly base: Uri, readonly pattern: string) {} }
  class FileSystemError extends Error { constructor(readonly code: string) { super(code) } }
  const listeners: Array<() => void> = []
  return { Uri, RelativePattern, FileSystemError, files: new Map<string, string>(), writes: [] as string[], failWrite: false, listeners }
})
vi.mock('vscode', () => ({
  Uri: runtime.Uri, RelativePattern: runtime.RelativePattern, FileSystemError: runtime.FileSystemError,
  workspace: {
    fs: { readFile: vi.fn(async (uri: any) => { const value = runtime.files.get(uri.toString()); if (value === undefined) throw new runtime.FileSystemError('FileNotFound'); return new TextEncoder().encode(value) }), writeFile: vi.fn(async (uri: any, bytes: Uint8Array) => { if (runtime.failWrite) throw new Error('write failed'); runtime.writes.push(uri.toString()); runtime.files.set(uri.toString(), new TextDecoder().decode(bytes)) }), delete: vi.fn() },
    createFileSystemWatcher: vi.fn(() => ({ onDidChange: (listener: () => void) => { runtime.listeners.push(listener) }, onDidCreate: () => {}, onDidDelete: (listener: () => void) => { runtime.listeners.push(listener) }, dispose() {} })),
  },
}))
import { PerwriteDocument } from '../src/perwrite-document'
import { backupPayload, writeBackup } from '../src/document-persistence'
import { snapshot } from '../src/perwrite-document-state'
const uri = (value: string) => new runtime.Uri(value) as any

beforeEach(() => { runtime.files.clear(); runtime.writes.length = 0; runtime.failWrite = false; runtime.listeners.length = 0 })
async function opened(content = 'A') { runtime.files.set('file:a', content); return PerwriteDocument.open(uri('file:a')) }

describe('PerwriteDocument durability', () => {
  it('restores backup A/A against physical B as dirty external conflict', async () => {
    runtime.files.set('backup', JSON.stringify(backupPayload('file:a', snapshot('A'), snapshot('A', [1, 1]), 2))); runtime.files.set('file:a', 'B')
    const document = await PerwriteDocument.open(uri('file:a'), 'backup')
    expect(document.documentState.draftSnapshot).toMatchObject({ content: 'A', selection: [1, 1] }); expect(document.documentState.externalChange?.content).toBe('B'); expect(document.isDirty).toBe(true)
  })
  it('restores backup draft D for physical B and physical A as dirty', async () => {
    runtime.files.set('backup', JSON.stringify(backupPayload('file:a', snapshot('A'), snapshot('D', [1, 0]), 2))); runtime.files.set('file:a', 'B')
    expect((await PerwriteDocument.open(uri('file:a'), 'backup')).isDirty).toBe(true)
    runtime.files.set('file:a', 'A'); const recovered = await PerwriteDocument.open(uri('file:a'), 'backup')
    expect(recovered.isDirty).toBe(true); expect(recovered.documentState.draftSnapshot.selection).toEqual([1, 0])
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
