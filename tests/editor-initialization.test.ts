import { describe, expect, it } from 'vitest'
import { contentHash } from '../src/protocol'
import { buildCommitEditorInitialization, decideEditorInitialization } from '../src/editor-initialization'

const snapshot = (hash: string, content: string, requestedRef = hash) => ({
  physicalUri: 'file:///repo/note.md', revisionIdentity: { kind: 'commit' as const, fullHash: hash }, content, contentHash: contentHash(content), provenance: { kind: 'commit' as const, documentVersion: 0, requestedRef },
})

describe('通常 custom editor の初期化判断', () => {
  it('file と git index は通常初期化を維持し、git commit だけを snapshot reader へ渡す', () => {
    expect(decideEditorInitialization({ scheme: 'file', fsPath: '/repo/note.md' })).toEqual({ ok: true, value: { kind: 'standard' } })
    expect(decideEditorInitialization({ scheme: 'git', fsPath: '/virtual', query: JSON.stringify({ path: '/repo/note.md', ref: '' }) })).toEqual({ ok: true, value: { kind: 'standard' } })
    expect(decideEditorInitialization({ scheme: 'git', fsPath: '/virtual', query: JSON.stringify({ path: '/repo/note.md', ref: 'moving-ref' }) })).toEqual({ ok: true, value: { kind: 'commit', ref: 'moving-ref', actualFsPath: '/repo/note.md' } })
  })

  it('target と第一親 snapshot から comparison を構築する', () => {
    const initialization = buildCommitEditorInitialization({ target: snapshot('target-hash', 'after', 'moving-ref'), parent: snapshot('first-parent', 'before') }, 'file:///repo/')
    expect(initialization).toMatchObject({ kind: 'comparison', result: { ok: true, value: { original: { snapshot: snapshot('first-parent', 'before') }, modified: { snapshot: snapshot('target-hash', 'after', 'moving-ref') }, editableSide: null } } })
  })

  it('親なし commit は target snapshot を読み取り専用文書として配送する', () => {
    const target = snapshot('root-hash', '# First', 'root-ref')
    expect(buildCommitEditorInitialization({ target, parent: null }, 'file:///repo/')).toMatchObject({ kind: 'readonly', document: { snapshot: target, target: 'root-ref', reason: 'This commit has no parent to compare' } })
  })
})
