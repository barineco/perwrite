import { describe, expect, it } from 'vitest'
import { irDecorationField } from '../webview/editor/ir-state-field'
import { makeState } from './helpers'

function decorationRanges(source: string): Array<[number, number]> {
  const state = makeState(source)
  const ranges: Array<[number, number]> = []
  state.field(irDecorationField).decorations.between(0, state.doc.length, (from, to, decoration) => {
    if (to > from) ranges.push([from, to])
  })
  expect(state.doc.toString()).toBe(source)
  return ranges
}

describe('不正な構文の製品経路', () => {
  it('閉じない fence を生テキストとして残す', () => {
    const source = '```ts\nconst value = 1'
    expect(decorationRanges(source)).toEqual([])
  })

  it('閉じない block 数式を生テキストとして残す', () => {
    const source = '$$\nx + y'
    expect(decorationRanges(source)).toEqual([])
  })

  it('閉じない inline 数式を生テキストとして残す', () => {
    const source = 'before $x + y after'
    expect(decorationRanges(source)).toEqual([])
  })
})
