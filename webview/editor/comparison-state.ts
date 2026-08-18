import { Facet, StateEffect, StateField, type ChangeSet, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import type { RenderingProfile, ResolvedGitComparison, ViewMode } from '../../src/protocol'
import { createEditor, reconfigureEditorEditable, setEditorContent } from './setup'
import { buildDiffChunks, type DiffChunk } from './comparison-diff'
import { setViewModeEffect, viewModeField } from './view-mode'
import { reconfigureRendering } from './rendering-profile'
import { revealTarget, type RevealSource } from './search-reveal'

export type ComparisonSide = 'original' | 'modified'

const comparisonSide = Facet.define<ComparisonSide, ComparisonSide>({
  combine: values => values[values.length - 1],
})

const setChunksEffect = StateEffect.define<readonly DiffChunk[]>()

function changedLineRanges(state: Parameters<Parameters<typeof StateField.define<DecorationSet>>[0]['create']>[0]): Range<Decoration>[] {
  const side = state.facet(comparisonSide)
  const chunks = state.field(comparisonChunksField, false) ?? []
  const ranges: Range<Decoration>[] = []
  for (const chunk of chunks) {
    const from = side === 'original' ? chunk.originalFrom : chunk.modifiedFrom
    const to = side === 'original' ? chunk.originalTo : chunk.modifiedTo
    if (from === to) continue
    const otherFrom = side === 'original' ? chunk.modifiedFrom : chunk.originalFrom
    const otherTo = side === 'original' ? chunk.modifiedTo : chunk.originalTo
    const kind = otherFrom === otherTo
      ? side === 'original' ? 'deleted' : 'added'
      : 'changed'
    let line = state.doc.lineAt(Math.min(from, state.doc.length))
    const end = Math.min(to, state.doc.length)
    while (true) {
      ranges.push(Decoration.line({ class: `cm-comparison-${kind}` }).range(line.from))
      if (line.to >= end || line.number === state.doc.lines) break
      line = state.doc.line(line.number + 1)
    }
  }
  return ranges
}

const comparisonChunksField = StateField.define<readonly DiffChunk[]>({
  create() { return [] },
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setChunksEffect)) return effect.value
    return value
  },
  provide: field => EditorView.decorations.compute([field, comparisonSide], state =>
    Decoration.set(changedLineRanges(state), true)),
})

export function comparisonDecorations(side: ComparisonSide): Extension {
  return [comparisonSide.of(side), comparisonChunksField]
}

export interface ScrollAnchor {
  readonly source: number
  readonly target: number
}

export function scrollAnchors(
  chunks: readonly DiffChunk[],
  originalLength: number,
  modifiedLength: number,
  sourceSide: ComparisonSide,
): readonly ScrollAnchor[] {
  const pairs: ScrollAnchor[] = [{ source: 0, target: 0 }]
  for (const chunk of chunks) {
    if (sourceSide === 'original') {
      pairs.push(
        { source: chunk.originalFrom, target: chunk.modifiedFrom },
        { source: chunk.originalTo, target: chunk.modifiedTo },
      )
    } else {
      pairs.push(
        { source: chunk.modifiedFrom, target: chunk.originalFrom },
        { source: chunk.modifiedTo, target: chunk.originalTo },
      )
    }
  }
  pairs.push(sourceSide === 'original'
    ? { source: originalLength, target: modifiedLength }
    : { source: modifiedLength, target: originalLength })
  pairs.sort((left, right) => left.source - right.source || left.target - right.target)

  const normalized: ScrollAnchor[] = []
  for (let index = 0; index < pairs.length;) {
    const source = pairs[index].source
    let targetTotal = 0
    let count = 0
    while (index < pairs.length && pairs[index].source === source) {
      targetTotal += pairs[index].target
      count++
      index++
    }
    const target = targetTotal / count
    const previous = normalized[normalized.length - 1]
    normalized.push({ source, target: previous ? Math.max(previous.target, target) : target })
  }
  return normalized
}

export function interpolateAnchors(anchors: readonly ScrollAnchor[], source: number): number {
  if (anchors.length === 0) return source
  if (source <= anchors[0].source) return anchors[0].target
  for (let index = 1; index < anchors.length; index++) {
    const after = anchors[index]
    if (source > after.source) continue
    const before = anchors[index - 1]
    if (after.source === before.source) return after.target
    const ratio = (source - before.source) / (after.source - before.source)
    return before.target + ratio * (after.target - before.target)
  }
  return anchors[anchors.length - 1].target
}

