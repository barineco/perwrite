import { describe, expect, it } from 'vitest'
import { typedEditApplicationFailure, typedVerifiedEditObservation, verifiedEditObservationMessage } from '../src/edit-result'

const target = { kind: 'editing' as const, documentId: 'file:///doc.md' }
const request = { editId: 'edit-1', target, sessionGeneration: 0, baseDocumentVersion: 1, changes: [] }
const observation = {
  request,
  before: { target, sessionGeneration: 0, documentVersion: 1, content: 'before', contentHash: 'a'.repeat(64) },
  after: { target, sessionGeneration: 0, documentVersion: 2, content: 'after', contentHash: 'b'.repeat(64) },
} as const

describe('型付き編集結果', () => {
  it('検証済み observation を成功 outcome として保持する', () => {
    expect(typedVerifiedEditObservation(observation)).toEqual({ ok: true, value: observation })
    expect(verifiedEditObservationMessage(observation)).toEqual({ type: 'edit-result', result: { ok: true, value: observation } })
  })

  it('適用失敗の identity、版、kind、理由を保持する', () => {
    expect(typedEditApplicationFailure(request, 'apply-rejected', new Error('rejected'))).toEqual({
      ok: false, error: { ...request, kind: 'apply-rejected', reason: 'rejected' },
    })
  })
})
