import type { Result, TokenThemeData } from './protocol'

export interface ThemeData extends TokenThemeData {
  readonly colors: Readonly<Record<string, string>>
}

import {
  defaultPerwriteSettings,
  validateEditorFont,
  validatePerwriteSettings,
  type EditorFontSettings,
  type PerwriteSettings,
  type ResolvedAppearanceSettings,
} from './settings-resolver'

export type ThemeKind = 'light' | 'dark' | 'hc-light' | 'hc-dark'

const colorAssignments = [
  ['--perwrite-editor-background', 'editor.background'],
  ['--perwrite-editor-foreground', 'editor.foreground'],
  ['--perwrite-muted-foreground', 'descriptionForeground'],
  ['--perwrite-cursor-foreground', 'editorCursor.foreground'],
  ['--perwrite-selection-background', 'editor.selectionBackground'],
  ['--perwrite-gutter-background', 'editorGutter.background'],
  ['--perwrite-gutter-foreground', 'editorLineNumber.foreground'],
  ['--perwrite-gutter-active-foreground', 'editorLineNumber.activeForeground'],
  ['--perwrite-border', 'editorGroup.border'],
  ['--perwrite-hover-background', 'toolbar.hoverBackground'],
  ['--perwrite-error-foreground', 'errorForeground'],
  ['--perwrite-error-background', 'inputValidation.errorBackground'],
  ['--perwrite-error-border', 'inputValidation.errorBorder'],
  ['--perwrite-link-foreground', 'textLink.foreground'],
  ['--perwrite-blockquote-border', 'textBlockQuote.border'],
  ['--perwrite-blockquote-foreground', 'textBlockQuote.foreground'],
  ['--perwrite-input-background', 'input.background'],
  ['--perwrite-input-foreground', 'input.foreground'],
  ['--perwrite-input-border', 'input.border'],
  ['--perwrite-focus-border', 'focusBorder'],
  ['--perwrite-find-match-highlight', 'editor.findMatchHighlightBackground'],
  ['--perwrite-find-match-selected', 'editor.findMatchBackground'],
  ['--perwrite-scrollbar-background', 'scrollbarSlider.background'],
  ['--perwrite-scrollbar-hover-background', 'scrollbarSlider.hoverBackground'],
  ['--perwrite-diff-removed-background', 'diffEditor.removedLineBackground'],
  ['--perwrite-diff-inserted-background', 'diffEditor.insertedLineBackground'],
] as const

const dimensionVariables = [
  '--perwrite-font-family', '--perwrite-font-size', '--perwrite-line-height',
  '--perwrite-editor-width', '--perwrite-content-padding', '--perwrite-block-padding',
  '--perwrite-gutter-gap', '--perwrite-gutter-compact-gap', '--perwrite-math-block-padding',
  '--perwrite-heading-1-scale', '--perwrite-heading-2-scale', '--perwrite-heading-3-scale',
  '--perwrite-heading-4-scale', '--perwrite-heading-5-scale', '--perwrite-heading-6-scale',
  '--perwrite-heading-1-line-height', '--perwrite-heading-2-line-height', '--perwrite-heading-3-line-height',
  '--perwrite-heading-4-line-height', '--perwrite-heading-5-line-height', '--perwrite-heading-6-line-height',
  '--perwrite-table-cell-block-padding', '--perwrite-table-cell-inline-padding',
  '--perwrite-table-widget-block-padding',
  '--perwrite-mermaid-block-padding', '--perwrite-mermaid-block-border',
] as const

const derivedColorVariables = [
  '--perwrite-codeblock-background',
  '--perwrite-table-header-background',
  '--perwrite-diff-inserted-codeblock-background',
  '--perwrite-diff-removed-codeblock-background',
  '--perwrite-target-line-background',
] as const

export const PERWRITE_CSS_VARIABLE_NAMES = [
  ...colorAssignments.map(([variable]) => variable),
  ...derivedColorVariables,
  ...dimensionVariables,
] as const

export type PerwriteCssVariableName = typeof PERWRITE_CSS_VARIABLE_NAMES[number]
export type PerwriteCssVariables = Readonly<Record<PerwriteCssVariableName, string>>

export interface AppearanceFixedValues {
  readonly gutterCompactGapPx: number
  readonly mermaidBlockBorderPx: number
}

