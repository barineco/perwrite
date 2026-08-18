import { describe, expect, it } from 'vitest'
import { contentHash } from '../src/protocol'
import { decodeAppearanceSources, decodeEditRequest, decodeRevisionSnapshot } from '../src/message-validation'
import { defaultPerwriteSettings } from '../src/settings-resolver'
import { decodeHostMessage } from '../src/message-validation'
import { decodeWebviewMessage } from '../src/message-validation'

const target = { kind: 'editing', documentId: 'd' }
const request = { editId: 'e', target, sessionGeneration: 0, baseDocumentVersion: 1, changes: [] }
const snapshot = (documentVersion: number, content: string) => ({ target, sessionGeneration: 0, documentVersion, content, contentHash: contentHash(content) })
const success = { type: 'edit-result', result: { ok: true, value: { request, before: snapshot(1, 'before'), after: snapshot(2, 'after') } } }

describe('runtime message validation', () => {
  it('appearance settings の decode 鍵は PERWRITE_SETTING_SCHEMA と一致する', () => {
    const appearance = {
      version: 1,
      settings: {
        ok: true as const,
        value: { perwrite: defaultPerwriteSettings(), editorFont: { family: 'Mono', size: 14 } },
      },
      fallbackFont: { family: 'Mono', size: 14 },
      tokenTheme: { ok: false as const, error: 'unavailable' },
    }
    expect(decodeAppearanceSources(appearance).ok).toBe(true)
    expect(decodeHostMessage({ type: 'appearance-change', appearance }).ok).toBe(true)
  })

  it('typed verified success outcome を decode する', () => {
    expect(decodeHostMessage(success).ok).toBe(true)
  })

  it('不正な EditFailure を拒否する', () => {
    expect(decodeHostMessage({ type: 'edit-result', result: { ok: false, error: { editId: 'e', target, sessionGeneration: 0, baseDocumentVersion: 1, kind: 'unknown', reason: 'bad' } } }).ok).toBe(false)
  })

  it('content と一致しない hash の observation を拒否する', () => {
    expect(decodeHostMessage({ type: 'host-document-observation', observation: { ...snapshot(2, 'after'), contentHash: contentHash('different') } }).ok).toBe(false)
  })

  it('snapshot の exact keys、content hash、commit provenance と full hash identity を検証する', () => {
    const valid = { physicalUri: 'file:///repo/note.md', revisionIdentity: { kind: 'commit', fullHash: 'a'.repeat(40) }, content: 'content', contentHash: contentHash('content'), provenance: { kind: 'commit', requestedRef: 'HEAD', documentVersion: 0 } }
    expect(decodeRevisionSnapshot(valid).ok).toBe(true)
    expect(decodeRevisionSnapshot({ ...valid, contentHash: contentHash('other') }).ok).toBe(false)
    expect(decodeRevisionSnapshot({ ...valid, provenance: { kind: 'commit', documentVersion: 0 } }).ok).toBe(false)
    expect(decodeRevisionSnapshot({ ...valid, revisionIdentity: { kind: 'index' } }).ok).toBe(false)
    expect(decodeRevisionSnapshot({ ...valid, extra: true }).ok).toBe(false)
  })

  it('failure と異なる対象の snapshot を拒否する', () => {
    expect(decodeHostMessage({
      type: 'edit-result',
      result: { ok: false, error: {
        editId: 'e', target, sessionGeneration: 0, baseDocumentVersion: 1, kind: 'base-version-conflict', reason: 'mismatch',
        snapshot: { ...snapshot(2, 'after'), target: { kind: 'editing', documentId: 'other' } },
      } },
    }).ok).toBe(false)
  })

  it('旧 version key を拒否する', () => {
    expect(decodeHostMessage({ ...success, version: 2 }).ok).toBe(false)
  })

  it('missing and extra edit keys を拒否する', () => {
    expect(decodeEditRequest({ type: 'edit', ...request, extra: true }).ok).toBe(false)
    expect(decodeWebviewMessage({ type: 'edit', ...request, extra: true }).ok).toBe(false)
  })

  it('valid edit message は canonical change sequence を保持する', () => {
    const value = { ...request, changes: [{ from: 2, to: 3, insert: 'x' }] }
    expect(decodeWebviewMessage({ type: 'edit', ...value })).toEqual({ ok: true, value: { type: 'edit', ...value } })
  })
})
