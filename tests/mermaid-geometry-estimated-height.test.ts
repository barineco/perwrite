import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { inlineOverviewScale, type SvgGeometry } from '../webview/editor/mermaid-viewport'
import {
  buildGeometryCacheKey,
  clearMermaidGeometryCache,
  computeGeometryInlineHeight,
  computeLineCountFallback,
  evaluateMermaidEstimatedHeight,
  getRememberedEditorContentWidth,
  lookupMermaidGeometry,
  mermaidBlockAxisChromePx,
  mermaidInlineContentWidth,
  mermaidWidgetHeightFromDiagramHeight,
  putMermaidGeometry,
  readEditorContentWidth,
  rememberEditorContentWidth,
  serializeGeometryCacheKey,
  setMermaidGeometryTheme,
  type ContentBounds,
  type GeometryCacheKey,
  type MermaidBlockChrome,
  type RenderIdentity,
} from '../webview/mermaid-geometry-cache'
import { DEFAULT_APPEARANCE_FIXED_VALUES } from '../src/appearance-profile'
import { PERWRITE_SETTING_SCHEMA } from '../src/settings-resolver'
import { MermaidWidget } from '../webview/nodes/mermaid-node'

const mermaidConfig = {
  mermaidLayout: 'elk' as const,
  mermaidMaxEdges: 1024,
  mermaidPanStep: 80,
  mermaidZoomStep: 1.5,
}

const baseIdentity: RenderIdentity = {
  theme: 'default',
  layout: 'elk',
  maxEdges: 1024,
  source: 'graph TD\n  A-->B',
}

function keyFor(
  identity: RenderIdentity = baseIdentity,
  appearanceVersion = 1,
  fontResourceGeneration = 0,
): GeometryCacheKey {
  return buildGeometryCacheKey(identity, appearanceVersion, fontResourceGeneration)
}

function request(
  cacheKey: GeometryCacheKey,
  availableWidth: number | null,
  lineCount = 3,
  lineHeightPx = 28,
) {
  return { cacheKey, lineCount, lineHeightPx, availableWidth }
}

function webviewSource(relative: string): string {
  return readFileSync(join(process.cwd(), 'webview', relative), 'utf8')
}

afterEach(() => {
  clearMermaidGeometryCache()
  setMermaidGeometryTheme('default')
})