export const DEFAULT_APPEARANCE_FIXED_VALUES: AppearanceFixedValues = {
  gutterCompactGapPx: 8,
  mermaidBlockBorderPx: 1,
}

export type AppearanceMetricName = keyof AppearanceMetrics
export type AppearanceDestination =
  | { readonly kind: 'css'; readonly name: PerwriteCssVariableName }
  | { readonly kind: 'metric'; readonly name: AppearanceMetricName }

export interface AppearanceAssignment {
  readonly destination: AppearanceDestination
  readonly sources: readonly string[]
  readonly transform: 'color' | 'code-background' | 'table-background' | 'diff-code-background' | 'target-line-background' | 'css-value'
    | 'number' | 'product' | 'table-row' | 'heading-tuple'
}

const cssDestination = (name: PerwriteCssVariableName): AppearanceDestination => ({ kind: 'css', name })
const metricDestination = (name: AppearanceMetricName): AppearanceDestination => ({ kind: 'metric', name })

export const appearanceAssignments: readonly AppearanceAssignment[] = [
  ...colorAssignments.map(([destination, source]) => ({
    destination: cssDestination(destination),
    sources: source === 'editor.background' ? [source] : [source, 'editor.background'],
    transform: 'color' as const,
  })),
  { destination: cssDestination('--perwrite-codeblock-background'), sources: ['editor.background'], transform: 'code-background' },
  { destination: cssDestination('--perwrite-table-header-background'), sources: ['editor.background', 'sideBar.background', 'list.hoverBackground'], transform: 'table-background' },
  { destination: cssDestination('--perwrite-diff-inserted-codeblock-background'), sources: ['editor.background', 'diffEditor.insertedLineBackground'], transform: 'diff-code-background' },
  { destination: cssDestination('--perwrite-diff-removed-codeblock-background'), sources: ['editor.background', 'diffEditor.removedLineBackground'], transform: 'diff-code-background' },
  { destination: cssDestination('--perwrite-target-line-background'), sources: ['editor.background', 'editor.findMatchHighlightBackground'], transform: 'target-line-background' },
  { destination: cssDestination('--perwrite-font-family'), sources: ['editor.fontFamily'], transform: 'css-value' },
  { destination: cssDestination('--perwrite-font-size'), sources: ['editor.fontSize'], transform: 'css-value' },
  { destination: cssDestination('--perwrite-line-height'), sources: ['perwrite.lineHeight'], transform: 'css-value' },
  { destination: cssDestination('--perwrite-editor-width'), sources: ['perwrite.editorWidth'], transform: 'css-value' },
  { destination: cssDestination('--perwrite-content-padding'), sources: ['perwrite.contentPadding'], transform: 'css-value' },
  { destination: cssDestination('--perwrite-block-padding'), sources: ['perwrite.blockPadding'], transform: 'css-value' },
  { destination: cssDestination('--perwrite-gutter-gap'), sources: ['perwrite.gutterGap'], transform: 'css-value' },
  { destination: cssDestination('--perwrite-gutter-compact-gap'), sources: ['fixed.gutterCompactGapPx'], transform: 'css-value' },
  { destination: cssDestination('--perwrite-math-block-padding'), sources: ['perwrite.mathBlockPadding'], transform: 'css-value' },
  ...Array.from({ length: 6 }, (_, index) => ({
    destination: cssDestination(`--perwrite-heading-${index + 1}-scale` as PerwriteCssVariableName),
    sources: [`perwrite.heading${index + 1}Scale`], transform: 'css-value' as const,
  })),
  ...Array.from({ length: 6 }, (_, index) => ({
    destination: cssDestination(`--perwrite-heading-${index + 1}-line-height` as PerwriteCssVariableName),
    sources: [`perwrite.heading${index + 1}LineHeight`], transform: 'css-value' as const,
  })),
  { destination: cssDestination('--perwrite-table-cell-block-padding'), sources: ['perwrite.tableCellBlockPadding'], transform: 'css-value' },
  { destination: cssDestination('--perwrite-table-cell-inline-padding'), sources: ['perwrite.tableCellInlinePadding'], transform: 'css-value' },
  { destination: cssDestination('--perwrite-table-widget-block-padding'), sources: ['perwrite.tableWidgetBlockPadding'], transform: 'css-value' },
  { destination: cssDestination('--perwrite-mermaid-block-padding'), sources: ['perwrite.mermaidBlockPadding'], transform: 'css-value' },
  { destination: cssDestination('--perwrite-mermaid-block-border'), sources: ['fixed.mermaidBlockBorderPx'], transform: 'css-value' },
  { destination: metricDestination('fontSizePx'), sources: ['editor.fontSize'], transform: 'number' },
  { destination: metricDestination('lineHeightMultiplier'), sources: ['perwrite.lineHeight'], transform: 'number' },
  { destination: metricDestination('lineHeightPx'), sources: ['editor.fontSize', 'perwrite.lineHeight'], transform: 'product' },
  { destination: metricDestination('blockPaddingPx'), sources: ['perwrite.blockPadding'], transform: 'number' },
  { destination: metricDestination('mathBlockPaddingPx'), sources: ['perwrite.mathBlockPadding'], transform: 'number' },
  { destination: metricDestination('tableCellBlockPaddingPx'), sources: ['perwrite.tableCellBlockPadding'], transform: 'number' },
  { destination: metricDestination('tableCellInlinePaddingPx'), sources: ['perwrite.tableCellInlinePadding'], transform: 'number' },
  { destination: metricDestination('tableRowHeightPx'), sources: ['editor.fontSize', 'perwrite.lineHeight', 'perwrite.tableCellBlockPadding'], transform: 'table-row' },
  { destination: metricDestination('tableWidgetBlockPaddingPx'), sources: ['perwrite.tableWidgetBlockPadding'], transform: 'number' },
  { destination: metricDestination('mermaidBlockPaddingPx'), sources: ['perwrite.mermaidBlockPadding'], transform: 'number' },
  { destination: metricDestination('mermaidBlockBorderPx'), sources: ['fixed.mermaidBlockBorderPx'], transform: 'number' },
  { destination: metricDestination('headingScales'), sources: Array.from({ length: 6 }, (_, index) => `perwrite.heading${index + 1}Scale`), transform: 'heading-tuple' },
]

