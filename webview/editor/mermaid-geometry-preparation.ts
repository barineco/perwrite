import type { EditorState } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { getAppearanceMetrics, getAppearanceVersion } from '../appearance'
import { getFontResourceGeneration } from '../font-resource'
import {
  buildGeometryCacheKey,
  getMermaidGeometryTheme,
  lookupMermaidGeometry,
  mermaidInlineContentWidth,
  putMermaidGeometry,
  readEditorContentWidth,
  type MermaidBlockChrome,
  type RenderIdentity,
} from '../mermaid-geometry-cache'
import { MermaidWidget, type MermaidConfiguration } from '../nodes/mermaid-node'
import {
  createMermaidPreparationTarget,
  prepareMermaidDiagram,
} from '../renderers/mermaid-preparation'
import { renderMermaid } from '../renderers/mermaid-renderer'
import { decorationOptionsOf } from './decoration-options'
import { imageDocumentGeneration } from './image-widget'
import { irDecorationField } from './ir-state-field'

export type MermaidDocumentEntry = {
  readonly source: string
  readonly layout: MermaidConfiguration['mermaidLayout']
  readonly maxEdges: number
}

function entryIdentity(entry: MermaidDocumentEntry): string {
  return `${entry.layout}\0${entry.maxEdges}\0${entry.source}`
}

function mermaidSourceFingerprint(entries: readonly MermaidDocumentEntry[]): string {
  return entries.map(entryIdentity).join('\n')
}

export function collectMermaidDocumentEntries(state: EditorState): readonly MermaidDocumentEntry[] {
  const decorations = state.field(irDecorationField, false)?.decorations
  if (!decorations) return []
  const entries: MermaidDocumentEntry[] = []
  const seen = new Set<string>()
  decorations.between(0, state.doc.length, (_from, _to, decoration) => {
    const widget = decorationOptionsOf(decoration).widget
    if (!(widget instanceof MermaidWidget)) return
    if (!widget.source.trim()) return
    const entry: MermaidDocumentEntry = {
      source: widget.source,
      layout: widget.configuration.mermaidLayout,
      maxEdges: widget.configuration.mermaidMaxEdges,
    }
    const id = entryIdentity(entry)
    if (seen.has(id)) return
    seen.add(id)
    entries.push(entry)
  })
  return entries
}

let prepareGeneration = 0
let prepareFrame: number | null = null

export function schedulePrepareMermaidGeometries(view: EditorView): void {
  prepareGeneration += 1
  if (prepareFrame !== null) return
  prepareFrame = requestAnimationFrame(() => {
    prepareFrame = null
    void runPrepareMermaidGeometries(view, prepareGeneration)
  })
}

async function runPrepareMermaidGeometries(view: EditorView, generation: number): Promise<void> {
  if (generation !== prepareGeneration) return

  const availableWidth = readEditorContentWidth(view)
  const appearanceVersion = getAppearanceVersion()
  const fontResourceGeneration = getFontResourceGeneration()
  const theme = getMermaidGeometryTheme()
  const documentGeneration = view.state.field(imageDocumentGeneration, false) ?? 0
  const entries = collectMermaidDocumentEntries(view.state)
  const metrics = getAppearanceMetrics()
  const chrome: MermaidBlockChrome = {
    paddingPx: metrics.mermaidBlockPaddingPx,
    borderPx: metrics.mermaidBlockBorderPx,
  }
  const widthCssPx = (availableWidth === null ? null : mermaidInlineContentWidth(availableWidth, chrome)) ?? 1

  for (const entry of entries) {
    if (generation !== prepareGeneration) return

    const renderIdentity: RenderIdentity = {
      theme,
      layout: entry.layout,
      maxEdges: entry.maxEdges,
      source: entry.source,
    }
    const cacheKey = buildGeometryCacheKey(renderIdentity, appearanceVersion, fontResourceGeneration)
    if (lookupMermaidGeometry(cacheKey).kind === 'Hit') continue

    const target = createMermaidPreparationTarget(widthCssPx)
    try {
      const rendered = await renderMermaid({
        source: entry.source,
        layout: entry.layout,
        maxEdges: entry.maxEdges,
        theme,
      }, target)
      if (generation !== prepareGeneration) return
      if (!rendered.ok) continue

      const prepared = await prepareMermaidDiagram(rendered.value, target, {
        documentGeneration,
        appearanceVersion,
        fontResourceGeneration,
      })
      if (generation !== prepareGeneration) return
      if (!prepared.ok) continue

      const bounds = prepared.value.geometry.contentBounds
      putMermaidGeometry(cacheKey, { width: bounds.width, height: bounds.height })
    } finally {
      target.dispose()
    }
  }

  if (generation === prepareGeneration) {
    view.requestMeasure()
  }
}

export const mermaidGeometryPreparationExtension = ViewPlugin.fromClass(class {
  private fingerprint: string
  private appearanceVersion: number
  private fontResourceGeneration: number
  private theme: ReturnType<typeof getMermaidGeometryTheme>
  private hadPositiveWidth: boolean

  constructor(private readonly view: EditorView) {
    this.fingerprint = mermaidSourceFingerprint(collectMermaidDocumentEntries(view.state))
    this.appearanceVersion = getAppearanceVersion()
    this.fontResourceGeneration = getFontResourceGeneration()
    this.theme = getMermaidGeometryTheme()
    this.hadPositiveWidth = readEditorContentWidth(view) !== null
    schedulePrepareMermaidGeometries(view)
  }

  update(update: ViewUpdate): void {
    const width = readEditorContentWidth(update.view)
    const becamePositive = width !== null && !this.hadPositiveWidth
    if (width !== null) this.hadPositiveWidth = true

    const fingerprint = mermaidSourceFingerprint(collectMermaidDocumentEntries(update.state))
    const appearanceVersion = getAppearanceVersion()
    const fontResourceGeneration = getFontResourceGeneration()
    const theme = getMermaidGeometryTheme()

    const sourcesChanged = update.docChanged || fingerprint !== this.fingerprint
    const appearanceChanged =
      appearanceVersion !== this.appearanceVersion
      || fontResourceGeneration !== this.fontResourceGeneration
      || theme !== this.theme

    this.fingerprint = fingerprint
    this.appearanceVersion = appearanceVersion
    this.fontResourceGeneration = fontResourceGeneration
    this.theme = theme

    if (sourcesChanged || appearanceChanged || (update.geometryChanged && becamePositive)) {
      schedulePrepareMermaidGeometries(update.view)
      return
    }

    if (update.geometryChanged && width !== null) {
      update.view.requestMeasure()
    }
  }

  destroy(): void {
    prepareGeneration += 1
    if (prepareFrame !== null) {
      cancelAnimationFrame(prepareFrame)
      prepareFrame = null
    }
  }
})
