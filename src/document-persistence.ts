import * as vscode from 'vscode'
import { snapshot, type DocumentSnapshot } from './perwrite-document-state'

export type SaveFailure = 'external-modification-conflict' | 'permission-denied' | 'file-missing' | 'write-failed' | 'written-content-mismatch' | 'observation-failed'
export type ReadResult = { readonly ok: true; readonly value: DocumentSnapshot } | { readonly ok: false; readonly error: SaveFailure }

export async function readDocumentSnapshot(uri: vscode.Uri): Promise<ReadResult> {
  try { return { ok: true, value: snapshot(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))) } }
  catch (error) { return error instanceof vscode.FileSystemError && error.code === 'FileNotFound' ? { ok: false, error: 'file-missing' } : { ok: false, error: 'observation-failed' } }
}

export async function writeAndObserve(uri: vscode.Uri, content: string): Promise<ReadResult> {
  try { await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content)) }
  catch (error) { return error instanceof vscode.FileSystemError && error.code === 'NoPermissions' ? { ok: false, error: 'permission-denied' } : { ok: false, error: 'write-failed' } }
  const observed = await readDocumentSnapshot(uri)
  return observed.ok && observed.value.content !== content ? { ok: false, error: 'written-content-mismatch' } : observed
}

export async function saveSnapshot(uri: vscode.Uri, saved: DocumentSnapshot, draft: DocumentSnapshot): Promise<ReadResult> {
  const before = await readDocumentSnapshot(uri)
  if (!before.ok) return before
  if (before.value.contentHash !== saved.contentHash) return { ok: false, error: 'external-modification-conflict' }
  return writeAndObserve(uri, draft.content)
}

interface BackupPayload { readonly version: 2; readonly uri: string; readonly saved: string; readonly savedHash: string; readonly draft: string; readonly selection: readonly number[]; readonly generation: number }
export async function writeBackup(destination: vscode.Uri, value: BackupPayload): Promise<void> { await vscode.workspace.fs.writeFile(destination, new TextEncoder().encode(JSON.stringify(value))) }
export async function readBackup(source: vscode.Uri, uri: string): Promise<{ readonly saved: DocumentSnapshot; readonly draft: DocumentSnapshot; readonly generation: number } | null> {
  try {
    const value = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(source))) as Partial<BackupPayload>
    const generation = value.generation
    if (value.version !== 2 || value.uri !== uri || typeof value.saved !== 'string' || typeof value.savedHash !== 'string' || typeof value.draft !== 'string' || !Array.isArray(value.selection) || !value.selection.every((item: unknown) => typeof item === 'number' && Number.isFinite(item)) || typeof generation !== 'number' || !Number.isInteger(generation) || generation < 0) return null
    const saved = snapshot(value.saved); if (saved.contentHash !== value.savedHash) return null
    return { saved, draft: snapshot(value.draft, value.selection), generation }
  } catch { return null }
}
export function backupPayload(uri: string, saved: DocumentSnapshot, draft: DocumentSnapshot, generation: number): BackupPayload { return { version: 2, uri, saved: saved.content, savedHash: saved.contentHash, draft: draft.content, selection: draft.selection, generation } }
