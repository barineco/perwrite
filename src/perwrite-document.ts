import * as vscode from 'vscode'
import { backupPayload, readBackup, readDocumentSnapshot, saveSnapshot, writeAndObserve, writeBackup, type SaveFailure } from './document-persistence'
import { applyDraftEdit, createDocumentState, observeExternalChange, restoreDocumentState, restoreDraft, revertTo, snapshot, type DocumentSnapshot, type PerwriteDocumentState } from './perwrite-document-state'
import type { TextChange } from './protocol'

export interface DocumentEdit { readonly uri: string; readonly generation: number; readonly beforeHash: string; readonly changes: readonly TextChange[]; readonly selection: readonly number[] }
class EventEmitter<T> { private readonly listeners = new Set<(value: T) => unknown>(); readonly event: vscode.Event<T> = listener => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) } }; fire(value: T): void { for (const listener of this.listeners) listener(value) }; dispose(): void { this.listeners.clear() } }

export class PerwriteDocument implements vscode.CustomDocument {
  private readonly changed = new EventEmitter<vscode.CustomDocumentEditEvent<PerwriteDocument>>()
  readonly onDidChange = this.changed.event
  private readonly stateChanged = new EventEmitter<PerwriteDocumentState>()
  readonly onDidChangeState = this.stateChanged.event
  private readonly watcher: vscode.FileSystemWatcher
  private selfWrittenHash: string | null = null
  private disposed = false

  private constructor(readonly uri: vscode.Uri, private state: PerwriteDocumentState) {
    this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.joinPath(uri, '..'), uri.path.split('/').pop() ?? ''), false, false, false)
    const observe = () => { void this.observeExternalChange() }
    this.watcher.onDidChange(observe); this.watcher.onDidCreate(observe); this.watcher.onDidDelete(observe)
  }

  static async open(uri: vscode.Uri, backupId?: string): Promise<PerwriteDocument> {
    const physical = await readDocumentSnapshot(uri)
    if (!physical.ok) throw new Error(`Cannot open document: ${physical.error}`)
    let state = createDocumentState(uri.toString(), physical.value.content)
    if (backupId) {
      const recovered = await readBackup(vscode.Uri.parse(backupId), uri.toString())
      if (recovered) state = restoreDocumentState(uri.toString(), physical.value, recovered)
    }
    return new PerwriteDocument(uri, state)
  }

  get documentState(): PerwriteDocumentState { return this.state }
  get isDirty(): boolean { return this.state.draftSnapshot.contentHash !== this.state.savedSnapshot.contentHash }
  applyEdit(edit: DocumentEdit): boolean { const transition = applyDraftEdit(this.state, edit); if (!transition.ok) return false; const before = transition.before; const after = transition.state.draftSnapshot; this.state = transition.state; this.changed.fire({ document: this, label: 'Edit Perwrite document', undo: async () => this.replaceDraft(before), redo: async () => this.replaceDraft(after) }); this.publish(); return true }
  async save(): Promise<SaveFailure | null> { const saved = await saveSnapshot(this.uri, this.state.savedSnapshot, this.state.draftSnapshot); if (!saved.ok) return saved.error; this.selfWrittenHash = saved.value.contentHash; this.state = { ...this.state, savedSnapshot: saved.value, draftSnapshot: saved.value, externalChange: null, generation: this.state.generation + 1 }; this.publish(); return null }
  async saveAs(target: vscode.Uri): Promise<SaveFailure | null> { const saved = await writeAndObserve(target, this.state.draftSnapshot.content); return saved.ok ? null : saved.error }
  async revert(): Promise<void> { const observed = await readDocumentSnapshot(this.uri); if (!observed.ok) throw new Error(`Cannot revert document: ${observed.error}`); this.state = revertTo(this.state, observed.value); this.publish() }
  async observeExternalChange(): Promise<void> { const observed = await readDocumentSnapshot(this.uri); if (!observed.ok) return; if (this.selfWrittenHash === observed.value.contentHash) { this.selfWrittenHash = null; return }; const next = observeExternalChange(this.state, observed.value); if (next !== this.state) { this.state = next; this.publish() } }
  async backup(destination: vscode.Uri): Promise<vscode.CustomDocumentBackup> { await writeBackup(destination, backupPayload(this.uri.toString(), this.state.savedSnapshot, this.state.draftSnapshot, this.state.generation)); return { id: destination.toString(), delete: async () => { try { await vscode.workspace.fs.delete(destination) } catch {} } } }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.watcher.dispose(); this.changed.dispose(); this.stateChanged.dispose() }
  private replaceDraft(draft: DocumentSnapshot): void { this.state = restoreDraft(this.state, draft); this.publish() }
  private publish(): void { if (!this.disposed) this.stateChanged.fire(this.state) }
}
export { snapshot }
