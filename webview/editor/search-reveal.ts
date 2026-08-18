import { Facet, StateEffect, StateField, Transaction, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from '@codemirror/view'

export type RevealSource = 'external' | 'internal'
export interface RevealTarget { readonly from: number; readonly to: number; readonly source: RevealSource }

export const setRevealTargetEffect = StateEffect.define<RevealTarget | null>()

export const revealRangeFacet = Facet.define<RevealTarget | null, RevealTarget | null>({
  combine: values => values.length === 0 ? null : values[values.length - 1],
})

function clampTarget(target: RevealTarget, length: number): RevealTarget {
  const from = Math.max(0, Math.min(target.from, length))
  const to = Math.max(from, Math.min(target.to, length))
  return { ...target, from, to }
}

export const revealTargetField = StateField.define<RevealTarget | null>({
  create() { return null },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setRevealTargetEffect)) return effect.value === null ? null : clampTarget(effect.value, transaction.state.doc.length)
    }
    // A document edit invalidates offsets from a former document.  An effect in
    // the same transaction is intentionally handled above: replaceNext gives
    // its newly found match a fresh target.
    if (transaction.docChanged) return null
    return value
  },
  provide: field => [revealRangeFacet.from(field), EditorView.decorations.compute([field], state => targetDecorations(state.field(field), state.doc))],
})

/** 半開区間の改行は直前行に属する。空区間は開始行だけを返す。 */
export function targetLineStarts(doc: { readonly length: number; lineAt(position: number): { readonly from: number; readonly to: number; readonly number: number }; line(number: number): { readonly from: number; readonly to: number }; readonly lines: number }, from: number, to: number): readonly number[] {
  const start = Math.max(0, Math.min(from, doc.length))
  const end = Math.max(start, Math.min(to, doc.length))
  const first = doc.lineAt(start)
  if (start === end) return [first.from]
  // The interval is half-open.  `end - 1` therefore owns a trailing newline
  // and never admits the next line at its start.
  const last = doc.lineAt(Math.max(start, end - 1))
  const starts: number[] = []
  for (let number = first.number; number <= last.number; number++) starts.push(doc.line(number).from)
  return starts
}

export function targetDecorations(target: RevealTarget | null, doc: Parameters<typeof targetLineStarts>[0]): DecorationSet {
  if (!target) return Decoration.none
  const ranges = targetLineStarts(doc, target.from, target.to).map(from => Decoration.line({ class: 'cm-reveal-target-line' }).range(from))
  if (target.from < target.to) ranges.push(Decoration.mark({ class: 'cm-reveal-target-exact' }).range(target.from, target.to))
  ranges.sort((left, right) => left.from - right.from || left.to - right.to)
  return Decoration.set(ranges, true)
}

interface RevealGeometry {
  readonly top: number
  readonly bottom: number
  readonly lineHeight: number
}

/** Client-coordinate union for every decorated line, including tall widgets. */
function targetGeometry(view: EditorView, target: RevealTarget): RevealGeometry | null {
  const starts = targetLineStarts(view.state.doc, target.from, target.to)
  const rects = starts.map(start => view.coordsAtPos(start)).filter((rect): rect is DOMRect => rect !== null)
  if (rects.length === 0) return null
  const top = Math.min(...rects.map(rect => rect.top))
  const bottom = Math.max(...rects.map(rect => rect.bottom))
  return { top, bottom, lineHeight: Math.max(1, rects[0].bottom - rects[0].top) }
}

function safeBand(view: EditorView, lineHeight: number): { top: number; bottom: number } {
  const viewport = view.scrollDOM.getBoundingClientRect()
  const panels = [...view.dom.querySelectorAll<HTMLElement>('.cm-panel.cm-search')]
  const panelTop = panels.length === 0 ? viewport.bottom : Math.min(...panels.map(panel => panel.getBoundingClientRect().top))
  return {
    top: viewport.top + lineHeight,
    bottom: Math.min(viewport.bottom, panelTop) - lineHeight,
  }
}

/** 検索 panel と上下各一行を避け、対象が安全帯外にある時だけ scroll-only transaction を送る。 */
export const revealScrollPlugin = ViewPlugin.fromClass(class {
  private queued = false
  update(update: import('@codemirror/view').ViewUpdate): void {
    if (!update.docChanged && !update.transactions.some(transaction => transaction.effects.some(effect => effect.is(setRevealTargetEffect)))) return
    this.schedule(update.view)
  }
  private schedule(view: EditorView): void {
    if (this.queued) return
    this.queued = true
    view.requestMeasure({
      read: measured => {
        this.queued = false
        const target = measured.state.field(revealTargetField)
        if (!target) return null
        const geometry = targetGeometry(measured, target)
        if (!geometry) return null
        const band = safeBand(measured, geometry.lineHeight)
        if (geometry.top >= band.top && geometry.bottom <= band.bottom) return null
        // `coordsAtPos` returns client coordinates while scrollIntoView accepts a
        // document offset.  Keep those coordinate systems separate.
        const viewport = measured.scrollDOM.getBoundingClientRect()
        const panelTop = [...measured.dom.querySelectorAll<HTMLElement>('.cm-panel.cm-search')]
          .map(panel => panel.getBoundingClientRect().top)
          .reduce((top, current) => Math.min(top, current), viewport.bottom)
        const panelOverlapsScroller = panelTop < viewport.bottom
        const above = geometry.top < band.top
        return {
          position: above ? target.from : Math.max(target.from, target.to - 1),
          // A panel inside the scroller needs edge alignment. Without overlap,
          // preserve centered CodeMirror scrolling used by the native webview.
          y: panelOverlapsScroller ? (above ? 'start' as const : 'end' as const) : 'center' as const,
          yMargin: panelOverlapsScroller
            ? (above ? band.top - viewport.top : viewport.bottom - band.bottom)
            : 0,
        }
      },
      write: (request, measured) => {
        if (!request) return
        const documentLength = measured.state.doc.length
        // 次 frame まで文書と view の同一性を照合し、破棄済みや別内容への書き込みを避ける。
        requestAnimationFrame(() => {
          if (!measured.dom.isConnected || measured.state.doc.length !== documentLength) return
          measured.dispatch({
            effects: EditorView.scrollIntoView(request.position, { y: request.y, yMargin: request.yMargin }),
            annotations: Transaction.addToHistory.of(false),
          })
        })
      },
    })
  }
})

export const searchRevealExtension: Extension = [revealTargetField, revealScrollPlugin]

export function revealTarget(view: EditorView, from: number, to: number, source: RevealSource): void {
  view.dispatch({ effects: setRevealTargetEffect.of({ from, to, source }), annotations: Transaction.addToHistory.of(false) })
}
