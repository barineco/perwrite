import { contentHash, validateSelection, validateTextChanges, type TextChange } from './protocol'

export interface DocumentSnapshot {
  readonly content: string
  readonly contentHash: string
  readonly selection: readonly number[]
}

export interface PerwriteDocumentState {
  readonly uri: string
  readonly savedSnapshot: DocumentSnapshot
  readonly draftSnapshot: DocumentSnapshot
  readonly externalChange: DocumentSnapshot | null
  readonly generation: number
}

export type DraftEditFailure = 'document-mismatch' | 'stale-generation' | 'before-hash-mismatch' | 'invalid-change'

export function snapshot(content: string, selection: readonly number[] = []): DocumentSnapshot {
  return { content, contentHash: contentHash(content), selection: [...selection] }
}

export function createDocumentState(uri: string, content: string): PerwriteDocumentState {
  const initial = snapshot(content)
  return { uri, savedSnapshot: initial, draftSnapshot: initial, externalChange: null, generation: 0 }
}

export function isDirty(state: PerwriteDocumentState): boolean {
  return state.draftSnapshot.contentHash !== state.savedSnapshot.contentHash
}

function applyChanges(content: string, changes: readonly TextChange[]): string {
  let cursor = 0
  let next = ''
  for (const change of changes) {
    next += content.slice(cursor, change.from) + change.insert
    cursor = change.to
  }
  return next + content.slice(cursor)
}

export function applyDraftEdit(
  state: PerwriteDocumentState,
  input: { readonly uri: string; readonly generation: number; readonly beforeHash: string; readonly changes: readonly TextChange[]; readonly selection: readonly number[] },
): { readonly ok: true; readonly state: PerwriteDocumentState; readonly before: DocumentSnapshot } | { readonly ok: false; readonly error: DraftEditFailure } {
  if (input.uri !== state.uri) return { ok: false, error: 'document-mismatch' }
  if (input.generation !== state.generation) return { ok: false, error: 'stale-generation' }
  if (input.beforeHash !== state.draftSnapshot.contentHash) return { ok: false, error: 'before-hash-mismatch' }
  const valid = validateTextChanges(input.changes, state.draftSnapshot.content.length, state.draftSnapshot.content)
  if (!valid.ok) return { ok: false, error: 'invalid-change' }
  const content = applyChanges(state.draftSnapshot.content, input.changes)
  const selection = validateSelection(input.selection, content.length)
  if (!selection.ok) return { ok: false, error: 'invalid-change' }
  const next = snapshot(content, input.selection)
  return { ok: true, before: state.draftSnapshot, state: { ...state, draftSnapshot: next, generation: state.generation + 1 } }
}

export function restoreDraft(state: PerwriteDocumentState, draftSnapshot: DocumentSnapshot): PerwriteDocumentState {
  return { ...state, draftSnapshot, generation: state.generation + 1 }
}

export function observeExternalChange(state: PerwriteDocumentState, observed: DocumentSnapshot): PerwriteDocumentState {
  if (observed.contentHash === state.savedSnapshot.contentHash) return state
  if (isDirty(state)) return { ...state, externalChange: observed }
  return { ...state, savedSnapshot: observed, draftSnapshot: observed, externalChange: null, generation: state.generation + 1 }
}

export function completeSave(state: PerwriteDocumentState, observed: DocumentSnapshot): PerwriteDocumentState | null {
  if (observed.contentHash !== state.draftSnapshot.contentHash) return null
  return { ...state, savedSnapshot: observed, draftSnapshot: observed, externalChange: null, generation: state.generation + 1 }
}

export function revertTo(state: PerwriteDocumentState, observed: DocumentSnapshot): PerwriteDocumentState {
  return { ...state, savedSnapshot: observed, draftSnapshot: observed, externalChange: null, generation: state.generation + 1 }
}
