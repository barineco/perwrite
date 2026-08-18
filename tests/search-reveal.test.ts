import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { revealTargetField, setRevealTargetEffect, targetDecorations, targetLineStarts } from '../webview/editor/search-reveal'

const document = EditorState.create({ doc: 'alpha\nbeta\ngamma' }).doc

describe('検索対象の行所有', () => {
  it('改行は直前行に所有させる', () => {
    expect(targetLineStarts(document, 5, 6)).toEqual([0])
    expect(targetLineStarts(document, 4, 6)).toEqual([0])
    expect(targetLineStarts(document, 4, 11)).toEqual([0, 6])
  })

  it('空 range は開始行を可視化する', () => {
    expect(targetLineStarts(document, document.length, document.length)).toEqual([11])
    expect(targetDecorations({ from: 2, to: 2, source: 'external' }, document).size).toBeGreaterThan(0)
  })

  it('文書変更では古い target を消し、同一 transaction の新 target は残す', () => {
    let state = EditorState.create({ doc: 'alpha', extensions: [revealTargetField] })
    state = state.update({ effects: setRevealTargetEffect.of({ from: 1, to: 3, source: 'external' }) }).state
    expect(state.field(revealTargetField)).toMatchObject({ from: 1, to: 3 })
    state = state.update({ changes: { from: 0, to: 0, insert: 'x' } }).state
    expect(state.field(revealTargetField)).toBeNull()
    state = state.update({
      changes: { from: 0, to: 1, insert: 'z' },
      effects: setRevealTargetEffect.of({ from: 2, to: 4, source: 'internal' }),
    }).state
    expect(state.field(revealTargetField)).toMatchObject({ from: 2, to: 4, source: 'internal' })
  })
})
