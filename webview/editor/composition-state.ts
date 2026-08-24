import { StateEffect, StateField } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

export const setCompositionActiveEffect = StateEffect.define<boolean>()

export const compositionActiveField = StateField.define<boolean>({
  create() {
    return false
  },
  update(active, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setCompositionActiveEffect)) return effect.value
    }
    return active
  },
})

export const compositionBaselineField = StateField.define<string | null>({
  create() {
    return null
  },
  update(baseline, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(setCompositionActiveEffect)) continue
      return effect.value ? transaction.startState.doc.toString() : null
    }
    return baseline
  },
})

export const compositionEventHandlers = EditorView.domEventHandlers({
  compositionstart(_event, view) {
    view.dispatch({ effects: setCompositionActiveEffect.of(true) })
    return false
  },
  compositionend(_event, view) {
    requestAnimationFrame(() => {
      if (view.dom.isConnected) {
        view.dispatch({ effects: setCompositionActiveEffect.of(false) })
      }
    })
    return false
  },
})