function documentY(view: EditorView, position: number): number {
  const safePosition = Math.max(0, Math.min(position, view.state.doc.length))
  const block = view.lineBlockAt(safePosition)
  if (safePosition === view.state.doc.length) return block.bottom
  return block.top
}

function domScrollTarget(
  source: EditorView,
  target: EditorView,
  anchors: readonly ScrollAnchor[],
): number {
  const domAnchors = anchors.map(anchor => ({
    source: documentY(source, anchor.source),
    target: documentY(target, anchor.target),
  }))
  return interpolateAnchors(domAnchors, source.scrollDOM.scrollTop)
}

export interface ComparisonCallbacks {
  onEdit(side: ComparisonSide, documentId: string, changes: ChangeSet, view: EditorView, beforeContent: string, afterContent: string): void
  onConfigurationFailure?(reason: string): void
}

export class ComparisonEditorState {
  readonly original: EditorView
  readonly modified: EditorView
  private comparison: ResolvedGitComparison
  private chunks: readonly DiffChunk[] = []
  private applyingScrollTo: ComparisonSide | null = null
  private revealScroll: { readonly side: ComparisonSide; readonly generation: number; readonly phase: 'reveal-pending' | 'reveal-settling' } | null = null
  private revealGeneration = 0
  private applyingContent = false
  private synchronizationApplications = 0
  private readonly originalScroll: () => void
  private readonly modifiedScroll: () => void

  constructor(
    root: HTMLElement,
    comparison: ResolvedGitComparison,
    mode: ViewMode,
    rendering: RenderingProfile,
    callbacks: ComparisonCallbacks,
  ) {
    this.comparison = comparison
    root.className = 'comparison-editor'
    const originalRoot = document.createElement('section')
    const modifiedRoot = document.createElement('section')
    originalRoot.className = 'comparison-side comparison-original'
    modifiedRoot.className = 'comparison-side comparison-modified'
    originalRoot.innerHTML = '<header class="comparison-label"></header><div class="comparison-view"></div>'
    modifiedRoot.innerHTML = '<header class="comparison-label"></header><div class="comparison-view"></div>'
    root.replaceChildren(originalRoot, modifiedRoot)

    const make = (side: ComparisonSide, parent: HTMLElement): EditorView => {
      const target = comparison[side]
      return createEditor(parent, target.snapshot.content, {
        onConfigurationFailure: callbacks.onConfigurationFailure,
        onDocUpdate: content => {
          if (this.applyingContent) return
          this.recomputeChunks()
        },
        onChanges: (changes, view, beforeContent, afterContent) => {
          if (this.applyingContent || this.comparison.editableSide !== side) return
          callbacks.onEdit(side, this.comparison[side].documentId, changes, view, beforeContent, afterContent)
        },
      }, mode, rendering, {
        editable: comparison.editableSide === side,
        extensions: comparisonDecorations(side),
      })
    }
    this.original = make('original', originalRoot.querySelector('.comparison-view')!)
    this.modified = make('modified', modifiedRoot.querySelector('.comparison-view')!)
    this.originalScroll = () => this.synchronizeScroll('original')
    this.modifiedScroll = () => this.synchronizeScroll('modified')
    this.original.scrollDOM.addEventListener('scroll', this.originalScroll)
    this.modified.scrollDOM.addEventListener('scroll', this.modifiedScroll)
    this.updateLabels(root)
    this.recomputeChunks()
  }

  private updateLabels(root: HTMLElement): void {
    const labels = root.querySelectorAll<HTMLElement>('.comparison-label')
    labels[0].textContent = this.comparison.original.label
    labels[1].textContent = this.comparison.modified.label
  }

  private recomputeChunks(): void {
    this.chunks = buildDiffChunks(
      this.original.state.doc.toString(),
      this.modified.state.doc.toString(),
    )
    this.original.dispatch({ effects: setChunksEffect.of(this.chunks) })
    this.modified.dispatch({ effects: setChunksEffect.of(this.chunks) })
  }

