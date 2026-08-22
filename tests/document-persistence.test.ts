import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => {
  class FileSystemError extends Error { constructor(readonly code: string) { super(code) } }
  return { files: new Map<string, string>(), writes: [] as string[], failWrite: false, mismatch: false, FileSystemError }
})
vi.mock('vscode', () => ({
  FileSystemError: runtime.FileSystemError,
  workspace: { fs: {
    readFile: vi.fn(async (uri: { toString(): string }) => {
      const value = runtime.files.get(uri.toString())
      if (value === undefined) throw new runtime.FileSystemError('FileNotFound')
      return new TextEncoder().encode(runtime.mismatch ? 'mismatch' : value)
    }),
    writeFile: vi.fn(async (uri: { toString(): string }, bytes: Uint8Array) => {
      if (runtime.failWrite) throw new Error('write failed')
      runtime.writes.push(uri.toString()); runtime.files.set(uri.toString(), new TextDecoder().decode(bytes))
    }),
  } },
}))

import { backupPayload, readBackup, readDocumentSnapshot, saveSnapshot, writeBackup, writeAndObserve } from '../src/document-persistence'
import { snapshot } from '../src/perwrite-document-state'
const uri = (value: string) => ({ toString: () => value }) as any

beforeEach(() => { runtime.files.clear(); runtime.writes.length = 0; runtime.failWrite = false; runtime.mismatch = false })
describe('document persistence', () => {
  it('writes once only when the observed saved hash matches', async () => {
    runtime.files.set('file:a', 'A')
    const result = await saveSnapshot(uri('file:a'), snapshot('A'), snapshot('D'))
    expect(result.ok).toBe(true); expect(runtime.writes).toEqual(['file:a'])
  })
  it('reports external conflict with zero writes', async () => {
    runtime.files.set('file:a', 'B')
    const result = await saveSnapshot(uri('file:a'), snapshot('A'), snapshot('D'))
    expect(result).toEqual({ ok: false, error: 'external-modification-conflict' }); expect(runtime.writes).toHaveLength(0)
  })
  it('reports write failure and read-back mismatch', async () => {
    runtime.files.set('file:a', 'A'); runtime.failWrite = true
    expect(await writeAndObserve(uri('file:a'), 'D')).toEqual({ ok: false, error: 'write-failed' })
    runtime.failWrite = false; runtime.mismatch = true
    expect(await writeAndObserve(uri('file:a'), 'D')).toEqual({ ok: false, error: 'written-content-mismatch' })
  })
  it('roundtrips Backup v2 and rejects saved hash or schema mismatch', async () => {
    const backup = backupPayload('file:a', snapshot('A'), snapshot('D', [1, 1]), 4)
    await writeBackup(uri('backup'), backup)
    await expect(readBackup(uri('backup'), 'file:a')).resolves.toMatchObject({ saved: { content: 'A' }, draft: { content: 'D', selection: [1, 1] }, generation: 4 })
    runtime.files.set('backup', JSON.stringify({ ...backup, savedHash: 'bad' })); await expect(readBackup(uri('backup'), 'file:a')).resolves.toBeNull()
    runtime.files.set('backup', JSON.stringify({ version: 1 })); await expect(readBackup(uri('backup'), 'file:a')).resolves.toBeNull()
  })
  it('keeps missing files observable without writing', async () => {
    expect(await readDocumentSnapshot(uri('missing'))).toEqual({ ok: false, error: 'file-missing' })
    expect(await saveSnapshot(uri('missing'), snapshot('A'), snapshot('D'))).toEqual({ ok: false, error: 'file-missing' })
    expect(runtime.writes).toHaveLength(0)
  })
})
