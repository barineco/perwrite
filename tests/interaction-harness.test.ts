import { deleteCharBackward, deleteCharForward, redo, undo } from '@codemirror/commands'
import { describe, expect, it } from 'vitest'
import { applySpec, commandTarget, stateSignature } from './command-helpers'

describe('履歴付き command target', () => {
  it('文字入力、Undo、Redo の文書と selection を往復する', () => {
    const target = commandTarget('abcd', 2)
    applySpec(target, {
      changes: { from: 2, insert: 'x' },
      selection: { anchor: 3 },
      userEvent: 'input.type',
    })
    expect(stateSignature(target.state)).toEqual({
      doc: 'abxcd', ranges: [{ anchor: 3, head: 3 }], mainIndex: 0,
    })
    expect(undo(target)).toBe(true)
    expect(stateSignature(target.state)).toEqual({
      doc: 'abcd', ranges: [{ anchor: 2, head: 2 }], mainIndex: 0,
    })
    expect(redo(target)).toBe(true)
    expect(target.state.doc.toString()).toBe('abxcd')
  })

  it('通常 Backspace と Delete を command target で観測する', () => {
    const backward = commandTarget('abcd', 2)
    expect(deleteCharBackward(backward)).toBe(true)
    expect(stateSignature(backward.state)).toEqual({
      doc: 'acd', ranges: [{ anchor: 1, head: 1 }], mainIndex: 0,
    })

    const forward = commandTarget('abcd', 2)
    expect(deleteCharForward(forward)).toBe(true)
    expect(stateSignature(forward.state)).toEqual({
      doc: 'abd', ranges: [{ anchor: 2, head: 2 }], mainIndex: 0,
    })
  })
})
