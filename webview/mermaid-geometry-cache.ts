import type { EditorView } from '@codemirror/view'

export type MermaidTheme = 'default' | 'dark'

export type RenderIdentity = {
  readonly theme: MermaidTheme
  readonly layout: string
  readonly maxEdges: number
  readonly source: string
}

export type GeometryCacheKey = {
  readonly renderIdentity: RenderIdentity
  readonly appearanceVersion: number
  readonly fontResourceGeneration: number
}

export type ContentBounds = {
  readonly width: number
  readonly height: number
}

export type MermaidGeometryLookup =
  | { readonly kind: 'Hit'; readonly contentBounds: ContentBounds }
  | { readonly kind: 'Miss' }

export type PrepareFailure = 'RenderFailure' | 'FontFailure' | 'GeometryFailure'

/** Declared `.cm-mermaid-block` chrome; same coordinates as appearance fixed sources. */
export type MermaidBlockChrome = {
  readonly paddingPx: number
  readonly borderPx: number
}

export type MermaidEstimatedHeightRequest = {
  readonly cacheKey: GeometryCacheKey
  readonly lineCount: number
  readonly lineHeightPx: number
  /** Width available to the inline SVG (`.cm-mermaid-block` content box), or null when unobserved. */
  readonly availableWidth: number | null
}

const mermaidGeometryCache = new Map<string, ContentBounds>()

let mermaidGeometryTheme: MermaidTheme = 'default'
let rememberedEditorContentWidthPx: number | null = null

function isPositiveCssPx(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

export function buildGeometryCacheKey(
  renderIdentity: RenderIdentity,
  appearanceVersion: number,
  fontResourceGeneration: number,
): GeometryCacheKey {
  return { renderIdentity, appearanceVersion, fontResourceGeneration }
}

export function serializeGeometryCacheKey(key: GeometryCacheKey): string {
  const { theme, layout, maxEdges, source } = key.renderIdentity
  return `${theme}\0${layout}\0${maxEdges}\0${source}\0${key.appearanceVersion}\0${key.fontResourceGeneration}`
}

export function lookupMermaidGeometry(key: GeometryCacheKey): MermaidGeometryLookup {
  const value = mermaidGeometryCache.get(serializeGeometryCacheKey(key))
  return value === undefined ? { kind: 'Miss' } : { kind: 'Hit', contentBounds: value }
}

export function putMermaidGeometry(key: GeometryCacheKey, contentBounds: ContentBounds): void {
  if (!isPositiveCssPx(contentBounds.width) || !isPositiveCssPx(contentBounds.height)) return
  mermaidGeometryCache.set(serializeGeometryCacheKey(key), contentBounds)
}

export function clearMermaidGeometryCache(): void {
  mermaidGeometryCache.clear()
}

export function computeGeometryInlineHeight(
  contentBounds: ContentBounds,
  availableWidthPx: number,
): number {
  return contentBounds.height * Math.min(1, availableWidthPx / contentBounds.width)
}

export function computeLineCountFallback(lineCount: number, lineHeightPx: number): number {
  return lineCount * lineHeightPx
}

/** One axis of block chrome: padding and border on both sides. */
export function mermaidBlockAxisChromePx(chrome: MermaidBlockChrome): number {
  return 2 * (chrome.paddingPx + chrome.borderPx)
}

/** Editor content width → width available to the inline SVG inside `.cm-mermaid-block`. */
export function mermaidInlineContentWidth(
  editorContentWidthPx: number,
  chrome: MermaidBlockChrome,
): number | null {
  if (!isPositiveCssPx(editorContentWidthPx)) return null
  const contentWidth = editorContentWidthPx - mermaidBlockAxisChromePx(chrome)
  return isPositiveCssPx(contentWidth) ? contentWidth : null
}

/** Diagram (SVG) height → widget root height including `.cm-mermaid-block` chrome. */
export function mermaidWidgetHeightFromDiagramHeight(
  diagramHeightPx: number,
  chrome: MermaidBlockChrome,
): number {
  return diagramHeightPx + mermaidBlockAxisChromePx(chrome)
}

export function evaluateMermaidEstimatedHeight(request: MermaidEstimatedHeightRequest): number {
  const availableWidth = request.availableWidth
  if (availableWidth === null || !isPositiveCssPx(availableWidth)) {
    return computeLineCountFallback(request.lineCount, request.lineHeightPx)
  }
  const lookup = lookupMermaidGeometry(request.cacheKey)
  if (lookup.kind === 'Miss') {
    return computeLineCountFallback(request.lineCount, request.lineHeightPx)
  }
  return computeGeometryInlineHeight(lookup.contentBounds, availableWidth)
}

export function readEditorContentWidth(view: EditorView): number | null {
  const width = view.contentDOM.clientWidth
  if (!isPositiveCssPx(width)) return null
  rememberEditorContentWidth(width)
  return width
}

export function rememberEditorContentWidth(widthPx: number): void {
  if (!isPositiveCssPx(widthPx)) return
  rememberedEditorContentWidthPx = widthPx
}

export function getRememberedEditorContentWidth(): number | null {
  return rememberedEditorContentWidthPx
}

export function setMermaidGeometryTheme(theme: MermaidTheme): void {
  mermaidGeometryTheme = theme
}

export function getMermaidGeometryTheme(): MermaidTheme {
  return mermaidGeometryTheme
}
