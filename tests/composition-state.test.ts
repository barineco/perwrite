import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { compositionActiveField, setCompositionActiveEffect } from '../webview/editor/composition-state'
import { decorationOptionsOf } from '../webview/editor/decoration-options'
import { makeState } from './helpers'
import { irDecorationField } from '../webview/editor/ir-state-field'

function widgets(state: EditorState): unknown[] {
  const result: unknown[] = []
  state.field(irDecorationField).decorations.between(0, state.doc.length, (_from, _to, decoration) => {
    const widget = decorationOptionsOf(decoration).widget
    if (widget) result.push(widget)
  })
  return result
}

describe('composition 状態', () => {
  it('開始と終了の effect だけで状態を遷移する', () => {
    const initial = EditorState.create({ extensions: [compositionActiveField] })
    expect(initial.field(compositionActiveField)).toBe(false)

    const active = initial.update({ effects: setCompositionActiveEffect.of(true) }).state
    expect(active.field(compositionActiveField)).toBe(true)

    const changed = active.update({
      changes: { from: 0, insert: '日本' },
      selection: { anchor: 2 },
      userEvent: 'input.type.compose',
    }).state
    expect(changed.field(compositionActiveField)).toBe(true)
    expect(changed.doc.toString()).toBe('日本')
    expect(changed.selection.main.head).toBe(2)

    const ended = changed.update({ effects: setCompositionActiveEffect.of(false) }).state
    expect(ended.field(compositionActiveField)).toBe(false)
    expect(ended.doc.toString()).toBe('日本')
  })

  it('active 中は widget を changes で map し、終了時に現在の文書から再構築する', () => {
    const source = [
      'plain',
      '',
      '![image](image.png)',
      '',
      '$e=mc^2$',
      '',
      '```ts',
      'const x = 1',
      '```',
      '',
      '$$',
      'x + y',
      '$$',
      '',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
    ].join('\n')
    const initial = makeState(source)
    const before = widgets(initial)
    expect(before.length).toBeGreaterThanOrEqual(5)

    const active = initial.update({ effects: setCompositionActiveEffect.of(true) }).state
    const changed = active.update({
      changes: { from: 0, insert: '日本' },
      selection: { anchor: 2 },
      userEvent: 'input.type.compose',
    }).state
    const during = widgets(changed)
    expect(during).toHaveLength(before.length)
    expect(during).toEqual(before)

    const ended = changed.update({ effects: setCompositionActiveEffect.of(false) }).state
    const after = widgets(ended)
    expect(after).toHaveLength(before.length)
    expect(after.every((widget, index) => widget !== before[index])).toBe(true)
    expect(ended.doc.toString()).toBe(`日本${source}`)
  })

})