const COLOR_TRANSFORMS: ReadonlySet<AppearanceAssignment['transform']> = new Set(['color', 'code-background', 'table-background', 'diff-code-background', 'target-line-background'])

export function colorSourceTokens(): readonly string[] {
  const sources = new Set<string>()
  for (const assignment of appearanceAssignments) {
    if (COLOR_TRANSFORMS.has(assignment.transform)) {
      for (const source of assignment.sources) sources.add(source)
    }
  }
  return [...sources]
}

export interface AppearanceMetrics {
  readonly fontSizePx: number
  readonly lineHeightMultiplier: number
  readonly lineHeightPx: number
  readonly blockPaddingPx: number
  readonly mathBlockPaddingPx: number
  readonly tableRowHeightPx: number
  readonly tableCellBlockPaddingPx: number
  readonly tableCellInlinePaddingPx: number
  readonly tableWidgetBlockPaddingPx: number
  readonly mermaidBlockPaddingPx: number
  readonly mermaidBlockBorderPx: number
  readonly headingScales: readonly [number, number, number, number, number, number]
}

export interface AppearanceProfile {
  readonly version: number
  readonly cssVariables: PerwriteCssVariables
  readonly theme: ThemeData
  readonly themeKind: ThemeKind
  readonly metrics: AppearanceMetrics
}

export type AppearanceResolution =
  | { readonly ok: true; readonly profile: AppearanceProfile; readonly notice?: string }
  | { readonly ok: false; readonly error: string; readonly fallback?: AppearanceProfile }

export interface AppearanceInput {
  readonly theme: ThemeData
  readonly themeKind: ThemeKind
  readonly editorFont: EditorFontSettings
  readonly settings: PerwriteSettings
  readonly version?: number
  readonly fixed?: AppearanceFixedValues
}

