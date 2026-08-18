import { describe, expect, it } from 'vitest'
import { appearanceChangeMessage, contentHash } from '../src/protocol'
import type { ComparisonFailure, ComparisonRequest, HostMessage, ResolveActiveTokenThemeOutput, ResolvedGitComparison, RevisionSnapshot, WebviewMessage } from '../src/protocol'
import type { AppearanceHostSources } from '../src/appearance-profile'

function snapshot(content: string, revisionIdentity: RevisionSnapshot['revisionIdentity'], provenance: RevisionSnapshot['provenance']): RevisionSnapshot {
  return { physicalUri: 'file:///repo/docs/note.md', revisionIdentity, content, contentHash: contentHash(content), provenance }
}

describe('比較 protocol', () => {
  it('解決済み比較は左右 snapshot と編集可能な側を一つに運ぶ', () => {
    const comparison: ResolvedGitComparison = {
      identity: 'comparison-1',
      original: { snapshot: snapshot('before', { kind: 'commit', fullHash: 'a'.repeat(40) }, { kind: 'commit', requestedRef: 'HEAD', documentVersion: 0 }), label: 'HEAD', documentId: 'git:left', baseResourceUri: 'file:///repo/docs' },
      modified: { snapshot: snapshot('after', { kind: 'working-tree' }, { kind: 'working-tree', documentVersion: 1 }), label: 'Working Tree', documentId: 'file:right', baseResourceUri: 'file:///repo/docs' },
      editableSide: 'modified',
    }
    const message: HostMessage = { type: 'comparison-init', result: { ok: true, value: comparison } }
    expect(message.result).toEqual({ ok: true, value: comparison })
    expect(Object.keys(comparison.original.snapshot).sort()).toEqual(['content', 'contentHash', 'physicalUri', 'provenance', 'revisionIdentity'])
  })

  it('requestId を要求と応答で保存する', () => {
    const request: ComparisonRequest = { type: 'comparison-request', requestId: 7, original: { kind: 'index' }, modified: { kind: 'working-tree' } }
    const webviewMessage: WebviewMessage = request
    const hostMessage: HostMessage = { type: 'comparison-result', requestId: request.requestId, result: { ok: false, error: { kind: 'document-missing', side: 'original', target: 'Index', detail: 'missing' } } }
    expect(webviewMessage).toMatchObject({ requestId: 7 }); expect(hostMessage).toMatchObject({ requestId: 7 })
  })

  it('appearance-change はホスト入力集合を UI 色なしで運ぶ', () => {
    const sources: AppearanceHostSources = { version: 3, settings: { ok: false, error: 'invalid' }, fallbackFont: { family: 'Mono', size: 14 }, tokenTheme: { ok: false, error: 'active theme read failed' } }
    const message = appearanceChangeMessage(sources)
    expect(message).toEqual({ type: 'appearance-change', appearance: sources })
    if (message.type === 'appearance-change') expect(Object.keys(message.appearance)).not.toContain('colors')
  })

  it('token theme command output preserves generation and JSON shape', () => {
    const output: ResolveActiveTokenThemeOutput = { generation: 4, result: { ok: true, value: { name: 'Sample', type: 'dark', tokenColors: [], semanticTokenColors: {}, semanticHighlighting: false } } }
    const roundtrip = JSON.parse(JSON.stringify(output)) as ResolveActiveTokenThemeOutput
    expect(roundtrip).toEqual(output)
    expect(Object.keys(roundtrip.result.ok ? roundtrip.result.value : {})).toEqual(['name', 'type', 'tokenColors', 'semanticTokenColors', 'semanticHighlighting'])
  })

  it('失敗は種類・側・対象名・詳細を保存する', () => {
    const failure: ComparisonFailure = { kind: 'revision-missing', side: 'original', target: 'missing-ref', detail: 'Unknown revision' }
    expect(Object.keys(failure).sort()).toEqual(['detail', 'kind', 'side', 'target'])
  })
})
