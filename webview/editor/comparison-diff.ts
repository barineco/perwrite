import { Chunk } from '@codemirror/merge'
import { Text } from '@codemirror/state'

export interface DiffChunk {
  readonly originalFrom: number
  readonly originalTo: number
  readonly modifiedFrom: number
  readonly modifiedTo: number
}

export function buildDiffChunks(original: string, modified: string): readonly DiffChunk[] {
  const originalDocument = Text.of(original.split('\n'))
  const modifiedDocument = Text.of(modified.split('\n'))
  return Chunk.build(originalDocument, modifiedDocument).map(chunk => ({
    originalFrom: chunk.fromA,
    originalTo: chunk.endA,
    modifiedFrom: chunk.fromB,
    modifiedTo: chunk.endB,
  }))
}
