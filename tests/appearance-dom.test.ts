import { describe, expect, it, vi } from 'vitest'
import {
  APPEARANCE_CONFIGURATION_IDS,
  isAppearanceConfigurationChange,
  subscribeAppearanceChanges,
} from '../src/editor-provider'
import { appearanceChangeMessage } from '../src/protocol'
import {
  appearanceAssignments,
  createFallbackProfile,
  resolveAppearanceProfile,
  appearanceSourceIdentity,
  type AppearanceHostSources,
} from '../src/appearance-profile'
import { defaultPerwriteSettings, validatePerwriteSettings } from '../src/settings-resolver'
import {
  applyAppearanceResolution,
  applyCssVariables,
  applyMetrics,
  invalidateEditorAppearance,
  resolveAppearanceFromDom,
  type AppearanceAdapter,
  type AppliedAppearance,
} from '../webview/appearance'
import {
  parseCssColorValue,
  readThemeKind,
  readVscodeColors,
  vscodeColorSources,
  vscodeVariableName,
} from '../webview/vscode-theme-adapter'
import { ShikiCodeBlockWidget } from '../webview/nodes/code-block-node'
import { KaTeXBlockWidget } from '../webview/nodes/katex-node'
import { MermaidWidget } from '../webview/nodes/mermaid-node'
import { TableWidget } from '../webview/editor/table-widget'

vi.mock('vscode', () => ({
  workspace: { getConfiguration: vi.fn(), onDidChangeConfiguration: vi.fn() },
  window: {}, extensions: { all: [] }, ColorThemeKind: {},
}))

function recordingAdapter() {
  const calls = {
    css: vi.fn(), shiki: vi.fn(async () => ({})), publish: vi.fn(() => true), dispose: vi.fn(),
    mermaid: vi.fn(), metrics: vi.fn(), fonts: vi.fn(), invalidate: vi.fn(), failure: vi.fn(),
  }
  const adapter: AppearanceAdapter = {
    applyCssVariables: calls.css,
    prepareShikiTheme: calls.shiki,
    publishShikiTheme: calls.publish,
    disposeShikiTheme: calls.dispose,
    applyMermaidTheme: calls.mermaid,
    applyMetrics(metrics, version) { applyMetrics(metrics, version); calls.metrics(metrics, version) },
    beginFontResourcePreparation: calls.fonts,
    invalidateWidgets: calls.invalidate,
    showFailure: calls.failure,
  }
  return { calls, adapter }
}

function lastCssVariables(recorder: ReturnType<typeof recordingAdapter>): Record<string, string> {
  return recorder.calls.css.mock.calls.at(-1)?.[0] as Record<string, string>
}

// 組み込みパレット ( dark: editor.background #1e1e1e, foreground #d4d4d4 ) と相違する DOM 色。
// パレット値では通過しない対照になるよう、どの色もパレットと異なる値を選ぶ。
const DOM_COLORS_DARK = { 'editor.background': '#123456', 'editor.foreground': '#abcdef' }

function styleFromColors(colors: Readonly<Record<string, string>>): { getPropertyValue(name: string): string } {
  const byVariable: Record<string, string> = {}
  for (const [token, hex] of Object.entries(colors)) byVariable[vscodeVariableName(token)] = hex
  return { getPropertyValue: name => byVariable[name] ?? '' }
}

function hostSources(overrides: Partial<AppearanceHostSources> = {}): AppearanceHostSources {
  return {
    version: 1,
    settings: { ok: true, value: { perwrite: defaultPerwriteSettings(), editorFont: { family: 'Mono', size: 14 } } },
    fallbackFont: { family: 'Mono', size: 14 },
    tokenTheme: {
      ok: true,
      value: {
        name: 'sample', type: 'dark',
        tokenColors: [{ scope: 'keyword', settings: { foreground: '#ff0000' } }],
        semanticTokenColors: {}, semanticHighlighting: false,
      },
    },
    ...overrides,
  }
}

