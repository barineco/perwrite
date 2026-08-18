import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VIEW_MODE,
  MERMAID_LAYOUTS,
  MERMAID_SETTING_SCHEMA,
  PERWRITE_SETTING_SCHEMA,
  defaultPerwriteSettings,
  validateEditorConfiguration,
  VIEW_MODES,
} from '../src/settings-resolver'

const mermaidSettings = {
  mermaidMaxEdges: MERMAID_SETTING_SCHEMA.maxEdges.default,
  mermaidPanStep: MERMAID_SETTING_SCHEMA.panStep.default,
  mermaidZoomStep: MERMAID_SETTING_SCHEMA.zoomStep.default,
}

describe('editor configuration', () => {
  it('declares the three view modes and render as the default', () => {
    expect(VIEW_MODES).toEqual(['raw', 'rich', 'render'])
    expect(DEFAULT_VIEW_MODE).toBe('render')
    expect(MERMAID_LAYOUTS).toEqual(['elk', 'dagre'])
  })

  it('Perwrite 固有設定の既定値を指定値へ解決する', () => {
    expect(defaultPerwriteSettings()).toEqual({
      lineHeight: 2,
      editorWidth: 960,
      heading1Scale: 2,
      heading2Scale: 1.6,
      heading3Scale: 1.4,
      heading4Scale: PERWRITE_SETTING_SCHEMA.heading4Scale.default,
      heading5Scale: PERWRITE_SETTING_SCHEMA.heading5Scale.default,
      heading6Scale: PERWRITE_SETTING_SCHEMA.heading6Scale.default,
      heading1LineHeight: PERWRITE_SETTING_SCHEMA.heading1LineHeight.default,
      heading2LineHeight: PERWRITE_SETTING_SCHEMA.heading2LineHeight.default,
      heading3LineHeight: PERWRITE_SETTING_SCHEMA.heading3LineHeight.default,
      heading4LineHeight: PERWRITE_SETTING_SCHEMA.heading4LineHeight.default,
      heading5LineHeight: PERWRITE_SETTING_SCHEMA.heading5LineHeight.default,
      heading6LineHeight: PERWRITE_SETTING_SCHEMA.heading6LineHeight.default,
      contentPadding: PERWRITE_SETTING_SCHEMA.contentPadding.default,
      blockPadding: PERWRITE_SETTING_SCHEMA.blockPadding.default,
      gutterGap: PERWRITE_SETTING_SCHEMA.gutterGap.default,
      mathBlockPadding: PERWRITE_SETTING_SCHEMA.mathBlockPadding.default,
      tableCellBlockPadding: PERWRITE_SETTING_SCHEMA.tableCellBlockPadding.default,
      tableCellInlinePadding: PERWRITE_SETTING_SCHEMA.tableCellInlinePadding.default,
      tableWidgetBlockPadding: PERWRITE_SETTING_SCHEMA.tableWidgetBlockPadding.default,
      mermaidBlockPadding: PERWRITE_SETTING_SCHEMA.mermaidBlockPadding.default,
    })
  })

  it.each([
    ['raw', 'elk', true],
    ['rich', 'dagre', false],
    ['render', 'elk', false],
  ] as const)('accepts %s, %s, %s', (defaultViewMode, mermaidLayout, texRendering) => {
    expect(validateEditorConfiguration({ defaultViewMode, mermaidLayout, ...mermaidSettings, texRendering, codeBlockWrap: true }, 4)).toEqual({
      ok: true,
      value: { defaultViewMode, configurationFailure: null, rendering: { generation: 4, codeBlockWrap: true, mermaidLayout, ...mermaidSettings, texRendering } },
    })
  })

  it.each([undefined, null, 1, 'true', {}])('codeBlockWrap %j を true と理由一件へ正規化する', (codeBlockWrap) => {
    expect(validateEditorConfiguration({ defaultViewMode: 'render', mermaidLayout: 'elk', ...mermaidSettings, texRendering: true, codeBlockWrap }, 2)).toEqual({
      ok: true,
      value: {
        defaultViewMode: 'render',
        configurationFailure: 'Invalid perwrite.codeBlockWrap: expected a boolean; using true',
        rendering: { generation: 2, codeBlockWrap: true, mermaidLayout: 'elk', ...mermaidSettings, texRendering: true },
      },
    })
  })

  it.each(['preview', 'live', 'source'])('rejects the former view mode %s', (defaultViewMode) => {
    expect(validateEditorConfiguration({ defaultViewMode, mermaidLayout: 'elk', ...mermaidSettings, texRendering: true, codeBlockWrap: true }))
      .toEqual({ ok: false, error: 'Invalid perwrite.defaultViewMode: expected raw, rich, or render' })
  })

  it.each([undefined, null, 1, true, 'other'])('rejects invalid defaultViewMode %j', (defaultViewMode) => {
    const result = validateEditorConfiguration({ defaultViewMode, mermaidLayout: 'elk', ...mermaidSettings, texRendering: true, codeBlockWrap: true })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('perwrite.defaultViewMode')
  })

  it.each([undefined, null, 1, true, 'other'])('rejects invalid mermaidLayout %j', (mermaidLayout) => {
    const result = validateEditorConfiguration({ defaultViewMode: 'render', mermaidLayout, ...mermaidSettings, texRendering: true, codeBlockWrap: true })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('perwrite.mermaidLayout')
  })

  it.each([undefined, null, 0, 1, 'true'])('rejects invalid texRendering %j', (texRendering) => {
    const result = validateEditorConfiguration({ defaultViewMode: 'render', mermaidLayout: 'elk', ...mermaidSettings, texRendering, codeBlockWrap: true })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('perwrite.texRendering')
  })

  it.each([
    ['mermaidMaxEdges', 1024.5],
    ['mermaidMaxEdges', 4097],
    ['mermaidPanStep', 7],
    ['mermaidZoomStep', 1],
  ] as const)('rejects invalid %s value %s', (name, value) => {
    const result = validateEditorConfiguration({
      defaultViewMode: 'render', mermaidLayout: 'elk', ...mermaidSettings, [name]: value,
      texRendering: true, codeBlockWrap: true,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain(`perwrite.${name}`)
  })
})
