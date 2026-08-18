import { history, redo, redoDepth, undo, undoDepth } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState, type StateCommand, type Transaction } from '@codemirror/state'
import { GFM } from '@lezer/markdown'
import { describe, expect, it } from 'vitest'
import { runIsolatedNewlineContinueMarkup } from '../webview/editor/ir-keymap'

interface CommandTarget {
  readonly state: EditorState
  dispatch(transaction: Transaction): void
}

function target(doc: string, anchor: number): CommandTarget {
  let state = EditorState.create({
    doc,
    selection: { anchor },
    extensions: [
      markdown({ base: markdownLanguage, extensions: [GFM] }),
      history(),
    ],
  })
  return {
    get state() { return state },
    dispatch(transaction) { state = transaction.state },
  }
}

function run(commandTarget: CommandTarget, command: StateCommand): boolean {
  return command(commandTarget)
}

function type(commandTarget: CommandTarget, text: string): void {
  const anchor = commandTarget.state.selection.main.head
  commandTarget.dispatch(commandTarget.state.update({
    changes: { from: anchor, insert: text },
    selection: { anchor: anchor + text.length },
    userEvent: 'input.type',
  }))
}

function signature(commandTarget: CommandTarget) {
  return {
    doc: commandTarget.state.doc.toString(),
    selection: commandTarget.state.selection.ranges.map(range => ({
      anchor: range.anchor,
      head: range.head,
    })),
  }
}

describe('Markdown list 継続の履歴', () => {
  it.each([
    {
      name: '通常 list',
      before: { doc: '- item', selection: [{ anchor: 6, head: 6 }] },
      after: { doc: '- item\n- ', selection: [{ anchor: 9, head: 9 }] },
    },
    {
      name: 'OrderedList の連番書き換え',
      before: { doc: '1. one\n2. two', selection: [{ anchor: 6, head: 6 }] },
      after: { doc: '1. one\n2. \n3. two', selection: [{ anchor: 10, head: 10 }] },
    },
    {
      name: '空項目の継続解除',
      before: { doc: '- item\n\n- ', selection: [{ anchor: 10, head: 10 }] },
      after: { doc: '- item\n\n', selection: [{ anchor: 8, head: 8 }] },
    },
  ])('$name は Enter 前・適用後・Undo 後・Redo 後を往復する', ({ before, after }) => {
    const commandTarget = target(before.doc, before.selection[0].head)

    expect(run(commandTarget, runIsolatedNewlineContinueMarkup)).toBe(true)
    expect(signature(commandTarget)).toEqual(after)
    expect(undoDepth(commandTarget.state)).toBe(1)

    expect(run(commandTarget, undo)).toBe(true)
    expect(signature(commandTarget)).toEqual(before)
    expect(redoDepth(commandTarget.state)).toBe(1)

    expect(run(commandTarget, redo)).toBe(true)
    expect(signature(commandTarget)).toEqual(after)
  })

  it('入力・継続 Enter・入力を三段の履歴として保存する', () => {
    const commandTarget = target('- item', 6)
    const initial = signature(commandTarget)

    type(commandTarget, 'x')
    const beforeEnter = signature(commandTarget)
    expect(run(commandTarget, runIsolatedNewlineContinueMarkup)).toBe(true)
    const afterEnter = signature(commandTarget)
    type(commandTarget, 'y')
    const completed = signature(commandTarget)

    expect(undoDepth(commandTarget.state)).toBe(3)
    expect(completed).toEqual({
      doc: '- itemx\n- y',
      selection: [{ anchor: 11, head: 11 }],
    })

    expect(run(commandTarget, undo)).toBe(true)
    expect(signature(commandTarget)).toEqual(afterEnter)
    expect(run(commandTarget, undo)).toBe(true)
    expect(signature(commandTarget)).toEqual(beforeEnter)
    expect(run(commandTarget, undo)).toBe(true)
    expect(signature(commandTarget)).toEqual(initial)

    expect(run(commandTarget, redo)).toBe(true)
    expect(signature(commandTarget)).toEqual(beforeEnter)
    expect(run(commandTarget, redo)).toBe(true)
    expect(signature(commandTarget)).toEqual(afterEnter)
    expect(run(commandTarget, redo)).toBe(true)
    expect(signature(commandTarget)).toEqual(completed)
  })
})
