import { afterEach, describe, expect, it } from 'vitest'
import {
  buildWidgetStructure,
  computeStaticEstimate,
  evaluateEstimatedHeight,
  invalidateMeasuredHeightCacheOnAppearanceChange,
  lookupMeasuredHeight,
  recordMeasuredHeight,
  widthBucketPolicyFor,
  type AppearanceState,
  type CacheKey,
  type EstimatedHeightRequest,
} from '../webview/widget-height-cache'

const appearance = (version = 1): AppearanceState => ({
  appearanceVersion: version,
  lineHeightPx: 28,
  tableRowHeightPx: 40,
  tableWidgetBlockPaddingPx: 8,
})

function mermaidKey(digest: string, version: number, widthPx: number): CacheKey {
  return {
    contentIdentity: { widgetKind: 'Mermaid', contentDigest: digest },
    appearanceVersion: version,
    widthBucket: widthBucketPolicyFor('Mermaid', widthPx),
  }
}

function katexKey(digest: string, version: number): CacheKey {
  return {
    contentIdentity: { widgetKind: 'KaTeX', contentDigest: digest },
    appearanceVersion: version,
    widthBucket: widthBucketPolicyFor('KaTeX'),
  }
}

function requestFor(cacheKey: CacheKey, structure: EstimatedHeightRequest['staticInput']['structure']): EstimatedHeightRequest {
  return {
    cacheKey,
    staticInput: { structure, appearance: appearance(cacheKey.appearanceVersion) },
  }
}

afterEach(() => {
  invalidateMeasuredHeightCacheOnAppearanceChange({ previousVersion: 0, currentVersion: Number.MAX_SAFE_INTEGER })
})

describe('widget-height-cache', () => {
  it('roundtrips measured height through record and evaluate', () => {
    const cacheKey = mermaidKey('roundtrip-source', 1, 128)
    const structure = buildWidgetStructure({ kind: 'Mermaid', source: 'a\nb\nc' })
    const staticPx = computeStaticEstimate({ structure, appearance: appearance(1) })
    expect(staticPx).toBe(84)

    const recorded = recordMeasuredHeight({ cacheKey, measuredHeightPx: 240 })
    expect(recorded).toEqual({ ok: true, value: { cacheKey } })
    expect(evaluateEstimatedHeight(requestFor(cacheKey, structure))).toBe(240)
    expect(lookupMeasuredHeight(cacheKey)).toEqual({ kind: 'Hit', value: 240 })
  })

  it('returns Miss for an old appearanceVersion after invalidation', () => {
    const oldKey = mermaidKey('version-source', 1, 64)
    const structure = buildWidgetStructure({ kind: 'Mermaid', source: 'graph TD' })
    recordMeasuredHeight({ cacheKey: oldKey, measuredHeightPx: 200 })
    expect(lookupMeasuredHeight(oldKey).kind).toBe('Hit')

    const result = invalidateMeasuredHeightCacheOnAppearanceChange({
      previousVersion: 1,
      currentVersion: 2,
    })
    expect(result.evictedEntryCount).toBeGreaterThan(0)
    expect(lookupMeasuredHeight(oldKey)).toEqual({ kind: 'Miss' })
    expect(evaluateEstimatedHeight(requestFor(oldKey, structure))).toBe(
      computeStaticEstimate({ structure, appearance: appearance(1) }),
    )
  })

  it('prefers measured Hit over a different static estimate for scroll regression', () => {
    const cacheKey = mermaidKey('scroll-source', 1, 256)
    const structure = buildWidgetStructure({ kind: 'Mermaid', source: 'a\nb' })
    const staticPx = computeStaticEstimate({ structure, appearance: appearance(1) })
    expect(staticPx).toBe(56)

    recordMeasuredHeight({ cacheKey, measuredHeightPx: 333 })
    expect(evaluateEstimatedHeight(requestFor(cacheKey, structure))).toBe(333)
    expect(evaluateEstimatedHeight(requestFor(cacheKey, structure))).not.toBe(staticPx)
  })

  it('detects KaTeX hasMatrixLike for matrix, cases, aligned, and double backslash', () => {
    expect(buildWidgetStructure({ kind: 'KaTeX', source: '\\matrix' })).toMatchObject({
      hasMatrixLike: true,
    })
    expect(buildWidgetStructure({ kind: 'KaTeX', source: '\\cases' })).toMatchObject({
      hasMatrixLike: true,
    })
    expect(buildWidgetStructure({ kind: 'KaTeX', source: '\\aligned' })).toMatchObject({
      hasMatrixLike: true,
    })
    expect(buildWidgetStructure({ kind: 'KaTeX', source: 'a\\\\b' })).toMatchObject({ hasMatrixLike: true })
    expect(buildWidgetStructure({ kind: 'KaTeX', source: 'x + y' })).toMatchObject({ hasMatrixLike: false })

    const matrix = buildWidgetStructure({ kind: 'KaTeX', source: '\\matrix\na\nb\nc' })
    const plain = buildWidgetStructure({ kind: 'KaTeX', source: 'a\nb\nc\nd' })
    expect(matrix).toMatchObject({ hasMatrixLike: true, lineCount: 4 })
    expect(plain).toMatchObject({ hasMatrixLike: false, lineCount: 4 })
    expect(computeStaticEstimate({ structure: matrix, appearance: appearance(1) })).toBeGreaterThan(
      computeStaticEstimate({ structure: plain, appearance: appearance(1) }),
    )
  })

  it('builds WidthDependent buckets for Mermaid and CodeBlock, WidthIndependent for KaTeX and Table', () => {
    expect(widthBucketPolicyFor('Mermaid', 130)).toEqual({ kind: 'WidthDependent', bucket: 2 })
    expect(widthBucketPolicyFor('CodeBlock', 63)).toEqual({ kind: 'WidthDependent', bucket: 0 })
    expect(widthBucketPolicyFor('CodeBlock', 64)).toEqual({ kind: 'WidthDependent', bucket: 1 })
    expect(widthBucketPolicyFor('KaTeX')).toEqual({ kind: 'WidthIndependent' })
    expect(widthBucketPolicyFor('Table', 999)).toEqual({ kind: 'WidthIndependent' })
  })

  it('exposes a shared evaluateEstimatedHeight entry for all four kinds', () => {
    const kinds = [
      buildWidgetStructure({ kind: 'Mermaid', source: 'a' }),
      buildWidgetStructure({ kind: 'KaTeX', source: 'x' }),
      buildWidgetStructure({ kind: 'CodeBlock', code: 'a' }),
      buildWidgetStructure({ kind: 'Table', rowCount: 2 }),
    ] as const

    for (const structure of kinds) {
      const cacheKey: CacheKey = {
        contentIdentity: {
          widgetKind: structure.kind,
          contentDigest: `shared-${structure.kind}`,
        },
        appearanceVersion: 1,
        widthBucket: widthBucketPolicyFor(structure.kind, 128),
      }
      const expected = computeStaticEstimate({ structure, appearance: appearance(1) })
      expect(evaluateEstimatedHeight(requestFor(cacheKey, structure))).toBe(expected)
      expect(expected).toBeGreaterThan(0)
    }

    const katex = katexKey('plain', 1)
    expect(lookupMeasuredHeight(katex).kind).toBe('Miss')
    expect(recordMeasuredHeight({ cacheKey: katex, measuredHeightPx: 0 })).toEqual({
      ok: false,
      error: 'NonPositiveMeasuredHeight',
    })
  })
})
