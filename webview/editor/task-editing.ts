import { type EditorState, type TransactionSpec } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { isolateHistory } from '@codemirror/commands'

function taskMarkerAt(state: EditorState, position: number): { from: number; to: number } | null {
  if (position < 0 || position > state.doc.length) return null

  for (const bias of [1, -1] as const) {
    const resolved = syntaxTree(state).resolve(position, bias)
    let node: typeof resolved | null = resolved
    while (node && node.name !== 'TaskMarker') node = node.parent
    if (node?.name === 'TaskMarker' && position >= node.from && position <= node.to) {
      return node
    }
  }

  return null
}

export function toggleTaskMarker(state: EditorState, position: number): TransactionSpec | null {
  if (state.readOnly) return null

  const marker = taskMarkerAt(state, position)
  if (!marker) return null

  const current = state.doc.sliceString(marker.from, marker.to)
  let insert: '[ ]' | '[x]'
  if (current === '[ ]') insert = '[x]'
  else if (current === '[x]' || current === '[X]') insert = '[ ]'
  else return null

  return {
    changes: { from: marker.from, to: marker.to, insert },
    userEvent: 'input',
    annotations: isolateHistory.of('full'),
  }
}