/** ホストが送る入力集合。UI 色と themeKind は含まない ( 正本は webview の DOM 側にある )。 */
export interface AppearanceHostSources {
  readonly version: number
  readonly settings: Result<ResolvedAppearanceSettings>
  readonly fallbackFont: Partial<EditorFontSettings>
  readonly tokenTheme: Result<TokenThemeData>
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function appearanceSourceIdentity(sources: AppearanceHostSources): string {
  return canonicalJson(sources)
}

/** webview の DOM から adapter が読み取った UI 色と themeKind。 */
export interface AppearanceDomInput {
  readonly colors: Readonly<Record<string, string>>
  readonly themeKind: ThemeKind
}

const LIGHT_PALETTE = {
  'editor.background': '#ffffff', 'editor.foreground': '#333333', descriptionForeground: '#717171',
  'editorCursor.foreground': '#000000', 'editor.selectionBackground': '#add6ff', 'editorGutter.background': '#ffffff',
  'editorLineNumber.foreground': '#237893', 'editorLineNumber.activeForeground': '#0b216f', 'editorGroup.border': '#d4d4d4',
  'toolbar.hoverBackground': '#b8b8b850', errorForeground: '#a1260d', 'inputValidation.errorBackground': '#f2dede',
  'inputValidation.errorBorder': '#be1100', 'textLink.foreground': '#006ab1', 'textBlockQuote.border': '#007acc',
  'textBlockQuote.foreground': '#333333', 'input.background': '#ffffff', 'input.foreground': '#333333',
  'input.border': '#cecece', focusBorder: '#0090f1', 'editor.findMatchHighlightBackground': '#ea5c0055',
  'editor.findMatchBackground': '#a8ac94', 'scrollbarSlider.background': '#64646466',
  'scrollbarSlider.hoverBackground': '#646464b3', 'sideBar.background': '#f3f3f3',
  'diffEditor.removedLineBackground': '#ff000033', 'diffEditor.insertedLineBackground': '#00aa0033',
} as const

const DARK_PALETTE = {
  'editor.background': '#1e1e1e', 'editor.foreground': '#d4d4d4', descriptionForeground: '#888888',
  'editorCursor.foreground': '#aeafad', 'editor.selectionBackground': '#264f78', 'editorGutter.background': '#1e1e1e',
  'editorLineNumber.foreground': '#858585', 'editorLineNumber.activeForeground': '#c6c6c6', 'editorGroup.border': '#444444',
  'toolbar.hoverBackground': '#7f7f7f26', errorForeground: '#f48771', 'inputValidation.errorBackground': '#5a1d1d',
  'inputValidation.errorBorder': '#be1100', 'textLink.foreground': '#3794ff', 'textBlockQuote.border': '#555555',
  'textBlockQuote.foreground': '#d4d4d4', 'input.background': '#3c3c3c', 'input.foreground': '#cccccc',
  'input.border': '#444444', focusBorder: '#007fd4', 'editor.findMatchHighlightBackground': '#ea5c0055',
  'editor.findMatchBackground': '#515c6a', 'scrollbarSlider.background': '#79797966',
  'scrollbarSlider.hoverBackground': '#646464b3', 'sideBar.background': '#252526',
  'diffEditor.removedLineBackground': '#ff000033', 'diffEditor.insertedLineBackground': '#00ff0033',
} as const

export function fallbackPalette(kind: ThemeKind): Readonly<Record<string, string>> {
  return kind === 'light' || kind === 'hc-light' ? LIGHT_PALETTE : DARK_PALETTE
}

const LIGHT_TOKEN_COLORS: readonly unknown[] = [
  { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: '#008000' } },
  { scope: ['string', 'punctuation.definition.string'], settings: { foreground: '#a31515' } },
  { scope: ['constant.numeric', 'constant.language'], settings: { foreground: '#098658' } },
  { scope: ['keyword', 'storage', 'storage.type'], settings: { foreground: '#0000ff' } },
  { scope: ['entity.name.function', 'support.function'], settings: { foreground: '#795e26' } },
  { scope: ['entity.name.type', 'entity.name.class', 'support.type'], settings: { foreground: '#267f99' } },
  { scope: ['variable', 'meta.definition.variable.name'], settings: { foreground: '#001080' } },
]

