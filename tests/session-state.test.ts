import { describe, expect, it } from 'vitest'
import { beginComparison, createWebviewState, initializeWebviewSession, transitionWebviewState } from '../webview/session-state'
import type { ResolvedGitComparison } from '../src/protocol'

describe('Webview session state', () => {
  it('表示面と dispose を別の座標として扱う', () => {
    const state = createWebviewState('session-1', 'comparison')
    const disposed = transitionWebviewState(state, { type: 'dispose' })
    expect(disposed.state.displaySession).toBe('comparison')
    expect(disposed.state.lifecycle).toBe('disposed')
  })

  it('古い比較応答を現在の pending identity へ適用しない', () => {
    const state = createWebviewState('session-1')
    const pending = beginComparison(state, 2, { kind: 'index' }, { kind: 'working-tree' }).state
    expect(pending.comparison.kind).toBe('pending')
    const stale = transitionWebviewState(pending, { type: 'comparison-result', requestId: 1, result: { ok: false, error: { kind: 'comparison-unresolved', side: null, target: 'Index', detail: 'stale' } } })
    expect(stale.state).toBe(pending)
    expect(stale.effects).toEqual([{ type: 'drop-invalid-event', reason: 'comparison result identity does not match the pending request' }])
  })

  it('readonly initialization は identity と request sequence を保存して遅延比較応答を破棄する', () => {
    const initialized = initializeWebviewSession(createWebviewState('placeholder'), 'file:///doc.md', 'editing')
    const pending = beginComparison(initialized, 1, { kind: 'index' }, { kind: 'working-tree' }).state
    const readonly = initializeWebviewSession(pending, 'git:commit', 'readonly')
    expect(readonly.sessionIdentity).toBe('file:///doc.md')
    expect(readonly.sessionGeneration).toBe(3)
    expect(readonly.nextComparisonRequest).toBe(1)
    const delayed = transitionWebviewState(readonly, { type: 'comparison-result', requestId: 1, result: { ok: false, error: { kind: 'comparison-unresolved', side: null, target: 'Index', detail: 'stale' } } })
    expect(delayed.state).toBe(readonly)
    expect(delayed.effects).toEqual([{ type: 'drop-invalid-event', reason: 'comparison result identity does not match the pending request' }])
    expect(beginComparison(readonly, readonly.nextComparisonRequest + 1, { kind: 'index' }, { kind: 'working-tree' }).state.nextComparisonRequest).toBe(2)
  })

  it('comparison-init は初期結果を ready または failed に確定する', () => {
    const comparison = {} as ResolvedGitComparison
    const ready = transitionWebviewState(createWebviewState('placeholder'), {
      type: 'initialize-comparison', sessionIdentity: 'git:modified', result: { ok: true, value: comparison },
    }).state
    expect(ready.comparison).toMatchObject({ kind: 'ready', requestId: null, result: comparison })
    expect(ready.sessionIdentity).toBe('git:modified')
    expect(ready.sessionGeneration).toBe(1)

    const failed = transitionWebviewState(createWebviewState('placeholder'), {
      type: 'initialize-comparison', sessionIdentity: 'git:modified', result: {
        ok: false, error: { kind: 'comparison-unresolved', side: null, target: 'Index', detail: 'failed' },
      },
    }).state
    expect(failed.comparison).toMatchObject({ kind: 'failed', requestId: null, original: null, modified: null })
    expect(failed.sessionGeneration).toBe(1)
  })
})
