import { EditorState, Transaction } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { suppressScrollContinuity } from '../webview/editor/scroll-continuity'

describe('scroll continuity suppression', () => {
  it('marks external content replacements without affecting history annotations', () => {
    const transaction = EditorState.create({ doc: 'before' }).update({
      changes: { from: 0, to: 6, insert: 'after' },
      annotations: [
        Transaction.addToHistory.of(false),
        suppressScrollContinuity.of(true),
      ],
    })

    expect(transaction.annotation(suppressScrollContinuity)).toBe(true)
    expect(transaction.annotation(Transaction.addToHistory)).toBe(false)
  })
})
