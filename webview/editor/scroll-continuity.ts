import { Annotation, ChangeSet, Transaction, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { setCompleteMarkdownTreeEffect, setRenderingProfileEffect } from './rendering-profile'
import { setRevealTargetEffect } from './search-reveal'
import { currentProfile, setViewModeEffect } from './view-mode'

export type ScrollContinuityCause =
  | 'document-change'
  | 'presentation-rebuild'
  | 'widget-settlement'

export const suppressScrollContinuity = Annotation.define<boolean>()

type SourceAnchor = {
  readonly pos: number
  readonly viewportOffsetY: number
  readonly generation: number
}

type PendingContinuity = {
  readonly anchor: SourceAnchor
  readonly cause: ScrollContinuityCause
}

function captureSourceAnchor(view: EditorView, generation: number): SourceAnchor | null {
  const scroller = view.scrollDOM
  if (!scroller.isConnected) return null
  const scrollerRect = scroller.getBoundingClientRect()
  const position = view.posAtCoords({ x: scrollerRect.left + 1, y: scrollerRect.top + 1 }) ?? view.viewport.from
  const pos = view.state.doc.lineAt(position).from
  const rect = view.coordsAtPos(pos)
  if (!rect || !Number.isFinite(rect.top)) return null
  const viewportOffsetY = rect.top - scrollerRect.top
  return Number.isFinite(viewportOffsetY) ? { pos, viewportOffsetY, generation } : null
}

function mapAnchor(anchor: SourceAnchor, changes: ChangeSet, docLength: number): SourceAnchor {
  return { ...anchor, pos: Math.max(0, Math.min(changes.mapPos(anchor.pos, 1), docLength)) }
}

function anchorViewportOffset(view: EditorView, pos: number): number | null {
  if (!view.scrollDOM.isConnected) return null
  try {
    const rect = view.coordsAtPos(pos)
    if (!rect || !Number.isFinite(rect.top)) return null
    const offset = rect.top - view.scrollDOM.getBoundingClientRect().top
    return Number.isFinite(offset) ? offset : null
  } catch {
    return null
  }
}

function transactionRequestsReveal(transaction: Transaction): boolean {
  return transaction.effects.some(effect => effect.is(setRevealTargetEffect))
}

function transactionMayRebuildPresentation(transaction: Transaction): boolean {
  if (currentProfile(transaction.state).presentation === 'raw') return false
  return transaction.docChanged || transaction.effects.some(effect =>
    effect.is(setCompleteMarkdownTreeEffect)
    || effect.is(setViewModeEffect)
    || effect.is(setRenderingProfileEffect))
}

function clampScrollTop(scroller: HTMLElement, target: number): number {
  return Math.max(0, Math.min(target, Math.max(0, scroller.scrollHeight - scroller.clientHeight)))
}

class ScrollContinuityPlugin {
  private generation = 0
  private latestAnchor: SourceAnchor | null = null
  private pending: PendingContinuity | null = null
  private captureQueued = false
  private frame: number | null = null
  private observer: ResizeObserver | null = null
  private settlingGeneration: number | null = null
  private settlePasses = 0
  private readonly maxSettlePasses = 4
  private settleFrame: number | null = null

  constructor(private readonly view: EditorView) {
    this.observer = new ResizeObserver(() => this.settleWidgets())
    this.observer.observe(view.contentDOM)
    this.queueCapture()
    view.scrollDOM.addEventListener('scroll', this.queueCapture, { passive: true })
  }

  update(update: ViewUpdate): void {
    const cancelsContinuity = update.transactions.some(transaction =>
      transaction.annotation(suppressScrollContinuity) === true
      || transactionRequestsReveal(transaction)
      || (transaction.isUserEvent('select.pointer') && !transaction.docChanged))
    if (cancelsContinuity) {
      this.cancel()
      this.queueCapture()
      return
    }

    const rebuildsPresentation = update.transactions.some(transaction => transactionMayRebuildPresentation(transaction))
    if (rebuildsPresentation && this.latestAnchor) {
      const generation = ++this.generation
      const anchor = update.docChanged
        ? mapAnchor(this.latestAnchor, update.changes, update.state.doc.length)
        : { ...this.latestAnchor, generation }
      this.pending = {
        anchor: { ...anchor, generation },
        cause: update.docChanged ? 'document-change' : 'presentation-rebuild',
      }
      this.settlingGeneration = null
      this.settlePasses = 0
      this.cancelSettleFrame()
      this.schedule(generation)
    }
    this.queueCapture()
  }

  private readonly queueCapture = (): void => {
    if (this.captureQueued) return
    this.captureQueued = true
    this.view.requestMeasure({
      read: view => captureSourceAnchor(view, this.generation),
      write: anchor => {
        this.captureQueued = false
        if (anchor) this.latestAnchor = anchor
      },
    })
  }

  private settleWidgets(): void {
    const pending = this.pending
    if (!pending) return
    this.cancelSettleFrame()
    this.pending = { ...pending, cause: 'widget-settlement' }
    this.schedule(pending.anchor.generation)
  }

  private schedule(generation: number): void {
    if (this.frame !== null) return
    this.frame = requestAnimationFrame(() => {
      this.frame = null
      this.view.requestMeasure({
        read: view => {
          const pending = this.pending
          if (!this.isCurrent(view, pending, generation)) return null
          const offset = anchorViewportOffset(view, pending.anchor.pos)
          return offset === null ? null : { offset, generation }
        },
        write: (measurement, view) => {
          const pending = this.pending
          if (!measurement || !this.isCurrent(view, pending, generation)) {
            if (!measurement && pending?.anchor.generation === generation) this.clearPending()
            return
          }
          const deltaY = measurement.offset - pending.anchor.viewportOffsetY
          if (Math.abs(deltaY) > 0.5) {
            view.scrollDOM.scrollTop = clampScrollTop(view.scrollDOM, view.scrollDOM.scrollTop + deltaY)
          }
          this.settlingGeneration = generation
          this.settlePasses++
          if (this.settlePasses >= this.maxSettlePasses) {
            this.clearPending()
            return
          }
          this.settleFrame = requestAnimationFrame(() => {
            this.settleFrame = null
            if (this.settlingGeneration === generation && this.frame === null) this.clearPending()
          })
        },
      })
    })
  }

  private isCurrent(view: EditorView, pending: PendingContinuity | null, generation: number): pending is PendingContinuity {
    return view === this.view && view.dom.isConnected && pending !== null && pending.anchor.generation === generation
  }

  private cancelSettleFrame(): void {
    if (this.settleFrame === null) return
    cancelAnimationFrame(this.settleFrame)
    this.settleFrame = null
  }

  private clearPending(): void {
    this.pending = null
    this.settlingGeneration = null
    this.settlePasses = 0
    this.cancelSettleFrame()
  }

  private cancel(): void {
    this.clearPending()
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.frame = null
  }

  destroy(): void {
    this.cancel()
    this.view.scrollDOM.removeEventListener('scroll', this.queueCapture)
    this.observer?.disconnect()
    this.observer = null
  }
}

export const scrollContinuityExtension: Extension = ViewPlugin.fromClass(ScrollContinuityPlugin)
