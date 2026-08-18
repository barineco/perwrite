import { describe, it, expect } from 'vitest'
import { makeState } from './helpers'
import { irDecorationField } from '../webview/editor/ir-state-field'
import { viewModeField, setViewModeEffect } from '../webview/editor/view-mode'

// 代表文書について、装飾構築と表示切り替えの前後で文書テキストが一致することを確かめる。

const REPRESENTATIVE = [
  '# 見出し 1',
  '',
  '本文に *強調* と `inline code` と [[wikilink]] を含む。',
  '',
  '- 箇条書き 1',
  '- 箇条書き 2',
  '  - ネスト',
  '',
  '1. 番号 1',
  '2. 番号 2',
  '',
  '> 引用文',
  '',
  '| 列 A | 列 B |',
  '|------|------|',
  '| 1    | 2    |',
  '',
  '```ts',
  'const x = 1',
  '```',
  '',
  '$$',
  'a^2 + b^2 = c^2',
  '$$',
  '',
  'インライン数式 $e = mc^2$ を含む段落。',
].join('\n')

describe('表示化と編集の往復で文書が保存される', () => {
  it('decoration 構築は文書テキストを変えない', () => {
    const state = makeState(REPRESENTATIVE)
    // decoration field への参照が構築を発火させる。
    state.field(irDecorationField)
    expect(state.doc.toString()).toBe(REPRESENTATIVE)
  })

  it('モード切り替えの前後で文書テキストが一致する', () => {
    const state = makeState(REPRESENTATIVE)
    expect(state.field(viewModeField)).toBe('render')

    // raw へ切り替え、再度 render へ戻す往復。
    const off = state.update({ effects: setViewModeEffect.of('raw') }).state
    expect(off.field(viewModeField)).toBe('raw')
    expect(off.doc.toString()).toBe(REPRESENTATIVE)

    const on = off.update({ effects: setViewModeEffect.of('render') }).state
    expect(on.field(viewModeField)).toBe('render')
    expect(on.doc.toString()).toBe(REPRESENTATIVE)
  })

  it('モード切り替えを挟む編集の往復で代表文書へ戻る', () => {
    const state = makeState(REPRESENTATIVE)
    const off = state.update({ effects: setViewModeEffect.of('raw') }).state
    const changed = off.update({ changes: { from: 0, insert: 'X' } }).state
    const on = changed.update({ effects: setViewModeEffect.of('render') }).state
    const restored = on.update({ changes: { from: 0, to: 1 } }).state
    expect(restored.field(viewModeField)).toBe('render')
    expect(restored.doc.toString()).toBe(REPRESENTATIVE)
    restored.field(irDecorationField)
    expect(restored.doc.toString()).toBe(REPRESENTATIVE)
  })
})