describe('mermaid geometry estimatedHeight', () => {
  it('returns geometry pure function on Hit with Positive availableWidth', () => {
    const cacheKey = keyFor()
    const contentBounds: ContentBounds = { width: 400, height: 200 }
    putMermaidGeometry(cacheKey, contentBounds)

    const availableWidth = 200
    const expected = contentBounds.height * Math.min(1, availableWidth / contentBounds.width)
    expect(evaluateMermaidEstimatedHeight(request(cacheKey, availableWidth))).toBe(expected)
    expect(evaluateMermaidEstimatedHeight(request(cacheKey, availableWidth)))
      .toBe(computeGeometryInlineHeight(contentBounds, availableWidth))
  })

  it('matches inlineOverviewScale * contentBounds.height on Hit (zero-delta formula)', () => {
    const cacheKey = keyFor()
    const contentBounds: ContentBounds = { width: 1100, height: 550 }
    putMermaidGeometry(cacheKey, contentBounds)
    const availableWidth = 550
    const geometry: SvgGeometry = {
      viewBox: { x: 0, y: 0, width: 1000, height: 500 },
      graphBounds: { x: -50, y: -25, width: 1100, height: 550 },
      contentBounds: { x: -50, y: -25, width: contentBounds.width, height: contentBounds.height },
    }
    const presentInlineHeight = contentBounds.height * inlineOverviewScale(geometry, availableWidth)
    expect(evaluateMermaidEstimatedHeight(request(cacheKey, availableWidth))).toBe(presentInlineHeight)
    expect(computeGeometryInlineHeight(contentBounds, availableWidth)).toBe(presentInlineHeight)
  })

  it('falls back to lineCount * lineHeightPx on Miss', () => {
    const cacheKey = keyFor()
    expect(lookupMermaidGeometry(cacheKey)).toEqual({ kind: 'Miss' })
    expect(evaluateMermaidEstimatedHeight(request(cacheKey, 480, 4, 28)))
      .toBe(computeLineCountFallback(4, 28))
    expect(evaluateMermaidEstimatedHeight(request(cacheKey, 480, 4, 28))).toBe(112)
  })

  it('falls back when availableWidth is null or non-Positive even if Hit', () => {
    const cacheKey = keyFor()
    putMermaidGeometry(cacheKey, { width: 400, height: 200 })
    expect(evaluateMermaidEstimatedHeight(request(cacheKey, null, 2, 28))).toBe(56)
    expect(evaluateMermaidEstimatedHeight(request(cacheKey, 0, 2, 28))).toBe(56)
    expect(evaluateMermaidEstimatedHeight(request(cacheKey, -10, 2, 28))).toBe(56)
  })

  it('Misses when any cache key coordinate changes alone', () => {
    const base = keyFor()
    putMermaidGeometry(base, { width: 300, height: 150 })
    expect(lookupMermaidGeometry(base).kind).toBe('Hit')

    const variants: GeometryCacheKey[] = [
      keyFor({ ...baseIdentity, theme: 'dark' }),
      keyFor({ ...baseIdentity, layout: 'dagre' }),
      keyFor({ ...baseIdentity, maxEdges: 512 }),
      keyFor({ ...baseIdentity, source: 'graph LR\n  X-->Y' }),
      keyFor(baseIdentity, 2, 0),
      keyFor(baseIdentity, 1, 1),
    ]
    for (const variant of variants) {
      expect(serializeGeometryCacheKey(variant)).not.toBe(serializeGeometryCacheKey(base))
      expect(lookupMermaidGeometry(variant)).toEqual({ kind: 'Miss' })
      expect(evaluateMermaidEstimatedHeight(request(variant, 480, 3, 28))).toBe(84)
    }
  })

  it('uses editor content width proxy and never feeds 0 into the geometry formula', () => {
    const zeroView = { contentDOM: { clientWidth: 0 } } as EditorView
    expect(readEditorContentWidth(zeroView)).toBeNull()

    const positiveView = { contentDOM: { clientWidth: 640 } } as EditorView
    expect(readEditorContentWidth(positiveView)).toBe(640)
    expect(getRememberedEditorContentWidth()).toBe(640)

    rememberEditorContentWidth(0)
    expect(getRememberedEditorContentWidth()).toBe(640)

    const cacheKey = keyFor()
    putMermaidGeometry(cacheKey, { width: 400, height: 200 })
    const withZero = evaluateMermaidEstimatedHeight(request(cacheKey, 0, 5, 28))
    expect(withZero).toBe(140)
    expect(withZero).not.toBe(0)
    expect(withZero).not.toBe(computeGeometryInlineHeight({ width: 400, height: 200 }, 0))
  })

  it('supplies MermaidWidget.estimatedHeight through evaluateMermaidEstimatedHeight', () => {
    const mermaidNode = webviewSource('nodes/mermaid-node.ts')
    expect(mermaidNode).toContain("from '../mermaid-geometry-cache'")
    expect(mermaidNode).toContain('evaluateMermaidEstimatedHeight')
    expect(mermaidNode).toContain('mermaidWidgetHeightFromDiagramHeight')
    expect(mermaidNode).toContain('mermaidInlineContentWidth')
    expect(mermaidNode).toMatch(/get estimatedHeight\(\)[\s\S]*evaluateMermaidWidgetHeight/)
    expect(mermaidNode).not.toMatch(/from ['"].*widget-height-cache['"]/)
    expect(mermaidNode).not.toContain('evaluateEstimatedHeight')
    expect(mermaidNode).not.toContain('lastAvailableWidthPxByDigest')
    expect(mermaidNode).not.toContain('attachMeasuredHeightObserver')

    clearMermaidGeometryCache()
    const chrome: MermaidBlockChrome = {
      paddingPx: PERWRITE_SETTING_SCHEMA.mermaidBlockPadding.default,
      borderPx: DEFAULT_APPEARANCE_FIXED_VALUES.mermaidBlockBorderPx,
    }
    const widget = new MermaidWidget('a\nb', mermaidConfig)
    expect(widget.estimatedHeight).toBe(56 + mermaidBlockAxisChromePx(chrome))

    const cacheKey = buildGeometryCacheKey(
      {
        theme: 'default',
        layout: 'elk',
        maxEdges: 1024,
        source: 'a\nb',
      },
      0,
      0,
    )
    putMermaidGeometry(cacheKey, { width: 400, height: 200 })
    rememberEditorContentWidth(200)
    const contentWidth = mermaidInlineContentWidth(200, chrome)!
    expect(widget.estimatedHeight).toBe(
      mermaidWidgetHeightFromDiagramHeight(
        computeGeometryInlineHeight({ width: 400, height: 200 }, contentWidth),
        chrome,
      ),
    )
  })

  it('derives axis chrome from declared padding and border coordinates', () => {
    const chrome: MermaidBlockChrome = {
      paddingPx: PERWRITE_SETTING_SCHEMA.mermaidBlockPadding.default,
      borderPx: DEFAULT_APPEARANCE_FIXED_VALUES.mermaidBlockBorderPx,
    }
    expect(mermaidBlockAxisChromePx(chrome)).toBe(2 * (8 + 1))
    expect(mermaidInlineContentWidth(200, chrome)).toBe(182)
    expect(mermaidInlineContentWidth(18, chrome)).toBeNull()
    expect(mermaidWidgetHeightFromDiagramHeight(100, chrome)).toBe(118)

    const profileSource = readFileSync(join(process.cwd(), 'src/appearance-profile.ts'), 'utf8')
    expect(profileSource).toContain("'--perwrite-mermaid-block-padding'")
    expect(profileSource).toContain("'--perwrite-mermaid-block-border'")
    expect(profileSource).toContain("'perwrite.mermaidBlockPadding'")
    expect(profileSource).toContain("'fixed.mermaidBlockBorderPx'")
    expect(profileSource).toContain('mermaidBlockPaddingPx')
    expect(profileSource).toContain('mermaidBlockBorderPx')

    const styles = readFileSync(join(process.cwd(), 'webview/theme/styles.css'), 'utf8')
    expect(styles).toContain('padding: var(--perwrite-mermaid-block-padding)')
    expect(styles).toContain('border: var(--perwrite-mermaid-block-border) solid var(--perwrite-border)')
    expect(styles).not.toMatch(/\.cm-mermaid-block\s*\{[^}]*padding:\s*8px/)
  })

  it('keeps KaTeX / CodeBlock / Table on evaluateEstimatedHeight', () => {
    for (const relative of [
      'nodes/katex-node.ts',
      'nodes/code-block-node.ts',
      'editor/table-widget.ts',
    ] as const) {
      const source = webviewSource(relative)
      expect(source).toContain('evaluateEstimatedHeight')
      expect(source).toMatch(/from ['"].*widget-height-cache['"]/)
      expect(source).not.toContain('evaluateMermaidEstimatedHeight')
      expect(source).not.toContain('mermaid-geometry-cache')
    }
  })

  it('launches prepare from mermaidGeometryPreparationExtension only (toDOM-independent)', () => {
    const preparation = webviewSource('editor/mermaid-geometry-preparation.ts')
    const setup = webviewSource('editor/setup.ts')
    const mermaidNode = webviewSource('nodes/mermaid-node.ts')

    expect(preparation).toContain('mermaidGeometryPreparationExtension')
    expect(preparation).toContain('schedulePrepareMermaidGeometries')
    expect(preparation).toContain('ViewPlugin.fromClass')
    expect(preparation).toContain('collectMermaidDocumentEntries')
    expect(setup).toContain('mermaidGeometryPreparationExtension')

    expect(mermaidNode).not.toContain('schedulePrepareMermaidGeometries')
    expect(mermaidNode).not.toContain('mermaidGeometryPreparationExtension')
    expect(mermaidNode).not.toContain('putMermaidGeometry')

    const toDomBlock = mermaidNode.match(/toDOM\([\s\S]*?\n  \}/)?.[0] ?? ''
    expect(toDomBlock).toContain('MermaidPresentationController')
    expect(toDomBlock).not.toContain('schedulePrepare')
    expect(toDomBlock).not.toContain('prepareMermaidDiagram')
  })
})