describe('appearance product dispatcher', () => {
  it('declares exactly the appearance configuration inputs', () => {
    expect(APPEARANCE_CONFIGURATION_IDS).toEqual([
      'editor.fontFamily', 'editor.fontSize',
      'perwrite.lineHeight', 'perwrite.editorWidth',
      'perwrite.heading1Scale', 'perwrite.heading2Scale', 'perwrite.heading3Scale',
      'perwrite.heading4Scale', 'perwrite.heading5Scale', 'perwrite.heading6Scale',
      'perwrite.heading1LineHeight', 'perwrite.heading2LineHeight', 'perwrite.heading3LineHeight',
      'perwrite.heading4LineHeight', 'perwrite.heading5LineHeight', 'perwrite.heading6LineHeight',
      'perwrite.contentPadding', 'perwrite.blockPadding', 'perwrite.gutterGap',
      'perwrite.mathBlockPadding',
      'perwrite.tableCellBlockPadding', 'perwrite.tableCellInlinePadding', 'perwrite.tableWidgetBlockPadding',
      'perwrite.mermaidBlockPadding',
    ])
    for (const changed of APPEARANCE_CONFIGURATION_IDS) {
      expect(isAppearanceConfigurationChange(id => id === changed)).toBe(true)
    }
    expect(isAppearanceConfigurationChange(id => id === 'workbench.colorTheme')).toBe(false)
  })

  it('connects active theme and each configuration input to one sender', async () => {
    let themeListener: (() => void) | undefined
    let configurationListener: ((affects: (id: string) => boolean) => void) | undefined
    const send = vi.fn(async () => {})
    subscribeAppearanceChanges({
      onThemeChange(listener) { themeListener = listener; return { dispose() {} } },
      onConfigurationChange(listener) { configurationListener = listener; return { dispose() {} } },
    }, send)
    themeListener?.()
    for (const changed of APPEARANCE_CONFIGURATION_IDS) configurationListener?.(id => id === changed)
    configurationListener?.(id => id === 'workbench.colorTheme')
    await Promise.resolve()
    expect(send).toHaveBeenCalledTimes(1 + APPEARANCE_CONFIGURATION_IDS.length)
  })

  it('applies one profile to root, Shiki, Mermaid, metrics, and measurement', async () => {
    const profile = createFallbackProfile('dark', {}, 7)
    const { calls, adapter } = recordingAdapter()
    const applied = await applyAppearanceResolution({ ok: true, profile }, null, adapter)
    expect(applied.profile).toBe(profile)
    expect(calls.css).toHaveBeenCalledWith(profile.cssVariables)
    expect(calls.shiki).toHaveBeenCalledWith(profile.theme, profile.version)
    expect(calls.publish).toHaveBeenCalledOnce()
    expect(calls.mermaid).toHaveBeenCalledWith('dark')
    expect(calls.metrics).toHaveBeenCalledWith(profile.metrics, 7)
    expect(calls.invalidate).toHaveBeenCalledOnce()
    expect(calls.failure).toHaveBeenCalledWith(null)
  })

  it('preserves the complete prior profile when Shiki preparation fails', async () => {
    const priorProfile = createFallbackProfile('dark', {}, 4)
    const nextProfile = createFallbackProfile('light', {}, 5)
    const prior: AppliedAppearance = { profile: priorProfile, initialized: true }
    const { calls, adapter } = recordingAdapter()
    calls.shiki.mockRejectedValueOnce(new Error('load failed'))
    const retained = await applyAppearanceResolution({ ok: true, profile: nextProfile }, prior, adapter)
    expect(retained).toBe(prior)
    expect(calls.css).not.toHaveBeenCalled()
    expect(calls.mermaid).not.toHaveBeenCalled()
    expect(calls.metrics).not.toHaveBeenCalled()
    expect(calls.invalidate).not.toHaveBeenCalled()
    expect(calls.failure).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.stringContaining('load failed'),
    }))
  })

  it('keeps the Shiki failure visible when the initial apply proceeds without a prior profile', async () => {
    const profile = createFallbackProfile('dark', {}, 6)
    const { calls, adapter } = recordingAdapter()
    calls.shiki.mockRejectedValueOnce(new Error('initial load failed'))
    const applied = await applyAppearanceResolution({ ok: true, profile }, null, adapter)
    expect(applied.initialized).toBe(true)
    expect(calls.css).toHaveBeenCalledWith(profile.cssVariables)
    expect(calls.failure).toHaveBeenLastCalledWith(expect.objectContaining({
      detail: expect.stringContaining('initial load failed'),
    }))
  })

  it('writes every CSS variable through the root adapter', () => {
    const values = createFallbackProfile('dark').cssVariables
    const setProperty = vi.fn()
    applyCssVariables({ style: { setProperty } } as unknown as HTMLElement, values)
    expect(setProperty).toHaveBeenCalledTimes(Object.keys(values).length)
  })

  it('keeps Mermaid DOM identity while appearance-dependent widgets change equality', () => {
    const first = createFallbackProfile('dark', {}, 10)
    applyMetrics(first.metrics, first.version)
    const oldWidgets = [
      new ShikiCodeBlockWidget('x', 'text', 0), new KaTeXBlockWidget('x'), new MermaidWidget('x', { mermaidLayout: 'elk', mermaidMaxEdges: 1024, mermaidPanStep: 80, mermaidZoomStep: 1.5 }),
      new TableWidget({ from: 0, to: 1, rows: [] }),
    ]
    const second = createFallbackProfile('dark', {}, 11)
    applyMetrics(second.metrics, second.version)
    const newWidgets = [
      new ShikiCodeBlockWidget('x', 'text', 0), new KaTeXBlockWidget('x'), new MermaidWidget('x', { mermaidLayout: 'elk', mermaidMaxEdges: 1024, mermaidPanStep: 80, mermaidZoomStep: 1.5 }),
      new TableWidget({ from: 0, to: 1, rows: [] }),
    ]
    expect(oldWidgets.map((widget, index) => widget.eq(newWidgets[index] as never))).toEqual([false, false, true, false])
  })

  it('applies default dimensions and derives all widget heights from profile metrics', () => {
    const profile = createFallbackProfile('dark', {}, 12)
    applyMetrics(profile.metrics, profile.version)
    expect(profile.cssVariables['--perwrite-line-height']).toBe('2')
    expect(profile.cssVariables['--perwrite-editor-width']).toBe('960px')
    expect(Array.from({ length: 6 }, (_, index) =>
      profile.cssVariables[`--perwrite-heading-${index + 1}-scale` as keyof typeof profile.cssVariables],
    )).toEqual(['2', '1.6', '1.4', '1.1', '1', '1'])
    expect(new ShikiCodeBlockWidget('a\nb', 'text', 0).estimatedHeight).toBeCloseTo(112)
    expect(new KaTeXBlockWidget('x').estimatedHeight).toBeCloseTo(84)
    expect(new MermaidWidget('a\nb', { mermaidLayout: 'elk', mermaidMaxEdges: 1024, mermaidPanStep: 80, mermaidZoomStep: 1.5 }).estimatedHeight).toBeCloseTo(74)
    expect(new TableWidget({
      from: 0, to: 1,
      rows: [
        { header: true, cells: [] }, { header: false, cells: [] },
      ],
    }).estimatedHeight).toBeCloseTo(96)
  })

  it('updates widget estimates from a single line-height change', () => {
    const changed = resolveAppearanceProfile({
      theme: createFallbackProfile('dark').theme, themeKind: 'dark', editorFont: { family: 'Mono', size: 14 },
      settings: { ...defaultPerwriteSettings(), lineHeight: 2 }, version: 14,
    })
    expect(changed.ok).toBe(true)
    if (!changed.ok) return
    applyMetrics(changed.value.metrics, changed.value.version)
    expect(new ShikiCodeBlockWidget('a\nb', 'text', 0).estimatedHeight).toBe(112)
    expect(new KaTeXBlockWidget('x').estimatedHeight).toBe(84)
    expect(new MermaidWidget('a\nb', { mermaidLayout: 'elk', mermaidMaxEdges: 1024, mermaidPanStep: 80, mermaidZoomStep: 1.5 }).estimatedHeight).toBe(74)
    expect(new TableWidget({ from: 0, to: 1, rows: [{ header: true, cells: [] }] }).estimatedHeight).toBe(56)
  })

  it('dispatches a widget rebuild and requests CM6 measurement', () => {
    const view = { dispatch: vi.fn(), requestMeasure: vi.fn() }
    invalidateEditorAppearance(view)
    expect(view.dispatch).toHaveBeenCalledWith({})
    expect(view.requestMeasure).toHaveBeenCalledOnce()
  })

})