const DARK_TOKEN_COLORS: readonly unknown[] = [
  { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: '#6a9955' } },
  { scope: ['string', 'punctuation.definition.string'], settings: { foreground: '#ce9178' } },
  { scope: ['constant.numeric', 'constant.language'], settings: { foreground: '#b5cea8' } },
  { scope: ['keyword', 'storage', 'storage.type'], settings: { foreground: '#569cd6' } },
  { scope: ['entity.name.function', 'support.function'], settings: { foreground: '#dcdcaa' } },
  { scope: ['entity.name.type', 'entity.name.class', 'support.type'], settings: { foreground: '#4ec9b0' } },
  { scope: ['variable', 'meta.definition.variable.name'], settings: { foreground: '#9cdcfe' } },
]

/** token 色を解決できない環境で使う組み込みの TokenThemeData。 */
export function builtinTokenTheme(kind: ThemeKind): TokenThemeData {
  const light = kind === 'light' || kind === 'hc-light'
  return {
    name: light ? 'perwrite-builtin-light' : 'perwrite-builtin-dark',
    type: light ? 'light' : 'dark',
    tokenColors: light ? LIGHT_TOKEN_COLORS : DARK_TOKEN_COLORS,
    semanticTokenColors: {},
    semanticHighlighting: false,
  }
}

interface Rgba { readonly r: number; readonly g: number; readonly b: number; readonly a: number }

function parseHexColor(value: string): Rgba | null {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value)
  if (!match) return null
  return {
    r: Number.parseInt(match[1].slice(0, 2), 16),
    g: Number.parseInt(match[1].slice(2, 4), 16),
    b: Number.parseInt(match[1].slice(4, 6), 16),
    a: match[2] ? Number.parseInt(match[2], 16) / 255 : 1,
  }
}

function toHex(color: Pick<Rgba, 'r' | 'g' | 'b'>): string {
  const component = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
  return `#${component(color.r)}${component(color.g)}${component(color.b)}`
}

function composite(foreground: Rgba, background: Rgba): Rgba {
  return {
    r: foreground.r * foreground.a + background.r * (1 - foreground.a),
    g: foreground.g * foreground.a + background.g * (1 - foreground.a),
    b: foreground.b * foreground.a + background.b * (1 - foreground.a),
    a: 1,
  }
}

function normalizeColors(theme: ThemeData, kind: ThemeKind): Record<string, string> {
  const palette = fallbackPalette(kind)
  const fallbackBackground = parseHexColor(palette['editor.background'])!
  const rawBackground = theme.colors['editor.background'] ?? palette['editor.background']
  const background = composite(parseHexColor(rawBackground)!, fallbackBackground)
  const normalized: Record<string, string> = { 'editor.background': toHex(background) }
  const sources = colorSourceTokens()
  const inheritEditorBackground = new Set(['editorGutter.background'])
  for (const source of sources) {
    if (source === 'editor.background') continue
    if (theme.colors[source] === undefined && inheritEditorBackground.has(source)) {
      normalized[source] = toHex(background)
      continue
    }
    const raw = theme.colors[source] ?? palette[source]
    if (raw === undefined) continue
    normalized[source] = toHex(composite(parseHexColor(raw)!, background))
  }
  return normalized
}

