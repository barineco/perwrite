import { describe, expect, it } from 'vitest'
import { buildDiffChunks } from '../webview/editor/comparison-diff'
import { interpolateAnchors, scrollAnchors } from '../webview/editor/comparison-state'

const original = [
  '# Title',
  'before',
  'deleted one',
  'deleted two',
  'after',
  'tail',
].join('\n')

const modified = [
  '# Title',
  'before changed',
  'added one',
  'after',
  'tail',
  'new tail',
].join('\n')

describe('二画面比較の差分データ', () => {
  it('変更・追加・削除を左右の文書範囲として返す', () => {
    const chunks = buildDiffChunks(original, modified)
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.some(chunk => chunk.originalFrom < chunk.originalTo)).toBe(true)
    expect(chunks.some(chunk => chunk.modifiedFrom < chunk.modifiedTo)).toBe(true)
    expect(chunks.every(chunk => !('changes' in chunk))).toBe(true)
  })

  it('左右交換で差分範囲も交換される', () => {
    const direct = buildDiffChunks(original, modified)
    const reversed = buildDiffChunks(modified, original)
    expect(reversed.map(chunk => ({
      originalFrom: chunk.modifiedFrom,
      originalTo: chunk.modifiedTo,
      modifiedFrom: chunk.originalFrom,
      modifiedTo: chunk.originalTo,
    }))).toEqual(direct)
  })
})

describe('chunk 対応点の補間', () => {
  it('追加・削除のゼロ長範囲を一つの単調な対応点へ統合する', () => {
    const chunks = buildDiffChunks(original, modified)
    for (const side of ['original', 'modified'] as const) {
      const anchors = scrollAnchors(chunks, original.length, modified.length, side)
      expect(anchors[0]).toEqual({ source: 0, target: 0 })
      expect(anchors.at(-1)?.source).toBe(side === 'original' ? original.length : modified.length)
      for (let index = 1; index < anchors.length; index++) {
        expect(anchors[index].source).toBeGreaterThan(anchors[index - 1].source)
        expect(anchors[index].target).toBeGreaterThanOrEqual(anchors[index - 1].target)
      }
    }
  })

  it('対応点と区間の中点を線形に写す', () => {
    const anchors = [{ source: 0, target: 0 }, { source: 10, target: 30 }, { source: 20, target: 40 }]
    expect(interpolateAnchors(anchors, 0)).toBe(0)
    expect(interpolateAnchors(anchors, 5)).toBe(15)
    expect(interpolateAnchors(anchors, 15)).toBe(35)
    expect(interpolateAnchors(anchors, 20)).toBe(40)
  })

  it('同一文書では先頭と末尾の恒等写像になる', () => {
    const anchors = scrollAnchors([], original.length, original.length, 'original')
    expect(interpolateAnchors(anchors, original.length / 2)).toBe(original.length / 2)
  })
})
