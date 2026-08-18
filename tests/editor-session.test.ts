import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { createEditorSession, recordHostDocumentObservation, recordFailure, recordVerifiedEditObservation, requestEdit } from '../src/editor-session'

const contentHash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const target = { kind: 'editing' as const, documentId: 'file:///document.md' }
const request = { editId: 'edit-1', target, sessionGeneration: 0, baseDocumentVersion: 1, changes: [{ from: 0, to: 0, insert: 'A' }] } as const

describe('検証済み編集セッション', () => {
  it('版一致要求だけを適用 effect へ変換する', () => {
    const state = createEditorSession(target, 0, 'body', 1, contentHash('body'))
    expect(requestEdit(state, request).effects).toEqual([{ type: 'apply-edit', request }])
  })

  it('matching observation の after snapshot をそのまま保存して send-success を返す', () => {
    const state = createEditorSession(target, 0, 'body', 1, contentHash('body'))
    const pending = requestEdit(state, request).state
    const after = { target, sessionGeneration: 0, documentVersion: 2, content: 'Abody', contentHash: contentHash('Abody') }
    const next = recordVerifiedEditObservation(pending, { request, before: state.snapshot, after })
    expect(next.state.snapshot).toBe(after)
    expect(next.state.pending.size).toBe(0)
    expect(next.effects).toEqual([{ type: 'send-success', observation: { request, before: state.snapshot, after } }])
  })

  it('typed failure は matching pending を clear して send-failure を返す', () => {
    const state = createEditorSession(target, 0, 'body', 1, contentHash('body'))
    const pending = requestEdit(state, request).state
    const failure = { editId: 'edit-1', target, sessionGeneration: 0, baseDocumentVersion: 1, kind: 'apply-rejected' as const, reason: 'rejected' }
    const next = recordFailure(pending, failure)
    expect(next.state.pending.size).toBe(0)
    expect(next.effects).toEqual([{ type: 'send-failure', failure }])
  })

  it('外部更新を complete snapshot として保存し配送する', () => {
    const state = createEditorSession(target, 0, 'body', 1, contentHash('body'))
    const snapshot = { target, sessionGeneration: 0, documentVersion: 2, content: 'changed', contentHash: contentHash('changed') }
    const next = recordHostDocumentObservation(state, snapshot)
    expect(next.state.snapshot).toBe(snapshot)
    expect(next.effects).toEqual([{ type: 'accepted-host-document-observation', observation: snapshot }])
  })

  it('要求結果と一致する host observation は pending request を解消する', () => {
    const state = createEditorSession(target, 0, 'body', 1, contentHash('body'))
    const pending = requestEdit(state, request).state
    const observation = { target, sessionGeneration: 0, documentVersion: 2, content: 'Abody', contentHash: contentHash('Abody') }
    const next = recordHostDocumentObservation(pending, observation)
    expect(next.state.pending.size).toBe(0)
    expect(next.state.snapshot).toBe(observation)
  })

  it('対象・hash・版の不一致 observation は state と effect を保存する', () => {
    const state = createEditorSession(target, 0, 'body', 2, contentHash('body'))
    const observations = [
      { target, sessionGeneration: 0, documentVersion: 2, content: 'same', contentHash: contentHash('same') },
      { target, sessionGeneration: 0, documentVersion: 1, content: 'stale', contentHash: contentHash('stale') },
      { target: { kind: 'editing' as const, documentId: 'file:///other.md' }, sessionGeneration: 0, documentVersion: 3, content: 'other', contentHash: contentHash('other') },
      { target, sessionGeneration: 0, documentVersion: 3, content: 'bad', contentHash: contentHash('other') },
    ]
    for (const observation of observations) {
      const next = recordHostDocumentObservation(state, observation)
      expect(next.state).toBe(state)
      expect(next.effects).toEqual([])
    }
  })
})
