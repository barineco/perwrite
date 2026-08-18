import { describe, expect, it } from 'vitest'
import { EditorSelection, Transaction } from '@codemirror/state'
import { redo, undo } from '@codemirror/commands'
import { makeState } from './helpers'
import { correctedPointerPosition, deletionTransaction, type DeletionDirection } from '../webview/editor/interaction-rules'

function applyDeletion(source: string, position: number, direction: DeletionDirection) {
  const state = makeState(source).update({ selection: EditorSelection.cursor(position) }).state
  const spec = deletionTransaction(state, direction)
  return { state, spec, next: spec ? state.update(spec).state : state }
}

function mutableTarget(state: ReturnType<typeof makeState>) {
  let current = state
  return {
    get state() { return current },
    dispatch(transaction: ReturnType<typeof current.update>) { current = transaction.state },
  }
}

describe('block source range の二段階削除', () => {
  const examples = [
    '```ts\nconst x = 1\n```',
    '$$\nx + y\n$$',
    '| A | B |\n| - | - |\n| 1 | 2 |',
  ]

  for (const source of examples) {
    it(`Backspace は選択後に削除する: ${source.slice(0, 8)}`, () => {
      const first = applyDeletion(source, source.length, 'backward')
      expect(first.next.doc.toString()).toBe(source)
      expect(first.next.selection.main).toMatchObject({ from: 0, to: source.length })

      const secondSpec = deletionTransaction(first.next, 'backward')
      expect(secondSpec).not.toBeNull()
      const second = first.next.update(secondSpec!).state
      expect(second.doc.toString()).toBe('')
      expect(second.selection.main).toMatchObject({ from: 0, to: 0 })

      const target = mutableTarget(second)
      expect(undo(target)).toBe(true)
      expect(target.state.doc.toString()).toBe(source)
      expect(target.state.selection.main).toMatchObject({ from: 0, to: source.length })
      expect(redo(target)).toBe(true)
      expect(target.state.doc.toString()).toBe('')
    })

    it(`Delete は選択後に削除する: ${source.slice(0, 8)}`, () => {
      const first = applyDeletion(source, 0, 'forward')
      expect(first.next.doc.toString()).toBe(source)
      expect(first.next.selection.main).toMatchObject({ from: 0, to: source.length })

      const second = first.next.update(deletionTransaction(first.next, 'forward')!).state
      expect(second.doc.toString()).toBe('')
      expect(second.selection.main.head).toBe(0)

      const target = mutableTarget(second)
      expect(undo(target)).toBe(true)
      expect(target.state.doc.toString()).toBe(source)
      expect(target.state.selection.main).toMatchObject({ from: 0, to: source.length })
      expect(redo(target)).toBe(true)
      expect(target.state.doc.toString()).toBe('')
    })
  }
})

describe('hidden marker の削除', () => {
  it.each([
    ['**bold**', 2, 'backward', 'bold**'],
    ['**bold**', 6, 'forward', '**bold'],
    ['*em*', 1, 'backward', 'em*'],
    ['*em*', 3, 'forward', '*em'],
    ['~~gone~~', 2, 'backward', 'gone~~'],
    ['~~gone~~', 6, 'forward', '~~gone'],
    ['[[target|label]]', 9, 'backward', 'label]]'],
    ['[[target|label]]', 14, 'forward', '[[target|label'],
    ['# heading', 2, 'backward', 'heading'],
    ['# heading', 0, 'forward', 'heading'],
    ['> quote', 2, 'backward', 'quote'],
    ['> quote', 0, 'forward', 'quote'],
    ['- item', 2, 'backward', 'item'],
    ['- item', 0, 'forward', 'item'],
    ['[label](target)', 0, 'forward', 'label](target)'],
    ['[label](target)', 15, 'backward', '[label'],
  ] as const)('%s の marker だけを削除する', (source, position, direction, expected) => {
    const { next } = applyDeletion(source, position, direction)
    expect(next.doc.toString()).toBe(expected)
    expect(next.selection.main.head).toBe(direction === 'backward'
      ? position - (source.length - expected.length)
      : position)
  })

  it('通常文字と閉じない構文は処理しない', () => {
    expect(deletionTransaction(makeState('plain'), 'backward')).toBeNull()
    const invalid = makeState('```ts\nvalue').update({ selection: { anchor: 5 } }).state
    expect(deletionTransaction(invalid, 'backward')).toBeNull()
  })

  it.each(['raw', 'rich', 'render'] as const)(
    '%s の decoration と atomic range に依存せず同じ marker を削除する',
    (mode) => {
      const state = makeState('**bold**', mode).update({ selection: { anchor: 2 } }).state
      const spec = deletionTransaction(state, 'backward')
      expect(spec).not.toBeNull()
      expect(state.update(spec!).state.doc.toString()).toBe('bold**')
    },
  )
})

describe('pointer selection の補正', () => {
  it('block source 内の位置を保存する', () => {
    const source = '```ts\nx\n```'
    const state = makeState(source)
    for (const position of [1, Math.floor(source.length / 2), source.length - 1]) {
      expect(correctedPointerPosition(state, position)).toBe(position)
    }
  })

  it('端点と外側は保存する', () => {
    const state = makeState('before **bold** after')
    for (const position of [0, 7, 9, 13, 21]) {
      expect(correctedPointerPosition(state, position)).toBe(position)
    }
  })

  it('pointer transaction は block source 内の selection を保存する', () => {
    const source = '```ts\nx\n```'
    const state = makeState(source)
    const inside = state.update({
      selection: { anchor: 1 },
      annotations: Transaction.userEvent.of('select.pointer'),
    }).state
    expect(inside.selection.main.head).toBe(1)

    const endpoint = state.update({
      selection: { anchor: source.length },
      annotations: Transaction.userEvent.of('select.pointer'),
    }).state
    expect(endpoint.selection.main.head).toBe(source.length)
  })
})
