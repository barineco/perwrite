import { history, redo, undo } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state'
import { GFM } from '@lezer/markdown'
import { describe, expect, it } from 'vitest'
import { toggleTaskMarker } from '../webview/editor/task-editing'

interface CommandTarget {
  readonly state: EditorState
  dispatch(transaction: Transaction): void
}

function target(
  doc: string,
  selection: EditorSelection,
  readOnly = false,
): CommandTarget {
  let state = EditorState.create({
    doc,
    selection,
    extensions: [
      markdown({ base: markdownLanguage, extensions: [GFM] }),
      EditorState.allowMultipleSelections.of(true),
      EditorState.readOnly.of(readOnly),
      history(),
    ],
  })

  return {
    get state() { return state },
    dispatch(transaction) { state = transaction.state },
  }
}

function applyToggle(commandTarget: CommandTarget, position: number): boolean {
  const spec = toggleTaskMarker(commandTarget.state, position)
  if (!spec) return false
  commandTarget.dispatch(commandTarget.state.update(spec))
  return true
}

function signature(state: EditorState) {
  return {
    doc: state.doc.toString(),
    selection: state.selection.ranges.map(range => ({
      anchor: range.anchor,
      head: range.head,
    })),
    mainIndex: state.selection.mainIndex,
  }
}

describe('task marker の切り替え', () => {
  it.each([
    ['[ ]', '[x]'],
    ['[x]', '[ ]'],
    ['[X]', '[ ]'],
  ] as const)('%s を %s へ切り替え、Undo と Redo で文書と selection を復元する', (before, after) => {
    const doc = `- ${before} task\n\noutside`
    const selection = EditorSelection.create([
      EditorSelection.cursor(doc.indexOf('outside') + 3),
      EditorSelection.range(doc.indexOf('task'), doc.indexOf('task') + 2),
    ], 1)
    const commandTarget = target(doc, selection)
    const initial = signature(commandTarget.state)

    expect(applyToggle(commandTarget, doc.indexOf(before) + 1)).toBe(true)
    const changed = signature(commandTarget.state)
    expect(changed).toEqual({
      doc: `- ${after} task\n\noutside`,
      selection: initial.selection,
      mainIndex: initial.mainIndex,
    })

    expect(undo(commandTarget)).toBe(true)
    expect(signature(commandTarget.state)).toEqual(initial)

    expect(redo(commandTarget)).toBe(true)
    expect(signature(commandTarget.state)).toEqual(changed)
  })

  it('marker の開始位置と終了位置から同じ TaskMarker を解決する', () => {
    const doc = '- [ ] task'
    const markerFrom = doc.indexOf('[ ]')
    for (const position of [markerFrom, markerFrom + 3]) {
      const commandTarget = target(doc, EditorSelection.cursor(doc.length))
      expect(applyToggle(commandTarget, position)).toBe(true)
      expect(commandTarget.state.doc.toString()).toBe('- [x] task')
    }
  })

  it.each([
    ['通常の checkbox 風テキスト', 'plain [ ] text', 7],
    ['不正 marker', '- [q] task', 3],
    ['TaskMarker の外', '- [ ] task', 8],
  ])('%s は文書と selection を変更しない', (_name, doc, position) => {
    const selection = EditorSelection.range(0, Math.min(2, doc.length))
    const commandTarget = target(doc, selection)
    const before = signature(commandTarget.state)

    expect(applyToggle(commandTarget, position)).toBe(false)
    expect(signature(commandTarget.state)).toEqual(before)
    expect(undo(commandTarget)).toBe(false)
  })

  it('読み取り専用の TaskMarker は文書と selection を変更しない', () => {
    const doc = '- [ ] task'
    const selection = EditorSelection.cursor(doc.length)
    const commandTarget = target(doc, selection, true)
    const before = signature(commandTarget.state)

    expect(applyToggle(commandTarget, doc.indexOf('[ ]') + 1)).toBe(false)
    expect(signature(commandTarget.state)).toEqual(before)
    expect(undo(commandTarget)).toBe(false)
  })

  it('別行にある範囲 selection を保存して pointer と同じ位置入力を処理する', () => {
    const doc = '- [ ] task\n\nother line'
    const selection = EditorSelection.range(doc.indexOf('other'), doc.length)
    const commandTarget = target(doc, selection)

    expect(applyToggle(commandTarget, doc.indexOf('[ ]') + 1)).toBe(true)
    expect(signature(commandTarget.state)).toEqual({
      doc: '- [x] task\n\nother line',
      selection: [{ anchor: doc.indexOf('other'), head: doc.length }],
      mainIndex: 0,
    })
  })
})
