import type { EditorState } from '@codemirror/state'

export function isCursorOnLine(state: EditorState, from: number, to: number): boolean {
  const sel = state.selection.main
  const cursorLine = state.doc.lineAt(sel.head)
  const rangeStartLine = state.doc.lineAt(from)
  const rangeEndLine = state.doc.lineAt(to)
  return cursorLine.number >= rangeStartLine.number && cursorLine.number <= rangeEndLine.number
}
