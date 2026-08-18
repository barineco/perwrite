import { describe, expect, it } from 'vitest'
import { contentHash } from '../src/protocol'
import { createEditorSession, recordHostDocumentObservation, requestEdit } from '../src/edit-sync'

const documentId = 'file:///workspace/document.md'
const target = { kind: 'editing' as const, documentId }
const hash = contentHash

describe('検証済み編集同期', () => {
  it('版一致の変更列だけを apply effect へ変換する', () => {
    const state = createEditorSession(target, 0, 'before', 1, hash('before'))
    const request = { editId: 'edit-1', target, sessionGeneration: 0, baseDocumentVersion: 1, changes: [{ from: 0, to: 6, insert: 'after' }] }
    expect(requestEdit(state, request).effects).toEqual([{ type: 'apply-edit', request }])
  })

  it('外部更新は complete snapshot として配送する', () => {
    const state = createEditorSession(target, 0, 'before', 1, hash('before'))
    const snapshot = { target, sessionGeneration: 0, documentVersion: 2, content: 'external', contentHash: hash('external') }
    const transition = recordHostDocumentObservation(state, snapshot)
    expect(transition.effects).toEqual([{ type: 'accepted-host-document-observation', observation: snapshot }])
    expect(transition.state.pending.size).toBe(0)
  })
})
