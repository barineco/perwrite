import { EditorSelection, EditorState } from '@codemirror/state'
import { currentProfile } from './view-mode'
import { correctedPointerPosition } from './interaction-rules'

export const irTransactionFilter = EditorState.transactionFilter.of((tr) => {
  if (tr.docChanged && !currentProfile(tr.startState).editable) {
    return [{ selection: tr.selection, effects: tr.effects }]
  }

  if (!tr.isUserEvent('select.pointer')) return tr

  const sel = tr.newSelection.main
  if (!sel.empty) return tr

  const correctedPos = correctedPointerPosition(tr.startState, sel.head)

  if (correctedPos !== sel.head) {
    return [{
      ...tr,
      selection: EditorSelection.single(correctedPos),
    }]
  }

  return tr
})
