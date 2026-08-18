import { StateField, StateEffect, RangeSet, type EditorState, type Range } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { ruleFor, type RenderRule } from './render-rules'
import { currentProfile } from './view-mode'
import { compositionActiveField } from './composition-state'
import {
  deriveRichNode,
  interpretDisplay,
  isActiveForRule,
  isRuleActive,
  pushBlockLines,
  type DeriveContext,
  type NodeInfo,
} from './ir-display-derivation'
import { nodeRenderData } from './ir-node-render-registry'
import { getAppearanceVersion } from '../appearance'

export { isActiveForRule }

export interface DecorationDiagnosticRange {
  readonly from: number
  readonly to: number
}

export interface DecorationDiagnostic {
  readonly visitedRanges: readonly DecorationDiagnosticRange[]
  readonly rebuiltWidgetKeys: readonly string[]
  readonly preservedWidgetKeys: readonly string[]
}

let lastDecorationDiagnostic: DecorationDiagnostic = {
  visitedRanges: [], rebuiltWidgetKeys: [], preservedWidgetKeys: [],
}

export function getLastDecorationDiagnostic(): DecorationDiagnostic {
  return lastDecorationDiagnostic
}

function diagnosticHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

function widgetKey(state: EditorState, node: NodeInfo): string {
  return `${node.name}:${node.from}:${node.to}:${diagnosticHash(state.doc.sliceString(node.from, node.to))}:${getAppearanceVersion()}`
}

function normalizeDiagnosticRanges(ranges: readonly DecorationDiagnosticRange[]): readonly DecorationDiagnosticRange[] {
  const sorted = [...ranges].filter(range => range.from < range.to).sort((left, right) => left.from - right.from || left.to - right.to)
  const result: DecorationDiagnosticRange[] = []
  for (const range of sorted) {
    const previous = result.at(-1)
    if (previous && range.from <= previous.to) {
      result[result.length - 1] = { from: previous.from, to: Math.max(previous.to, range.to) }
    } else result.push({ ...range })
  }
  return result
}

export type IrPresentation = {
  readonly decorations: DecorationSet
  readonly atomicRanges: RangeSet<Decoration>
}


export const setEditorFocusedEffect = StateEffect.define<boolean>()

export const editorFocused = StateField.define<boolean>({
  create() { return false },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setEditorFocusedEffect)) return effect.value
    }
    return value
  },
})

export const irFocusHandler = EditorView.domEventHandlers({
  focus(_event, view) {
    view.dispatch({ effects: setEditorFocusedEffect.of(true) })
    return false
  },
  blur(_event, view) {
    view.dispatch({ effects: setEditorFocusedEffect.of(false) })
    return false
  },
})


export function buildIrPresentation(
  state: EditorState,
  lookup: (node: string) => RenderRule | undefined = ruleFor,
  impact?: DecorationDiagnosticRange,
): IrPresentation & { readonly diagnostic: DecorationDiagnostic } {
  const profile = currentProfile(state)
  if (profile.presentation === 'raw') {
    const decorations: Range<Decoration>[] = []
    const atomicRanges: Range<Decoration>[] = []
    const context: DeriveContext = {
      state,
      decorations,
      atomicRanges,
      focused: state.field(editorFocused),
      activeReveal: false,
    }
    syntaxTree(state).iterate({
      enter(nodeRef) {
        if (nodeRef.name === 'FencedCode') {
          pushBlockLines(context, nodeRef.from, nodeRef.to, 'cm-codeblock')
        }
      },
    })
    const diagnostic = { visitedRanges: [], rebuiltWidgetKeys: [], preservedWidgetKeys: lastDecorationDiagnostic.preservedWidgetKeys }
    lastDecorationDiagnostic = diagnostic
    return {
      decorations: Decoration.set(decorations, true),
      atomicRanges: RangeSet.of(atomicRanges, true),
      diagnostic,
    }
  }

  const decorations: Range<Decoration>[] = []
  const atomicRanges: Range<Decoration>[] = []
  const visitedRanges: DecorationDiagnosticRange[] = []
  const rebuiltWidgetKeys: string[] = []
  const tree = syntaxTree(state)
  const focused = state.field(editorFocused)
  const activeReveal = profile.presentation === 'render'

  if (activeReveal && focused) {
    const cursorLine = state.doc.lineAt(state.selection.main.head)
    decorations.push(
      Decoration.line({ class: 'cm-ir-active' }).range(cursorLine.from),
    )
  }

  const ctx: DeriveContext = {
    state,
    decorations,
    atomicRanges,
    focused,
    activeReveal,
  }

  tree.iterate({
    ...(impact ? { from: impact.from, to: impact.to } : {}),
    enter(nodeRef) {
      if (nodeRef.name !== 'Document') visitedRanges.push({ from: nodeRef.from, to: nodeRef.to })
      const rule = lookup(nodeRef.name)
      if (!rule) return
      const node = { name: nodeRef.name, from: nodeRef.from, to: nodeRef.to, node: nodeRef.node }
      if (profile.presentation === 'rich' || isRuleActive(ctx, node, rule)) {
        deriveRichNode(ctx, node)
        return
      }
      const data = nodeRenderData.get(nodeRef.name)
      if (!data) return
      if (rule.display === 'widget') rebuiltWidgetKeys.push(widgetKey(state, node))
      interpretDisplay(ctx, node, rule, data)
    },
  })

  const scopedVisited = visitedRanges.filter(range => !(range.from === 0 && range.to === state.doc.length))
  if (scopedVisited.length === 0 && impact) scopedVisited.push(impact)
  const visited = normalizeDiagnosticRanges(scopedVisited)
  const rebuilt = [...new Set(rebuiltWidgetKeys)].sort()
  const previous = new Set(lastDecorationDiagnostic.rebuiltWidgetKeys)
  const preserved = [...previous].filter(key => !rebuilt.includes(key)).sort()
  const diagnostic = { visitedRanges: visited, rebuiltWidgetKeys: rebuilt, preservedWidgetKeys: preserved }
  lastDecorationDiagnostic = diagnostic
  return {
    decorations: Decoration.set(decorations, true),
    atomicRanges: RangeSet.of(atomicRanges, true),
    diagnostic,
  }
}

