import { history } from '@codemirror/commands'
import { EditorState, type Extension, type Transaction, type TransactionSpec } from '@codemirror/state'

export interface MutableCommandTarget {
  readonly state: EditorState
  dispatch(transaction: Transaction): void
}

export function commandTarget(
  doc: string,
  anchor: number,
  extensions: Extension = [],
): MutableCommandTarget {
  let state = EditorState.create({
    doc,
    selection: { anchor },
    extensions: [history(), extensions],
  })
  return {
    get state() { return state },
    dispatch(transaction) { state = transaction.state },
  }
}

export function applySpec(target: MutableCommandTarget, spec: TransactionSpec): void {
  target.dispatch(target.state.update(spec))
}

export function stateSignature(state: EditorState) {
  return {
    doc: state.doc.toString(),
    ranges: state.selection.ranges.map(range => ({
      anchor: range.anchor,
      head: range.head,
    })),
    mainIndex: state.selection.mainIndex,
  }
}
