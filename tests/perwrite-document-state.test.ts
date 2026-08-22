import { describe, expect, it } from 'vitest'
import { applyDraftEdit, completeSave, createDocumentState, isDirty, observeExternalChange, restoreDraft, snapshot } from '../src/perwrite-document-state'

function edit(state: ReturnType<typeof createDocumentState>, insert: string) { return applyDraftEdit(state, { uri: state.uri, generation: state.generation, beforeHash: state.draftSnapshot.contentHash, changes: [{ from: state.draftSnapshot.content.length, to: state.draftSnapshot.content.length, insert }], selection: [] }) }

describe('durable draft state', () => {
  it('Roundtrip accepts sequential edits before a snapshot acknowledgement', () => {
    const first = edit(createDocumentState('file:a', 'a'), 'b'); if (!first.ok) throw new Error(first.error)
    const second = edit(first.state, 'c'); if (!second.ok) throw new Error(second.error)
    expect(second.state.draftSnapshot.content).toBe('abc')
    expect(second.state.generation).toBe(2)
  })
  it('Preservation keeps saved content while dirty and restores undo snapshots', () => {
    const first = edit(createDocumentState('file:a', 'a'), 'b'); if (!first.ok) throw new Error(first.error)
    expect(first.state.savedSnapshot.content).toBe('a')
    expect(restoreDraft(first.state, first.before).draftSnapshot.content).toBe('a')
  })
  it('Orthogonality applies clean external content but preserves dirty drafts as conflict', () => {
    const clean = observeExternalChange(createDocumentState('file:a', 'a'), snapshot('disk'))
    expect(clean.draftSnapshot.content).toBe('disk')
    const changed = edit(createDocumentState('file:a', 'a'), 'draft'); if (!changed.ok) throw new Error(changed.error)
    const dirty = observeExternalChange(changed.state, snapshot('disk'))
    expect(dirty.draftSnapshot.content).toBe('adraft'); expect(dirty.externalChange?.content).toBe('disk')
  })
  it('preserves anchor/head selection in draft and undo snapshots', () => {
    const result = applyDraftEdit(createDocumentState('file:a', 'a'), { uri: 'file:a', generation: 0, beforeHash: snapshot('a').contentHash, changes: [{ from: 1, to: 1, insert: 'b' }], selection: [2, 1] })
    if (!result.ok) throw new Error(result.error)
    expect(result.state.draftSnapshot.selection).toEqual([2, 1])
    expect(restoreDraft(result.state, result.before).draftSnapshot.selection).toEqual([])
  })
  it('Invalid rejects mismatched URI, generation, hash, and invalid ranges', () => {
    const state = createDocumentState('file:a', 'a')
    expect(applyDraftEdit(state, { uri: 'file:b', generation: 0, beforeHash: state.draftSnapshot.contentHash, changes: [], selection: [] }).error).toBe('document-mismatch')
    expect(applyDraftEdit(state, { uri: state.uri, generation: 2, beforeHash: state.draftSnapshot.contentHash, changes: [], selection: [] }).error).toBe('stale-generation')
    expect(applyDraftEdit(state, { uri: state.uri, generation: 0, beforeHash: 'bad', changes: [], selection: [] }).error).toBe('before-hash-mismatch')
    expect(applyDraftEdit(state, { uri: state.uri, generation: 0, beforeHash: state.draftSnapshot.contentHash, changes: [{ from: 2, to: 2, insert: 'x' }], selection: [] }).error).toBe('invalid-change')
  })
  it('Permutation leaves a failed save candidate and undo history snapshot unchanged', () => {
    const changed = edit(createDocumentState('file:a', 'a'), 'b'); if (!changed.ok) throw new Error(changed.error)
    expect(completeSave(changed.state, snapshot('different'))).toBeNull()
    expect(changed.state.draftSnapshot.content).toBe('ab')
    expect(isDirty(changed.state)).toBe(true)
  })
})