  private synchronizeScroll(sourceSide: ComparisonSide): void {
    // A reveal scroll belongs only to its target side.  Do not mirror it into
    // the other editor while the measure/write scroll settles.
    if (this.revealScroll?.side === sourceSide) return
    if (this.applyingScrollTo === sourceSide) {
      this.applyingScrollTo = null
      return
    }
    const source = sourceSide === 'original' ? this.original : this.modified
    const target = sourceSide === 'original' ? this.modified : this.original
    const targetSide = sourceSide === 'original' ? 'modified' : 'original'
    this.synchronizationApplications++
    const anchors = scrollAnchors(
      this.chunks,
      this.original.state.doc.length,
      this.modified.state.doc.length,
      sourceSide,
    )
    this.applyingScrollTo = targetSide
    target.scrollDOM.scrollTop = domScrollTarget(source, target, anchors)
    requestAnimationFrame(() => {
      if (this.applyingScrollTo === targetSide) this.applyingScrollTo = null
    })
  }

  mode(): ViewMode {
    return this.original.state.field(viewModeField)
  }

  synchronizationCount(): number {
    return this.synchronizationApplications
  }

  hasIdentity(identity: string): boolean {
    return this.comparison.identity === identity
  }

  documentIdForSide(side: ComparisonSide): string {
    return this.comparison[side].documentId
  }

  viewForDocumentId(documentId: string): EditorView | null {
    if (this.comparison.original.documentId === documentId) return this.original
    if (this.comparison.modified.documentId === documentId) return this.modified
    return null
  }

  reveal(documentId: string, from: number, to: number, source: RevealSource): boolean {
    const side: ComparisonSide | null = this.comparison.original.documentId === documentId ? 'original'
      : this.comparison.modified.documentId === documentId ? 'modified' : null
    if (!side) return false
    const generation = ++this.revealGeneration
    this.revealScroll = { side, generation, phase: 'reveal-pending' }
    revealTarget(side === 'original' ? this.original : this.modified, from, to, source)
    requestAnimationFrame(() => {
      if (this.revealScroll?.generation !== generation) return
      this.revealScroll = { side, generation, phase: 'reveal-settling' }
      // The reveal plugin dispatches its measured scroll on a frame after the
      // target effect. Keep settling through that write before restoring normal
      // cross-side synchronization.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (this.revealScroll?.generation === generation) this.revealScroll = null
      }))
    })
    return true
  }

  setMode(mode: ViewMode): void {
    this.original.dispatch({ effects: setViewModeEffect.of(mode) })
    this.modified.dispatch({ effects: setViewModeEffect.of(mode) })
  }

  reconfigureRendering(rendering: RenderingProfile): void {
    const scrollPositions = [this.original.scrollDOM.scrollTop, this.modified.scrollDOM.scrollTop] as const
    this.original.dispatch({ effects: reconfigureRendering(rendering) })
    this.modified.dispatch({ effects: reconfigureRendering(rendering) })
    const restoreScroll = (): void => {
      this.original.scrollDOM.scrollTop = scrollPositions[0]
      this.modified.scrollDOM.scrollTop = scrollPositions[1]
    }
    restoreScroll()
    requestAnimationFrame(restoreScroll)
  }

  update(root: HTMLElement, comparison: ResolvedGitComparison): void {
    this.comparison = comparison
    this.applyingContent = true
    setEditorContent(this.original, comparison.original.snapshot.content)
    setEditorContent(this.modified, comparison.modified.snapshot.content)
    this.original.dispatch({ effects: reconfigureEditorEditable(comparison.editableSide === 'original') })
    this.modified.dispatch({ effects: reconfigureEditorEditable(comparison.editableSide === 'modified') })
    this.applyingContent = false
    this.updateLabels(root)
    this.recomputeChunks()
  }

  updateContent(side: ComparisonSide, content: string): void {
    this.applyingContent = true
    setEditorContent(side === 'original' ? this.original : this.modified, content)
    this.applyingContent = false
    this.recomputeChunks()
  }

  invalidateAppearance(): void {
    this.original.dispatch({})
    this.modified.dispatch({})
  }

  destroy(): void {
    this.original.scrollDOM.removeEventListener('scroll', this.originalScroll)
    this.modified.scrollDOM.removeEventListener('scroll', this.modifiedScroll)
    this.original.destroy()
    this.modified.destroy()
  }
}
