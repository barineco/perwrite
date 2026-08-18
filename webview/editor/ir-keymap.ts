import { keymap, type EditorView } from '@codemirror/view'
import { EditorSelection, Prec, Transaction, type StateCommand } from '@codemirror/state'
import { isolateHistory } from '@codemirror/commands'
import { deleteMarkupBackward, insertNewlineContinueMarkup } from '@codemirror/lang-markdown'
import { decorationOptionsOf } from './decoration-options'
import { irDecorationField } from './ir-state-field'
import { viewModeField, setViewModeEffect, cycleViewMode } from './view-mode'
import { indentListHierarchy, outdentListHierarchy } from './list-hierarchy'
import { deletionTransaction } from './interaction-rules'
import { compositionActiveField } from './composition-state'

export const runIsolatedNewlineContinueMarkup: StateCommand = ({ state, dispatch }) => {
  let generated: Transaction | null = null
  const applied = insertNewlineContinueMarkup({
    state,
    dispatch(transaction) {
      generated = transaction
    },
  })
  if (!applied || generated === null) return false

  const transaction: Transaction = generated
  const userEvent = transaction.annotation(Transaction.userEvent)
  dispatch(state.update({
    changes: transaction.changes,
    selection: transaction.newSelection,
    effects: transaction.effects,
    scrollIntoView: transaction.scrollIntoView,
    annotations: isolateHistory.of('full'),
    ...(userEvent === undefined ? {} : { userEvent }),
  }))
  return true
}

function cursorVerticalGuard(view: EditorView, forward: boolean): boolean {
  const { state } = view
  const range = state.selection.main
  if (!range.empty) return false

  const target = view.moveVertically(range, forward)
  if (target.head === range.head) return false

  const cursorLine = state.doc.lineAt(range.head)
  const targetLine = state.doc.lineAt(target.head)

  if (Math.abs(targetLine.number - cursorLine.number) <= 1) return false

  const decos = state.field(irDecorationField, false)?.decorations
  const minPos = Math.min(range.head, target.head)
  const maxPos = Math.max(range.head, target.head)

  let blockWidget: { from: number; to: number } | null = null
  if (decos) {
    decos.between(minPos, maxPos, (from, to, value) => {
      if (!decorationOptionsOf(value).block) return
      if (forward) {
        if (!blockWidget) blockWidget = { from, to }
        return false
      } else {
        blockWidget = { from, to }
      }
    })
  }

  const bw = blockWidget as { from: number; to: number } | null
  if (bw) {
    if (forward) {
      const blockFirstLine = state.doc.lineAt(bw.from)
      if (blockFirstLine.number === cursorLine.number + 1) {
        view.dispatch({
          selection: EditorSelection.single(bw.from),
          scrollIntoView: true,
        })
        return true
      }
    } else {
      const blockLastLine = state.doc.lineAt(Math.max(bw.from, bw.to - 1))
      if (blockLastLine.number === cursorLine.number - 1) {
        view.dispatch({
          selection: EditorSelection.single(bw.to),
          scrollIntoView: true,
        })
        return true
      }
    }
  }

  const adjacentNum = forward ? cursorLine.number + 1 : cursorLine.number - 1
  if (adjacentNum < 1 || adjacentNum > state.doc.lines) return false

  const adjacentLine = state.doc.line(adjacentNum)
  const col = range.head - cursorLine.from
  const pos = Math.min(adjacentLine.from + col, adjacentLine.to)

  view.dispatch({
    selection: EditorSelection.single(pos),
    scrollIntoView: true,
  })
  return true
}

export const irKeymap = Prec.high(keymap.of([
  {
    key: 'Enter',
    run: runIsolatedNewlineContinueMarkup,
  },
  {
    key: 'Tab',
    run(view: EditorView): boolean {
      if (view.state.field(compositionActiveField, false) === true) return true
      return indentListHierarchy(view)
    },
  },
  {
    key: 'Shift-Tab',
    run(view: EditorView): boolean {
      if (view.state.field(compositionActiveField, false) === true) return true
      return outdentListHierarchy(view)
    },
  },
  {
    key: 'ArrowDown',
    run(view: EditorView): boolean {
      return cursorVerticalGuard(view, true)
    },
  },
  {
    key: 'ArrowUp',
    run(view: EditorView): boolean {
      return cursorVerticalGuard(view, false)
    },
  },
  {
    key: 'Backspace',
    run(view: EditorView): boolean {
      if (view.state.field(compositionActiveField, false) === true) return false
      if (deleteMarkupBackward(view)) return true
      const spec = deletionTransaction(view.state, 'backward')
      if (!spec) return false
      view.dispatch(spec)
      return true
    },
  },
  {
    key: 'Delete',
    run(view: EditorView): boolean {
      if (view.state.field(compositionActiveField, false) === true) return false
      const spec = deletionTransaction(view.state, 'forward')
      if (!spec) return false
      view.dispatch(spec)
      return true
    },
  },
  {
    key: 'Mod-Shift-m',
    run(view: EditorView): boolean {
      const next = cycleViewMode(view.state.field(viewModeField))
      view.dispatch({ effects: setViewModeEffect.of(next) })
      return true
    },
  },
]))
