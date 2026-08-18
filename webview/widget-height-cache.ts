export type BlockWidgetKind = 'Mermaid' | 'KaTeX' | 'CodeBlock' | 'Table'

export type WidgetStructure =
  | { kind: 'Mermaid'; lineCount: number }
  | { kind: 'KaTeX'; lineCount: number; hasTallOperator: boolean; hasMatrixLike: boolean }
  | { kind: 'CodeBlock'; lineCount: number }
  | { kind: 'Table'; rowCount: number }

export type WidthBucketPolicy =
  | { kind: 'WidthDependent'; bucket: number }
  | { kind: 'WidthIndependent' }

export type CacheKey = {
  contentIdentity: { widgetKind: BlockWidgetKind; contentDigest: string }
  appearanceVersion: number
  widthBucket: WidthBucketPolicy
}

export type MeasuredHeightLookup = { kind: 'Hit'; value: number } | { kind: 'Miss' }

export type RecordFailure = 'NonPositiveMeasuredHeight' | 'DisconnectedWidgetTarget'

export type AppearanceState = {
  appearanceVersion: number
  lineHeightPx: number
  tableRowHeightPx: number
  tableWidgetBlockPaddingPx: number
}

export type StaticEstimationInput = {
  structure: WidgetStructure
  appearance: AppearanceState
}

export type EstimatedHeightRequest = {
  cacheKey: CacheKey
  staticInput: StaticEstimationInput
}

export type MeasurementObservation = {
  cacheKey: CacheKey
  measuredHeightPx: number
  connected?: boolean
}

export type RecordAck = { cacheKey: CacheKey }

export type RecordResult =
  | { ok: true; value: RecordAck }
  | { ok: false; error: RecordFailure }

export type AppearanceVersionTransition = {
  previousVersion: number
  currentVersion: number
}

export type InvalidationResult = { evictedEntryCount: number }

const WIDTH_BUCKET_QUANTUM_PX = 64

const measuredHeightCache = new Map<string, number>()

function serializeCacheKey(key: CacheKey): string {
  const width =
    key.widthBucket.kind === 'WidthDependent'
      ? `d:${key.widthBucket.bucket}`
      : 'i'
  return `${key.contentIdentity.widgetKind}\0${key.contentIdentity.contentDigest}\0${key.appearanceVersion}\0${width}`
}

export function contentDigestMermaid(
  source: string,
  configuration: {
    mermaidLayout: string
    mermaidMaxEdges: number
    mermaidPanStep: number
    mermaidZoomStep: number
  },
): string {
  return [
    'mermaid',
    configuration.mermaidLayout,
    String(configuration.mermaidMaxEdges),
    String(configuration.mermaidPanStep),
    String(configuration.mermaidZoomStep),
    source,
  ].join('\0')
}

export function contentDigestKaTeX(source: string): string {
  return `katex\0${source}`
}

export function contentDigestCodeBlock(code: string, lang: string): string {
  return `codeblock\0${lang}\0${code}`
}

export function contentDigestTable(tableData: unknown): string {
  return `table\0${JSON.stringify(tableData)}`
}

export function buildWidgetStructure(
  input:
    | { kind: 'Mermaid'; source: string }
    | { kind: 'KaTeX'; source: string }
    | { kind: 'CodeBlock'; code: string }
    | { kind: 'Table'; rowCount: number },
): WidgetStructure {
  if (input.kind === 'Mermaid') {
    return { kind: 'Mermaid', lineCount: input.source.split('\n').length }
  }
  if (input.kind === 'KaTeX') {
    return {
      kind: 'KaTeX',
      lineCount: input.source.split('\n').length,
      hasTallOperator: /\\(?:frac|dfrac|sum|int|prod|binom|left)/.test(input.source),
      hasMatrixLike: /\\(?:matrix|cases|aligned)|\\\\/.test(input.source),
    }
  }
  if (input.kind === 'CodeBlock') {
    return { kind: 'CodeBlock', lineCount: input.code.split('\n').length }
  }
  return { kind: 'Table', rowCount: input.rowCount }
}

export function widthBucketPolicyFor(
  kind: BlockWidgetKind,
  availableWidthPx?: number,
): WidthBucketPolicy {
  if (kind === 'Mermaid' || kind === 'CodeBlock') {
    const width = Math.max(0, availableWidthPx ?? 0)
    return { kind: 'WidthDependent', bucket: Math.floor(width / WIDTH_BUCKET_QUANTUM_PX) }
  }
  return { kind: 'WidthIndependent' }
}

export function computeStaticEstimate(input: StaticEstimationInput): number {
  const { structure, appearance } = input
  const lh = appearance.lineHeightPx
  if (structure.kind === 'Mermaid') {
    return structure.lineCount * lh
  }
  if (structure.kind === 'KaTeX') {
    const tall = structure.hasTallOperator || structure.hasMatrixLike
    return Math.max(3 * lh, structure.lineCount * (tall ? Math.round(lh * 1.5) : lh))
  }
  if (structure.kind === 'CodeBlock') {
    return (structure.lineCount + 2) * lh
  }
  return structure.rowCount * appearance.tableRowHeightPx + 2 * appearance.tableWidgetBlockPaddingPx
}

export function lookupMeasuredHeight(cacheKey: CacheKey): MeasuredHeightLookup {
  const value = measuredHeightCache.get(serializeCacheKey(cacheKey))
  return value === undefined ? { kind: 'Miss' } : { kind: 'Hit', value }
}

export function recordMeasuredHeight(observation: MeasurementObservation): RecordResult {
  if (observation.connected === false) {
    return { ok: false, error: 'DisconnectedWidgetTarget' }
  }
  if (!(observation.measuredHeightPx > 0)) {
    return { ok: false, error: 'NonPositiveMeasuredHeight' }
  }
  measuredHeightCache.set(serializeCacheKey(observation.cacheKey), observation.measuredHeightPx)
  return { ok: true, value: { cacheKey: observation.cacheKey } }
}

export function invalidateMeasuredHeightCacheOnAppearanceChange(
  transition: AppearanceVersionTransition,
): InvalidationResult {
  if (transition.previousVersion === transition.currentVersion) {
    return { evictedEntryCount: 0 }
  }
  const evictedEntryCount = measuredHeightCache.size
  measuredHeightCache.clear()
  return { evictedEntryCount }
}

export function evaluateEstimatedHeight(request: EstimatedHeightRequest): number {
  const lookup = lookupMeasuredHeight(request.cacheKey)
  if (lookup.kind === 'Hit') return lookup.value
  return computeStaticEstimate(request.staticInput)
}

export function attachMeasuredHeightObserver(
  dom: HTMLElement,
  cacheKeyFactory: () => CacheKey,
): ResizeObserver {
  const noopObserver: ResizeObserver = {
    observe() {},
    unobserve() {},
    disconnect() {},
  }
  if (typeof ResizeObserver === 'undefined') return noopObserver
  if (typeof dom.getBoundingClientRect !== 'function') return noopObserver

  const observer = new ResizeObserver(() => {
    if (!dom.isConnected) return
    const measuredHeightPx = dom.getBoundingClientRect().height
    if (!(measuredHeightPx > 0)) return
    recordMeasuredHeight({ cacheKey: cacheKeyFactory(), measuredHeightPx })
  })
  try {
    observer.observe(dom)
  } catch {
    return noopObserver
  }
  return observer
}