describe('vscode theme adapter', () => {
  it('reads exactly the declaration table color sources, one-to-one with variable names', () => {
    const colorTransforms = new Set(['color', 'code-background', 'table-background'])
    const expected = [...new Set(
      appearanceAssignments.filter(item => colorTransforms.has(item.transform)).flatMap(item => item.sources),
    )]
    expect([...vscodeColorSources()].sort()).toEqual(expected.sort())
    for (const source of vscodeColorSources()) {
      expect(vscodeVariableName(source)).toBe(`--vscode-${source.replace(/\./g, '-')}`)
    }
  })

  it('decodes hex, rgb, and rgba, and rejects every other form as a DecodeFailure', () => {
    expect(parseCssColorValue('#1a2b3c')).toEqual({ ok: true, value: '#1a2b3c' })
    expect(parseCssColorValue('#1A2B3C80')).toEqual({ ok: true, value: '#1a2b3c80' })
    expect(parseCssColorValue('rgb(18, 52, 86)')).toEqual({ ok: true, value: '#123456' })
    expect(parseCssColorValue('rgba(18, 52, 86, 0.5)')).toEqual({ ok: true, value: '#12345680' })
    for (const bad of ['', 'red', 'var(--x)', '#12', '#12345', 'hsl(0, 0%, 0%)', 'rgb(300, 0, 0)']) {
      expect(parseCssColorValue(bad).ok, bad).toBe(false)
    }
  })

  it('excludes missing variables and records invalid ones as failures', () => {
    const style = styleFromColors({ 'editor.background': '#123456' })
    const withInvalid = {
      getPropertyValue(name: string) {
        return name === vscodeVariableName('editor.foreground') ? 'not-a-color' : style.getPropertyValue(name)
      },
    }
    const { colors, failures } = readVscodeColors(name => withInvalid.getPropertyValue(name))
    expect(colors['editor.background']).toBe('#123456')
    expect(colors['editor.foreground']).toBeUndefined()
    expect(failures.some(failure => failure.source === 'editor.foreground' && failure.value === 'not-a-color' && failure.reason.includes('Invalid CSS color'))).toBe(true)
  })

  it('maps known theme-kind attributes and preserves unknown input as failure', () => {
    expect(readThemeKind('vscode-light')).toEqual({ ok: true, value: 'light' })
    expect(readThemeKind('vscode-dark')).toEqual({ ok: true, value: 'dark' })
    expect(readThemeKind('vscode-high-contrast')).toEqual({ ok: true, value: 'hc-dark' })
    expect(readThemeKind('vscode-high-contrast-light')).toEqual({ ok: true, value: 'hc-light' })
    expect(readThemeKind(null)).toEqual(expect.objectContaining({ ok: false }))
    expect(readThemeKind('')).toEqual(expect.objectContaining({ ok: false }))
    expect(readThemeKind('vscode-unknown')).toEqual(expect.objectContaining({ ok: false, attribute: 'vscode-unknown' }))
  })
})

