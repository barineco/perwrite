import { describe, expect, it } from 'vitest'
import {
  resolveCommitComparisonInput,
  resolveHistoryComparison,
  resolveTimelineComparisonRefs,
} from '../src/history-comparison'

describe('SCM 履歴からの commit 比較', () => {
  it('一つの履歴項目は親 commit と比較する', () => {
    expect(resolveHistoryComparison([{ id: 'second', parentIds: ['first'] }])).toEqual({
      ok: true, value: { originalRef: 'first', modifiedRef: 'second' },
    })
  })

  it('二つの履歴項目を比較元と比較先へ変換する', () => {
    const second = { id: 'second', parentIds: ['first'] }
    const first = { id: 'first', parentIds: [] }
    expect(resolveHistoryComparison([{ providerId: 'git' }, second, [second, first]])).toEqual({
      ok: true, value: { originalRef: 'first', modifiedRef: 'second' },
    })
  })

  it('親のない一項目と外部の別型を拒否する', () => {
    expect(resolveHistoryComparison([{ rootUri: '/repo' }, { id: 'first', parentIds: [] }]))
      .toEqual({ ok: false, error: 'Select a commit with a parent or select two commits in Source Control history.' })
  })
})

describe('Timeline からの commit 比較', () => {
  const resourceUri = {
    scheme: 'file',
    fsPath: '/repo/note.md',
    path: '/repo/note.md',
  }

  it('Git commit 項目の ref と第 2 引数の対象 URI を採用する', () => {
    expect(resolveCommitComparisonInput([
      { ref: 'moving-ref', contextValue: 'git:file:commit' },
      resourceUri,
      { source: 'git' },
    ])).toEqual({
      ok: true,
      value: { kind: 'timeline', ref: 'moving-ref', resourceUri },
    })
  })

  it('別種の Timeline 項目と対象 URI のない commit 項目を拒否する', () => {
    expect(resolveCommitComparisonInput([
      { ref: 'target', contextValue: 'git:file:history' },
      resourceUri,
    ])).toMatchObject({ ok: false })
    expect(resolveCommitComparisonInput([
      { ref: 'target', contextValue: 'git:file:commit' },
    ])).toEqual({ ok: false, error: 'The Timeline commit does not identify a document.' })
  })

  it('解決済み hash と第一親を比較へ渡し、初回 commit は理由付きで拒否する', () => {
    expect(resolveTimelineComparisonRefs({
      hash: 'target-hash',
      parentHash: 'first-parent',
    })).toEqual({
      ok: true,
      value: { originalRef: 'first-parent', modifiedRef: 'target-hash' },
    })
    expect(resolveTimelineComparisonRefs({
      hash: 'root-hash',
      parentHash: null,
    })).toEqual({
      ok: false,
      error: 'The selected commit has no parent to compare.',
    })
  })

})
