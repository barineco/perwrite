import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import {
  PERWRITE_CSS_VARIABLE_NAMES,
  appearanceAssignments,
  DEFAULT_APPEARANCE_FIXED_VALUES,
  fallbackPalette,
  createFallbackProfile,
  resolveAppearanceProfile,
  type AppearanceInput,
  type ThemeKind,
} from '../src/appearance-profile'
import { defaultPerwriteSettings, PERWRITE_SETTING_SCHEMA, validatePerwriteSettings } from '../src/settings-resolver'
import type { ThemeData } from '../src/appearance-profile'

const EXPECTED_CSS_VARIABLES = [
  '--perwrite-editor-background', '--perwrite-editor-foreground', '--perwrite-muted-foreground',
  '--perwrite-cursor-foreground', '--perwrite-selection-background', '--perwrite-gutter-background',
  '--perwrite-gutter-foreground', '--perwrite-gutter-active-foreground', '--perwrite-border',
  '--perwrite-hover-background', '--perwrite-error-foreground', '--perwrite-error-background',
  '--perwrite-error-border', '--perwrite-link-foreground', '--perwrite-blockquote-border',
  '--perwrite-blockquote-foreground', '--perwrite-input-background', '--perwrite-input-foreground',
  '--perwrite-input-border', '--perwrite-focus-border', '--perwrite-find-match-highlight',
  '--perwrite-find-match-selected', '--perwrite-scrollbar-background', '--perwrite-scrollbar-hover-background',
  '--perwrite-diff-removed-background', '--perwrite-diff-inserted-background',
  '--perwrite-codeblock-background', '--perwrite-table-header-background',
  '--perwrite-diff-inserted-codeblock-background', '--perwrite-diff-removed-codeblock-background',
  '--perwrite-target-line-background',
  '--perwrite-font-family',
  '--perwrite-font-size', '--perwrite-line-height', '--perwrite-editor-width', '--perwrite-content-padding',
  '--perwrite-block-padding', '--perwrite-gutter-gap', '--perwrite-gutter-compact-gap',
  '--perwrite-math-block-padding', '--perwrite-heading-1-scale', '--perwrite-heading-2-scale',
  '--perwrite-heading-3-scale', '--perwrite-heading-4-scale', '--perwrite-heading-5-scale',
  '--perwrite-heading-6-scale', '--perwrite-heading-1-line-height', '--perwrite-heading-2-line-height',
  '--perwrite-heading-3-line-height', '--perwrite-heading-4-line-height', '--perwrite-heading-5-line-height',
  '--perwrite-heading-6-line-height',
  '--perwrite-table-cell-block-padding', '--perwrite-table-cell-inline-padding',
  '--perwrite-table-widget-block-padding',
  '--perwrite-mermaid-block-padding', '--perwrite-mermaid-block-border',
] as const

function theme(kind: ThemeKind = 'dark'): ThemeData {
  const palette = fallbackPalette(kind)
  return {
    name: 'sample', type: kind.includes('light') ? 'light' : 'dark', colors: palette,
    tokenColors: [{ scope: 'keyword', settings: { foreground: '#ff0000' } }],
    semanticTokenColors: {}, semanticHighlighting: false,
  }
}

function input(kind: ThemeKind = 'dark'): AppearanceInput {
  return {
    theme: theme(kind), themeKind: kind,
    editorFont: { family: 'Sample Mono', size: 14 },
    settings: defaultPerwriteSettings(), version: 3,
  }
}