interface Hsb { h: number; s: number; b: number }
function rgbToHsb(color: Rgba): Hsb {
  const r = color.r / 255; const g = color.g / 255; const b = color.b / 255
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const delta = max - min
  let h = 0
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : delta / max, b: max }
}
function hsbToRgb(value: Hsb): Rgba {
  const c = value.b * value.s; const x = c * (1 - Math.abs(((value.h / 60) % 2) - 1)); const m = value.b - c
  let rgb: readonly [number, number, number]
  if (value.h < 60) rgb = [c, x, 0]
  else if (value.h < 120) rgb = [x, c, 0]
  else if (value.h < 180) rgb = [0, c, x]
  else if (value.h < 240) rgb = [0, x, c]
  else if (value.h < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return { r: (rgb[0] + m) * 255, g: (rgb[1] + m) * 255, b: (rgb[2] + m) * 255, a: 1 }
}
function luminance(color: Rgba): number {
  const values = [color.r, color.g, color.b].map(value => {
    const channel = value / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2]
}
function apca(first: number, second: number): number {
  const clamp = (value: number) => value > 0.022 ? value : value + (0.022 - value) ** 1.414
  const a = clamp(first); const b = clamp(second)
  if (Math.abs(a - b) < 0.0005) return 0
  return Math.abs(a > b ? a ** 0.56 - b ** 0.57 : a ** 0.65 - b ** 0.62) * 114
}
function codeBackground(backgroundHex: string, kind: ThemeKind): string {
  const background = parseHexColor(backgroundHex)!
  const hsb = rgbToHsb(background); const backgroundLuminance = luminance(background)
  const directions = kind === 'light' || kind === 'hc-light' ? [1, -1] : [-1, 1]
  for (const direction of directions) {
    let low = 0.01; let high = 0.3; let selected: number | undefined
    for (let index = 0; index < 20; index++) {
      const shift = (low + high) / 2
      const brightness = Math.max(0, Math.min(1, hsb.b + direction * shift))
      const contrast = apca(backgroundLuminance, luminance(hsbToRgb({ ...hsb, b: brightness })))
      if (contrast >= 5) { selected = brightness; high = shift } else low = shift
    }
    if (selected !== undefined) return toHex(hsbToRgb({ ...hsb, b: selected }))
  }
  return backgroundHex
}
function blend(firstHex: string, secondHex: string, ratio: number): string {
  const first = parseHexColor(firstHex)!; const second = parseHexColor(secondHex)!
  return toHex({ r: first.r * (1 - ratio) + second.r * ratio, g: first.g * (1 - ratio) + second.g * ratio, b: first.b * (1 - ratio) + second.b * ratio })
}

export function resolveAppearanceProfile(input: AppearanceInput): Result<AppearanceProfile> {
  const settings = validatePerwriteSettings(input.settings as unknown as Record<string, unknown>)
  if (!settings.ok) return settings
  const font = validateEditorFont(input.editorFont.family, input.editorFont.size)
  if (!font.ok) return font
  const colors = { ok: true as const, value: normalizeColors(input.theme, input.themeKind) }
  const headingScales = [
    settings.value.heading1Scale, settings.value.heading2Scale, settings.value.heading3Scale,
    settings.value.heading4Scale, settings.value.heading5Scale, settings.value.heading6Scale,
  ] as const
  const fixed = input.fixed ?? DEFAULT_APPEARANCE_FIXED_VALUES
  const sourceValue = (source: string): string | number => {
    if (source === 'editor.fontFamily') return font.value.family
    if (source === 'editor.fontSize') return font.value.size
    if (source.startsWith('perwrite.heading') && source.endsWith('Scale')) {
      return headingScales[Number(source.match(/\d/)![0]) - 1]
    }
    if (source.startsWith('perwrite.')) {
      const name = source.slice('perwrite.'.length) as keyof PerwriteSettings
      return settings.value[name]
    }
    const fixedSources: Record<string, number> = {
      'fixed.gutterCompactGapPx': fixed.gutterCompactGapPx,
      'fixed.mermaidBlockBorderPx': fixed.mermaidBlockBorderPx,
    }
    if (source in fixedSources) return fixedSources[source]
    throw new Error(`Unknown appearance source: ${source}`)
  }
  const css: Partial<Record<PerwriteCssVariableName, string>> = {}
  const metricValues: Partial<Record<AppearanceMetricName, AppearanceMetrics[AppearanceMetricName]>> = {}
  for (const assignment of appearanceAssignments) {
    let value: string | number | AppearanceMetrics['headingScales']
    if (assignment.transform === 'color') value = colors.value[assignment.sources[0]]!
    else if (assignment.transform === 'code-background') value = codeBackground(colors.value['editor.background'], input.themeKind)
    else if (assignment.transform === 'diff-code-background') {
      value = blend(
        codeBackground(colors.value['editor.background'], input.themeKind),
        colors.value[assignment.sources[1]]!,
        0.5,
      )
    }
    else if (assignment.transform === 'target-line-background') {
      value = blend(colors.value['editor.background'], colors.value['editor.findMatchHighlightBackground']!, 0.35)
    }
    else if (assignment.transform === 'table-background') {
      const tableSource = input.theme.colors['sideBar.background'] !== undefined
        ? colors.value['sideBar.background']
        : input.theme.colors['list.hoverBackground'] !== undefined
          ? colors.value['list.hoverBackground']
          : colors.value['sideBar.background'] ?? colors.value['editor.background']
      value = blend(colors.value['editor.background'], tableSource, 0.3)
    } else if (assignment.transform === 'product') {
      value = Number(sourceValue(assignment.sources[0])) * Number(sourceValue(assignment.sources[1]))
    } else if (assignment.transform === 'table-row') {
      value = Number(sourceValue(assignment.sources[0])) * Number(sourceValue(assignment.sources[1]))
        + 2 * Number(sourceValue(assignment.sources[2]))
    } else if (assignment.transform === 'heading-tuple') {
      value = assignment.sources.map(source => Number(sourceValue(source))) as unknown as AppearanceMetrics['headingScales']
    } else value = sourceValue(assignment.sources[0])

    if (assignment.destination.kind === 'metric') {
      metricValues[assignment.destination.name] = value as never
    } else if (assignment.transform === 'css-value') {
      const source = assignment.sources[0]
      const unitless = source === 'perwrite.lineHeight' || source.includes('heading')
      css[assignment.destination.name] = typeof value === 'number' && !unitless ? `${value}px` : String(value)
    } else {
      css[assignment.destination.name] = String(value)
    }
  }
  const metrics = metricValues as AppearanceMetrics
  const normalizedTheme: ThemeData = { ...input.theme, colors: { ...input.theme.colors, ...colors.value } }
  return {
    ok: true,
    value: {
      version: input.version ?? 0,
      cssVariables: css as PerwriteCssVariables,
      theme: normalizedTheme,
      themeKind: input.themeKind,
      metrics,
    },
  }
}

// colors を与えた場合は DOM 由来の実テーマ色を UI 色に使う。token 色は組み込み ( kind 別 ) を使う。
export function createFallbackProfile(
  themeKind: ThemeKind,
  editorFont: Partial<EditorFontSettings> = {},
  version = 0,
  colors?: Readonly<Record<string, string>>,
): AppearanceProfile {
  const font = validateEditorFont(editorFont.family, editorFont.size)
  const selectedFont = font.ok ? font.value : { family: 'Consolas, Monaco, monospace', size: 14 }
  const light = themeKind === 'light' || themeKind === 'hc-light'
  const tokens = builtinTokenTheme(themeKind)
  const theme: ThemeData = {
    name: light ? 'perwrite-fallback-light' : 'perwrite-fallback-dark',
    type: light ? 'light' : 'dark',
    colors: colors ?? fallbackPalette(themeKind),
    tokenColors: tokens.tokenColors,
    semanticTokenColors: tokens.semanticTokenColors,
    semanticHighlighting: tokens.semanticHighlighting,
  }
  const profile = resolveAppearanceProfile({ theme, themeKind, editorFont: selectedFont, settings: defaultPerwriteSettings(), version })
  if (!profile.ok) throw new Error(profile.error)
  return profile.value
}

// ホスト入力 ( 設定・token 色・版数 ) と DOM 入力 ( UI 色・themeKind ) から AppearanceResolution を導く。
export function resolveAppearanceSources(
  sources: AppearanceHostSources,
  dom: AppearanceDomInput,
): AppearanceResolution {
  const tokens = sources.tokenTheme.ok
    ? { theme: sources.tokenTheme.value, reason: null as string | null }
    : { theme: builtinTokenTheme(dom.themeKind), reason: sources.tokenTheme.error }
  if (!sources.settings.ok) {
    return {
      ok: false,
      error: sources.settings.error,
      fallback: createFallbackProfile(dom.themeKind, sources.fallbackFont, sources.version, dom.colors),
    }
  }
  const theme: ThemeData = {
    name: tokens.theme.name,
    type: tokens.theme.type,
    colors: dom.colors,
    tokenColors: tokens.theme.tokenColors,
    semanticTokenColors: tokens.theme.semanticTokenColors,
    semanticHighlighting: tokens.theme.semanticHighlighting,
  }
  const profile = resolveAppearanceProfile({
    theme, themeKind: dom.themeKind, editorFont: sources.settings.value.editorFont,
    settings: sources.settings.value.perwrite, version: sources.version,
  })
  if (!profile.ok) {
    return {
      ok: false, error: profile.error,
      fallback: createFallbackProfile(dom.themeKind, sources.fallbackFont, sources.version, dom.colors),
    }
  }
  return tokens.reason
    ? { ok: true, profile: profile.value, notice: `Syntax theme colors unavailable: ${tokens.reason}` }
    : { ok: true, profile: profile.value }
}
