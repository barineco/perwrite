import { describe, it, expect } from 'vitest'
import { syntaxTree } from '@codemirror/language'
import { makeState, atomicRangesOf, isAtomicallyCovered } from './helpers'

// backtick 完成後の文書で、導出された atomic 範囲が inline code 内部を覆わないこと、
// および内部への挿入が文書へ反映されることを確かめる。

function inlineCodeRange(doc: string): { from: number; to: number } {
  const state = makeState(doc)
  let range: { from: number; to: number } | null = null
  syntaxTree(state).iterate({
    enter(n) {
      if (n.name === 'InlineCode') range = { from: n.from, to: n.to }
    },
  })
  if (!range) throw new Error('InlineCode ノードが見つからない')
  return range
}

describe('inline code の内部進入と編集', () => {
  it('atomic RangeSet が InlineCode 内部の各位置を覆わない', () => {
    const doc = 'text `code` more'
    const range = inlineCodeRange(doc)
    const atomic = atomicRangesOf(makeState(doc))
    // backtick の内側の全位置 ( from+1 .. to-1 ) が atomic に覆われない。
    for (let pos = range.from + 1; pos < range.to; pos++) {
      expect(isAtomicallyCovered(atomic, pos), `pos=${pos}`).toBe(false)
    }
  })

  it('InlineCode 内部への挿入が文書へ反映される', () => {
    const doc = 'text `code` more'
    const range = inlineCodeRange(doc)
    const state = makeState(doc)
    // ` の直後 ( 内部の先頭 ) へ 1 文字挿入する。
    const insertAt = range.from + 1
    const next = state.update({ changes: { from: insertAt, insert: 'X' } }).state
    expect(next.doc.toString()).toBe('text `Xcode` more')
  })

  it('内部の各位置への編集を順に適用できる', () => {
    let state = makeState('`abc`')
    for (const pos of [1, 3, 5]) {
      expect(isAtomicallyCovered(atomicRangesOf(state), pos)).toBe(false)
      state = state.update({ changes: { from: pos, insert: 'x' } }).state
    }
    expect(state.doc.toString()).toBe('`xaxbxc`')
  })

  it('内部の連続位置へ 1 文字ずつ進入できる ( 覆われない位置の連なり )', () => {
    const doc = 'a `hello` b'
    const range = inlineCodeRange(doc)
    const atomic = atomicRangesOf(makeState(doc))
    const covered: number[] = []
    for (let pos = range.from + 1; pos < range.to; pos++) {
      if (isAtomicallyCovered(atomic, pos)) covered.push(pos)
    }
    expect(covered).toEqual([])
  })
})
