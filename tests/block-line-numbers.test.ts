import { describe, expect, it } from 'vitest'
import { Text } from '@codemirror/state'
import { lineRangeForBlock } from '../webview/editor/block-line-numbers'

describe('block source range の行番号', () => {
  const doc = Text.of(['first', 'second', 'third'])

  it('次行先頭を指す半開区間の終端を範囲外へ含めない', () => {
    expect(lineRangeForBlock(doc, 0, doc.line(2).from)).toEqual({
      startLine: 1,
      endLine: 1,
    })
  })

  it('文書末尾を含む範囲の最終行を返す', () => {
    expect(lineRangeForBlock(doc, doc.line(2).from, doc.length)).toEqual({
      startLine: 2,
      endLine: 3,
    })
  })

  it('空範囲は位置が属する一行を返す', () => {
    expect(lineRangeForBlock(doc, doc.line(2).from, doc.line(2).from)).toEqual({
      startLine: 2,
      endLine: 2,
    })
  })
})