describe('appearance profile', () => {
  it('has exactly the required CSS variable set', () => {
    expect([...PERWRITE_CSS_VARIABLE_NAMES].sort()).toEqual([...EXPECTED_CSS_VARIABLES].sort())
    const resolved = resolveAppearanceProfile(input())
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(Object.keys(resolved.value.cssVariables).sort()).toEqual([...EXPECTED_CSS_VARIABLES].sort())
  })

  it('preserves unrelated outputs for a single setting change', () => {
    const original = resolveAppearanceProfile(input())
    const changedInput = input()
    changedInput.settings = { ...changedInput.settings, editorWidth: 1200 }
    const changed = resolveAppearanceProfile(changedInput)
    expect(original.ok && changed.ok).toBe(true)
    if (!original.ok || !changed.ok) return
    const differences = EXPECTED_CSS_VARIABLES.filter(name => original.value.cssVariables[name] !== changed.value.cssVariables[name])
    expect(differences).toEqual(['--perwrite-editor-width'])
    expect(changed.value.metrics).toEqual(original.value.metrics)
  })

  it('preserves undeclared CSS destinations for every mutable profile source', () => {
    const mutations: Array<[string, (value: AppearanceInput) => void]> = [
      ['editor.fontFamily', value => { value.editorFont = { ...value.editorFont, family: 'Changed Mono' } }],
      ['editor.fontSize', value => { value.editorFont = { ...value.editorFont, size: 18 } }],
      ...Object.keys(PERWRITE_SETTING_SCHEMA).map(name => [
        `perwrite.${name}`,
        (value: AppearanceInput) => {
          const schema = PERWRITE_SETTING_SCHEMA[name as keyof typeof PERWRITE_SETTING_SCHEMA]
          value.settings = { ...value.settings, [name]: schema.default === schema.minimum ? schema.maximum : schema.minimum }
        },
      ] as [string, (value: AppearanceInput) => void]),
    ]
    for (const [source, mutate] of mutations) {
      const before = resolveAppearanceProfile(input())
      const changedInput = input()
      mutate(changedInput)
      const after = resolveAppearanceProfile(changedInput)
      expect(before.ok && after.ok, source).toBe(true)
      if (!before.ok || !after.ok) continue
      const expected = appearanceAssignments.filter(item => item.sources.includes(source)).map(item =>
        `${item.destination.kind}:${item.destination.name}`,
      ).sort()
      const differences = [
        ...EXPECTED_CSS_VARIABLES.filter(name => before.value.cssVariables[name] !== after.value.cssVariables[name]).map(name => `css:${name}`),
        ...Object.keys(before.value.metrics).filter(name =>
          JSON.stringify(before.value.metrics[name as keyof typeof before.value.metrics])
            !== JSON.stringify(after.value.metrics[name as keyof typeof after.value.metrics]),
        ).map(name => `metric:${name}`),
      ].sort()
      expect(differences, source).toEqual(expected)
      expect(after.value.theme).toEqual(before.value.theme)
    }
  })

  it('preserves undeclared CSS destinations for every Workbench color source', () => {
    const sources = [...new Set(appearanceAssignments.flatMap(item => item.sources)
      .filter(source => !source.startsWith('perwrite.') && !source.startsWith('editor.font') && !source.startsWith('fixed.')))]
    for (const source of sources) {
      const beforeInput = input()
      const beforeColors = Object.fromEntries(
        [...new Set(appearanceAssignments.flatMap(item => item.sources))]
          .filter(item => !item.startsWith('perwrite.') && !item.startsWith('editor.font') && !item.startsWith('fixed.'))
          .map(item => [item, item === 'editor.background' ? '#202020' : '#abcdef80']),
      )
      delete beforeColors['sideBar.background']
      delete beforeColors['list.hoverBackground']
      beforeInput.theme = { ...beforeInput.theme, colors: beforeColors }
      const changedInput = { ...beforeInput, theme: { ...beforeInput.theme, colors: { ...beforeColors, [source]: source === 'editor.background' ? '#404040' : '#12345680' } } }
      const before = resolveAppearanceProfile(beforeInput)
      const after = resolveAppearanceProfile(changedInput)
      expect(before.ok && after.ok, source).toBe(true)
      if (!before.ok || !after.ok) continue
      const allowed = appearanceAssignments.filter(item => item.sources.includes(source) && item.destination.kind === 'css')
        .map(item => item.destination.kind === 'css' ? item.destination.name : '').sort()
      const differences = EXPECTED_CSS_VARIABLES.filter(name => before.value.cssVariables[name] !== after.value.cssVariables[name])
      expect(differences.sort(), source).toEqual(allowed)
      expect(after.value.metrics).toEqual(before.value.metrics)
    }
  })

  it('changes exactly the declared destinations for every fixed source', () => {
    const sources = [...new Set(appearanceAssignments.flatMap(item => item.sources).filter(source => source.startsWith('fixed.')))]
    expect(sources.sort()).toEqual(['fixed.gutterCompactGapPx', 'fixed.mermaidBlockBorderPx'])
    for (const source of sources) {
      const before = resolveAppearanceProfile(input())
      const changedInput = input()
      const fixed = { ...DEFAULT_APPEARANCE_FIXED_VALUES }
      const name = source.slice('fixed.'.length) as keyof typeof fixed
      fixed[name] = Number(fixed[name]) + 1
      changedInput.fixed = fixed
      const after = resolveAppearanceProfile(changedInput)
      expect(before.ok && after.ok, source).toBe(true)
      if (!before.ok || !after.ok) continue
      const actual = [
        ...EXPECTED_CSS_VARIABLES.filter(name => before.value.cssVariables[name] !== after.value.cssVariables[name]).map(name => `css:${name}`),
        ...Object.keys(before.value.metrics).filter(name =>
          JSON.stringify(before.value.metrics[name as keyof typeof before.value.metrics])
            !== JSON.stringify(after.value.metrics[name as keyof typeof after.value.metrics]),
        ).map(name => `metric:${name}`),
      ].sort()
      const expected = appearanceAssignments.filter(item => item.sources.includes(source))
        .map(item => `${item.destination.kind}:${item.destination.name}`).sort()
      expect(actual, source).toEqual(expected)
    }
  })

  it('normalizes alpha against the fallback then editor background', () => {
    const appearanceInput = input('light')
    appearanceInput.theme = {
      ...appearanceInput.theme,
      colors: { ...appearanceInput.theme.colors, 'editor.background': '#00000080', 'sideBar.background': '#ff000080' },
    }
    const resolved = resolveAppearanceProfile(appearanceInput)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.value.cssVariables['--perwrite-editor-background']).toBe('#7f7f7f')
    expect(resolved.value.theme.colors['editor.background']).toBe('#7f7f7f')
    expect(resolved.value.theme.colors['sideBar.background']).toBe('#bf3f3f')
  })

  it('derives each light, dark, high-contrast, and fallback target line at 65:35', () => {
    for (const kind of ['light', 'dark', 'hc-light', 'hc-dark'] as const) {
      const appearanceInput = input(kind)
      appearanceInput.theme = { ...appearanceInput.theme, colors: { ...appearanceInput.theme.colors, 'editor.background': '#000000', 'editor.findMatchHighlightBackground': '#ffffff' } }
      const resolved = resolveAppearanceProfile(appearanceInput)
      expect(resolved.ok, kind).toBe(true)
      if (resolved.ok) expect(resolved.value.cssVariables['--perwrite-target-line-background'], kind).toBe('#595959')
      expect(createFallbackProfile(kind).cssVariables['--perwrite-target-line-background'], `${kind} fallback`).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('derives inserted and removed inline code backgrounds as independent RGB averages', () => {
    const appearanceInput = input('dark')
    appearanceInput.theme = {
      ...appearanceInput.theme,
      colors: {
        ...appearanceInput.theme.colors,
        'editor.background': '#204060',
        'diffEditor.insertedLineBackground': '#40c020',
        'diffEditor.removedLineBackground': '#e020a0',
      },
    }
    const resolved = resolveAppearanceProfile(appearanceInput)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return

    const codeblock = resolved.value.cssVariables['--perwrite-codeblock-background']
    const average = (first: string, second: string) => {
      const channels = [1, 3, 5].map(index =>
        Math.round((Number.parseInt(first.slice(index, index + 2), 16) + Number.parseInt(second.slice(index, index + 2), 16)) / 2),
      )
      return `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`
    }
    expect(resolved.value.cssVariables['--perwrite-diff-inserted-codeblock-background'])
      .toBe(average(codeblock, '#40c020'))
    expect(resolved.value.cssVariables['--perwrite-diff-removed-codeblock-background'])
      .toBe(average(codeblock, '#e020a0'))
  })

  it('derives default dimensions and widget metrics once', () => {
    const resolved = resolveAppearanceProfile(input())
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.value.cssVariables['--perwrite-line-height']).toBe('2')
    expect(resolved.value.cssVariables['--perwrite-editor-width']).toBe('960px')
    expect(resolved.value.metrics).toEqual({
      fontSizePx: 14, lineHeightMultiplier: 2, lineHeightPx: 28,
      blockPaddingPx: 16, mathBlockPaddingPx: 8, tableRowHeightPx: 40,
      tableCellBlockPaddingPx: 6, tableCellInlinePaddingPx: 12,
      tableWidgetBlockPaddingPx: 8,
      mermaidBlockPaddingPx: 8, mermaidBlockBorderPx: 1,
      headingScales: [2, 1.6, 1.4, 1.1, 1, 1],
    })
    expect(resolved.value.cssVariables['--perwrite-mermaid-block-padding']).toBe('8px')
    expect(resolved.value.cssVariables['--perwrite-mermaid-block-border']).toBe('1px')
  })

  it('resolves an invalid setting to a typed failure and a declared fallback profile', () => {
    const appearanceInput = input('dark')
    appearanceInput.settings = { ...appearanceInput.settings, lineHeight: Number.NaN }
    const resolution = resolveAppearanceProfile(appearanceInput)
    expect(resolution.ok).toBe(false)
    const expected = createFallbackProfile('dark', {}, 3)
    expect(expected.theme).toMatchObject({
      name: 'perwrite-fallback-dark', type: 'dark',
      semanticTokenColors: {}, semanticHighlighting: false,
    })
    expect(expected.theme.tokenColors.length).toBeGreaterThan(0)
  })

  it('uses the concrete light, dark, and high-contrast fallback profiles', () => {
    for (const [kind, name, background, foreground] of [
      ['light', 'perwrite-fallback-light', '#ffffff', '#333333'],
      ['hc-light', 'perwrite-fallback-light', '#ffffff', '#333333'],
      ['dark', 'perwrite-fallback-dark', '#1e1e1e', '#d4d4d4'],
      ['hc-dark', 'perwrite-fallback-dark', '#1e1e1e', '#d4d4d4'],
    ] as const) {
      const profile = createFallbackProfile(kind, { family: '', size: Number.NaN })
      expect(profile.theme).toMatchObject({
        name, type: kind.includes('light') ? 'light' : 'dark',
        semanticTokenColors: {}, semanticHighlighting: false,
      })
      expect(profile.theme.tokenColors.length).toBeGreaterThan(0)
      expect(profile.cssVariables['--perwrite-editor-background']).toBe(background)
      expect(profile.cssVariables['--perwrite-editor-foreground']).toBe(foreground)
      expect(profile.cssVariables['--perwrite-font-family']).toBe('Consolas, Monaco, monospace')
      expect(profile.cssVariables['--perwrite-font-size']).toBe('14px')
      expect(Object.keys(profile.cssVariables)).toHaveLength(EXPECTED_CSS_VARIABLES.length)
    }
  })

  it('derives an absent gutter background from the resolved editor background', () => {
    const derivedInput = input()
    const { 'editorGutter.background': _gutter, ...withoutGutter } = derivedInput.theme.colors
    derivedInput.theme = { ...derivedInput.theme, colors: { ...withoutGutter, 'editor.background': '#282c34' } }
    const derived = resolveAppearanceProfile(derivedInput)
    expect(derived.ok).toBe(true)
    if (derived.ok) {
      expect(derived.value.cssVariables['--perwrite-gutter-background']).toBe('#282c34')
      expect(derived.value.cssVariables['--perwrite-editor-background']).toBe('#282c34')
    }

    const explicitInput = input()
    explicitInput.theme = {
      ...explicitInput.theme,
      colors: { ...explicitInput.theme.colors, 'editor.background': '#282c34', 'editorGutter.background': '#21252b' },
    }
    const explicit = resolveAppearanceProfile(explicitInput)
    expect(explicit.ok).toBe(true)
    if (explicit.ok) expect(explicit.value.cssVariables['--perwrite-gutter-background']).toBe('#21252b')
  })
})

describe('published settings', () => {
  it('uses the published default values for the primary appearance settings', () => {
    expect(defaultPerwriteSettings()).toMatchObject({
      heading1Scale: 2, heading2Scale: 1.6, heading3Scale: 1.4, lineHeight: 2, editorWidth: 960,
    })
    expect(PERWRITE_SETTING_SCHEMA).toMatchObject({
      heading1Scale: { default: 2 }, heading2Scale: { default: 1.6 }, heading3Scale: { default: 1.4 },
      lineHeight: { default: 2 }, editorWidth: { default: 960 },
    })
  })

  it('matches package schema independently', () => {
    const packagePath = fileURLToPath(new URL('../package.json', import.meta.url))
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as any
    const properties = packageJson.contributes.configuration.properties
    const names = Object.keys(PERWRITE_SETTING_SCHEMA)
    expect(names).toHaveLength(22)
    for (const name of names) {
      const schema = PERWRITE_SETTING_SCHEMA[name as keyof typeof PERWRITE_SETTING_SCHEMA]
      expect(properties[`perwrite.${name}`]).toMatchObject({
        type: 'number', default: schema.default, minimum: schema.minimum, maximum: schema.maximum,
      })
      expect(properties[`perwrite.${name}`].description.length).toBeGreaterThan(0)
    }
  })

  it('declares workspace and UI placement for the main extension', () => {
    const packagePath = fileURLToPath(new URL('../package.json', import.meta.url))
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as any
    expect(packageJson.extensionKind).toEqual(['workspace', 'ui'])
    expect(packageJson.extensionDependencies).toEqual(['barineco.perwrite-theme-source'])
  })

  it('rejects non-finite and out-of-range values', () => {
    for (const [name, schema] of Object.entries(PERWRITE_SETTING_SCHEMA)) {
      for (const value of [Number.NaN, Number.POSITIVE_INFINITY, schema.minimum - 0.01, schema.maximum + 0.01]) {
        const result = validatePerwriteSettings({ ...defaultPerwriteSettings(), [name]: value })
        expect(result.ok, `${name}=${value}`).toBe(false)
      }
    }
  })
})
