import { describe, expect, it } from 'vitest'
import { buildDiffChunks } from '../webview/editor/comparison-diff'

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
