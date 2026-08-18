import { EditorState, StateEffect, Transaction, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { setEditorContent } from '../webview/editor/setup'

function editorHarness(doc: string): {
  readonly view: EditorView
  readonly transactions: readonly Transaction[]
} {
  let state = EditorState.create({ doc })
  const transactions: Transaction[] = []
  const scrollSnapshot = StateEffect.define<void>()
  const view = {
    get state() { return state },
    scrollSnapshot() { return scrollSnapshot.of() },
    dispatch(spec: TransactionSpec) {
      const transaction = state.update(spec)
      transactions.push(transaction)
      state = transaction.state
    },
  } as unknown as EditorView
  return { view, transactions }
}

describe('外部文書との同期', () => {
  it('同一内容は transaction を発行しない', () => {
    const harness = editorHarness('same content')

    setEditorContent(harness.view, 'same content')

    expect(harness.transactions).toHaveLength(0)
    expect(harness.view.state.doc.toString()).toBe('same content')
  })

  it('異なる内容は履歴外の docChanged transaction を一件発行する', () => {
    const harness = editorHarness('before value')

    setEditorContent(harness.view, 'after value')

    expect(harness.transactions).toHaveLength(1)
    expect(harness.transactions[0].docChanged).toBe(true)
    expect(harness.transactions[0].annotation(Transaction.addToHistory)).toBe(false)
    expect(harness.view.state.doc.toString()).toBe('after value')
  })
})