describe('DOM-sourced appearance resolution', () => {
  it('returns an explicit failure when the DOM theme kind is unknown', () => {
    const resolution = resolveAppearanceFromDom(hostSources(), styleFromColors(DOM_COLORS_DARK), 'vscode-unknown')
    expect(resolution).toEqual({
      ok: false,
      error: 'Unknown VS Code theme kind: vscode-unknown',
    })
  })

  it('treats equal appearance versions as one payload identity', () => {
    const first = hostSources()
    const second = hostSources({ tokenTheme: { ok: false, error: 'different payload' } })
    expect(appearanceSourceIdentity(first)).not.toBe(appearanceSourceIdentity(second))
    expect(appearanceSourceIdentity(first)).toBe(appearanceSourceIdentity({ ...first }))
  })

  it('applies DOM-derived --perwrite-* from injected --vscode-* and theme-kind', () => {
    const resolution = resolveAppearanceFromDom(hostSources(), styleFromColors(DOM_COLORS_DARK), 'vscode-dark')
    expect(resolution.ok).toBe(true)
    if (!resolution.ok) return
    expect(resolution.profile.themeKind).toBe('dark')
    expect(resolution.profile.cssVariables['--perwrite-editor-background']).toBe('#123456')
    expect(resolution.profile.cssVariables['--perwrite-editor-foreground']).toBe('#abcdef')
    // 対照: 組み込みパレット値では通過しない。
    expect(resolution.profile.cssVariables['--perwrite-editor-background']).not.toBe('#1e1e1e')
  })

  it('follows a --vscode-* variable change into --perwrite-*', () => {
    const first = resolveAppearanceFromDom(hostSources(), styleFromColors({ 'editor.background': '#111111' }), 'vscode-dark')
    const second = resolveAppearanceFromDom(hostSources(), styleFromColors({ 'editor.background': '#222222' }), 'vscode-dark')
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(first.profile.cssVariables['--perwrite-editor-background']).toBe('#111111')
    expect(second.profile.cssVariables['--perwrite-editor-background']).toBe('#222222')
  })

  it('reaches the latest --perwrite-* regardless of host and DOM trigger order', async () => {
    const a = resolveAppearanceFromDom(hostSources(), styleFromColors({ 'editor.background': '#0a0a0a' }), 'vscode-dark')
    const b = resolveAppearanceFromDom(hostSources(), styleFromColors({ 'editor.background': '#0b0b0b' }), 'vscode-dark')
    for (const [first, second, expected] of [[a, b, '#0b0b0b'], [b, a, '#0a0a0a']] as const) {
      const recorder = recordingAdapter()
      let applied = await applyAppearanceResolution(first, null, recorder.adapter)
      applied = await applyAppearanceResolution(second, applied, recorder.adapter)
      expect(lastCssVariables(recorder)['--perwrite-editor-background']).toBe(expected)
    }
  })

  it('discards a stale resolution that completes after a newer one', async () => {
    let generation = 0
    const g1 = ++generation
    const resA = resolveAppearanceFromDom(hostSources(), styleFromColors({ 'editor.background': '#0a0a0a' }), 'vscode-dark')
    const resB = resolveAppearanceFromDom(hostSources(), styleFromColors({ 'editor.background': '#0b0b0b' }), 'vscode-dark')
    const recorder = recordingAdapter()
    let releaseStale: () => void = () => {}
    const staleShiki = new Promise<Record<string, unknown>>(resolve => { releaseStale = () => resolve({}) })
    const staleAdapter: AppearanceAdapter = { ...recorder.adapter, prepareShikiTheme: () => staleShiki }
    const stale = applyAppearanceResolution(resA, null, staleAdapter, () => generation === g1)
    const g2 = ++generation
    await applyAppearanceResolution(resB, null, recorder.adapter, () => generation === g2)
    releaseStale()
    await stale
    // 古い解決 A は適用世代が最新でないため css を書かず、最終値は最新 B のまま。
    expect(lastCssVariables(recorder)['--perwrite-editor-background']).toBe('#0b0b0b')
    expect(recorder.calls.publish).toHaveBeenCalledTimes(2)
    expect(recorder.calls.publish.mock.calls[1]?.[1]?.()).toBe(false)
  })

  it('keeps DOM UI colors and shows a reason when the token theme fails', async () => {
    const sources = hostSources({ tokenTheme: { ok: false, error: 'active theme read failed' } })
    const resolution = resolveAppearanceFromDom(sources, styleFromColors(DOM_COLORS_DARK), 'vscode-dark')
    expect(resolution.ok).toBe(true)
    if (!resolution.ok) return
    // token 失敗でも UI 色は DOM 由来を維持し、全面フォールバックは発生しない。
    expect(resolution.profile.cssVariables['--perwrite-editor-background']).toBe('#123456')
    expect(resolution.profile.cssVariables['--perwrite-editor-background']).not.toBe('#1e1e1e')
    // themeKind 別の組み込み token 色を適用する。
    expect(resolution.profile.theme.tokenColors.length).toBeGreaterThan(0)
    const recorder = recordingAdapter()
    await applyAppearanceResolution(resolution, null, recorder.adapter)
    expect(recorder.calls.failure).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.stringContaining('active theme read failed'),
    }))
  })

  it('carries a token-theme failure through message serialization while keeping DOM colors', async () => {
    let themeListener: (() => void) | undefined
    let applied: Promise<unknown> | undefined
    const recorder = recordingAdapter()
    subscribeAppearanceChanges({
      onThemeChange(listener) { themeListener = listener; return { dispose() {} } },
      onConfigurationChange() { return { dispose() {} } },
    }, () => {
      const sources = hostSources({ tokenTheme: { ok: false, error: 'active theme read failed' } })
      const message = JSON.parse(JSON.stringify(appearanceChangeMessage(sources))) as { appearance: AppearanceHostSources }
      const resolution = resolveAppearanceFromDom(message.appearance, styleFromColors(DOM_COLORS_DARK), 'vscode-dark')
      applied = applyAppearanceResolution(resolution, null, recorder.adapter)
    })
    themeListener?.()
    await applied
    expect(lastCssVariables(recorder)['--perwrite-editor-background']).toBe('#123456')
    expect(recorder.calls.failure).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.stringContaining('active theme read failed'),
    }))
  })

  it('uses DOM-derived UI colors for the fallback profile when settings validation fails', async () => {
    const invalidSetting = validatePerwriteSettings({ ...defaultPerwriteSettings(), lineHeight: Number.NaN })
    if (invalidSetting.ok) throw new Error('invalid setting was accepted')
    const sources = hostSources({ settings: invalidSetting })
    const resolution = resolveAppearanceFromDom(sources, styleFromColors(DOM_COLORS_DARK), 'vscode-dark')
    expect(resolution.ok).toBe(false)
    if (resolution.ok) return
    expect(resolution.fallback.cssVariables['--perwrite-editor-background']).toBe('#123456')
    expect(resolution.fallback.cssVariables['--perwrite-editor-background']).not.toBe('#1e1e1e')
    const recorder = recordingAdapter()
    await applyAppearanceResolution(resolution, null, recorder.adapter)
    expect(recorder.calls.css).toHaveBeenCalledWith(resolution.fallback.cssVariables)
    expect(recorder.calls.failure).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.stringContaining('lineHeight'),
    }))
  })
})