function rangesOverlap(left: Range<Decoration>, right: Range<Decoration>): boolean {
  if (left.from === left.to) return left.from >= right.from && left.from <= right.to
  if (right.from === right.to) return right.from >= left.from && right.from <= left.to
  return left.from < right.to && right.from < left.to
}

function preserveUnaffectedRangeSet(
  value: RangeSet<Decoration>,
  changes: Parameters<DecorationSet['map']>[0],
  rebuilt: RangeSet<Decoration>,
): RangeSet<Decoration> {
  const mapped = value.map(changes)
  const rebuiltRanges: Range<Decoration>[] = []
  const rebuiltCursor = rebuilt.iter()
  while (rebuiltCursor.value) {
    rebuiltRanges.push(rebuiltCursor.value.range(rebuiltCursor.from, rebuiltCursor.to))
    rebuiltCursor.next()
  }
  const preserved: Range<Decoration>[] = []
  const mappedCursor = mapped.iter()
  while (mappedCursor.value) {
    const range = mappedCursor.value.range(mappedCursor.from, mappedCursor.to)
    if (!rebuiltRanges.some(rebuiltRange => rangesOverlap(range, rebuiltRange))) preserved.push(range)
    mappedCursor.next()
  }
  const next: Range<Decoration>[] = []
  const rebuiltAgain = rebuilt.iter()
  while (rebuiltAgain.value) {
    next.push(rebuiltAgain.value.range(rebuiltAgain.from, rebuiltAgain.to))
    rebuiltAgain.next()
  }
  next.push(...preserved)
  return RangeSet.of(next, true)
}

function preserveUnaffectedPresentation(
  value: IrPresentation,
  changes: Parameters<DecorationSet['map']>[0],
  rebuilt: IrPresentation,
): IrPresentation {
  return {
    decorations: preserveUnaffectedRangeSet(value.decorations, changes, rebuilt.decorations),
    atomicRanges: preserveUnaffectedRangeSet(value.atomicRanges, changes, rebuilt.atomicRanges),
  }
}

export const irDecorationField = StateField.define<IrPresentation>({
  create(state) {
    const built = buildIrPresentation(state)
    return { decorations: built.decorations, atomicRanges: built.atomicRanges }
  },

  update(value, tr) {
    if (tr.state.field(compositionActiveField, false) === true) {
      return {
        decorations: value.decorations.map(tr.changes),
        atomicRanges: value.atomicRanges.map(tr.changes),
      }
    }

    if (!tr.docChanged && tr.isUserEvent('select.pointer')) {
      return value
    }

    let impact: DecorationDiagnosticRange | undefined
    if (!tr.changes.empty) {
      let from = Number.MAX_SAFE_INTEGER
      let to = 0
      tr.changes.iterChangedRanges((fromA, toA) => {
        from = Math.min(from, fromA)
        to = Math.max(to, toA)
      })
      const start = tr.state.doc.lineAt(Math.max(0, Math.min(from, tr.state.doc.length)))
      const end = tr.state.doc.lineAt(Math.max(0, Math.min(to, tr.state.doc.length)))
      impact = { from: start.from, to: end.to }
    }
    const rebuilt = buildIrPresentation(tr.state, ruleFor, impact)
    const next = { decorations: rebuilt.decorations, atomicRanges: rebuilt.atomicRanges }
    return tr.changes.empty ? next : preserveUnaffectedPresentation(value, tr.changes, next)
  },

  provide(field) {
    return [
      EditorView.decorations.from(field, value => value.decorations),
      EditorView.atomicRanges.of(view => view.state.field(field).atomicRanges),
    ]
  },
})

/**
 * Forces a decoration rebuild on the next frame after mouseup. The
 * select.pointer skip above means clicking doesn't immediately reveal syntax.
 */
export const irMouseUpHandler = EditorView.domEventHandlers({
  mouseup(_event, view) {
    requestAnimationFrame(() => {
      view.dispatch({ effects: [] })
    })
    return false
  },
})

