import type { EditorConfiguration, Result, ViewMode } from './protocol'

export const VIEW_MODES: readonly ViewMode[] = ['raw', 'rich', 'render']
export const DEFAULT_VIEW_MODE: ViewMode = 'render'
export const MERMAID_LAYOUTS = ['elk', 'dagre'] as const
export const EDITOR_CONFIGURATION_IDS = [
  'perwrite.defaultViewMode', 'perwrite.mermaidLayout', 'perwrite.mermaidMaxEdges',
  'perwrite.mermaidPanStep', 'perwrite.mermaidZoomStep', 'perwrite.texRendering', 'perwrite.codeBlockWrap',
] as const

export const MERMAID_SETTING_SCHEMA = {
  maxEdges: { default: 1024, minimum: 1, maximum: 4096, integer: true },
  panStep: { default: 80, minimum: 8, maximum: 320, integer: false },
  zoomStep: { default: 1.5, minimum: 1.1, maximum: 3, integer: false },
} as const

export function isEditorConfigurationChange(affectsConfiguration: (id: string) => boolean): boolean {
  return EDITOR_CONFIGURATION_IDS.some(affectsConfiguration)
}

export interface EditorConfigurationValues {
  readonly defaultViewMode: unknown
  readonly mermaidLayout: unknown
  readonly mermaidMaxEdges: unknown
  readonly mermaidPanStep: unknown
  readonly mermaidZoomStep: unknown
  readonly texRendering: unknown
  readonly codeBlockWrap: unknown
}

function validateMermaidNumber(
  name: 'maxEdges' | 'panStep' | 'zoomStep',
  value: unknown,
): Result<number> {
  const schema = MERMAID_SETTING_SCHEMA[name]
  if (typeof value !== 'number' || !Number.isFinite(value)
    || value < schema.minimum || value > schema.maximum
    || (schema.integer && !Number.isInteger(value))) {
    const quantity = schema.integer ? 'an integer value' : 'a value'
    return { ok: false, error: `Invalid perwrite.mermaid${name[0].toUpperCase()}${name.slice(1)}: expected ${quantity} in ${schema.minimum}..${schema.maximum}` }
  }
  return { ok: true, value }
}

export function validateEditorConfiguration(values: EditorConfigurationValues, generation = 0): Result<EditorConfiguration> {
  if (typeof values.defaultViewMode !== 'string'
    || !(VIEW_MODES as readonly string[]).includes(values.defaultViewMode)) {
    return { ok: false, error: 'Invalid perwrite.defaultViewMode: expected raw, rich, or render' }
  }
  if (typeof values.mermaidLayout !== 'string'
    || !(MERMAID_LAYOUTS as readonly string[]).includes(values.mermaidLayout)) {
    return { ok: false, error: 'Invalid perwrite.mermaidLayout: expected elk or dagre' }
  }
  if (typeof values.texRendering !== 'boolean') {
    return { ok: false, error: 'Invalid perwrite.texRendering: expected a boolean' }
  }
  const maxEdges = validateMermaidNumber('maxEdges', values.mermaidMaxEdges)
  if (!maxEdges.ok) return maxEdges
  const panStep = validateMermaidNumber('panStep', values.mermaidPanStep)
  if (!panStep.ok) return panStep
  const zoomStep = validateMermaidNumber('zoomStep', values.mermaidZoomStep)
  if (!zoomStep.ok) return zoomStep
  const codeBlockWrap = typeof values.codeBlockWrap === 'boolean' ? values.codeBlockWrap : true
  const configurationFailure = typeof values.codeBlockWrap === 'boolean'
    ? null
    : 'Invalid perwrite.codeBlockWrap: expected a boolean; using true'
  return {
    ok: true,
    value: {
      defaultViewMode: values.defaultViewMode as ViewMode,
      configurationFailure,
      rendering: {
        generation,
        codeBlockWrap,
        mermaidLayout: values.mermaidLayout as EditorConfiguration['rendering']['mermaidLayout'],
        mermaidMaxEdges: maxEdges.value,
        mermaidPanStep: panStep.value,
        mermaidZoomStep: zoomStep.value,
        texRendering: values.texRendering,
      },
    },
  }
}

export const PERWRITE_SETTING_SCHEMA = {
  lineHeight: { default: 2, minimum: 1, maximum: 3 },
  editorWidth: { default: 960, minimum: 480, maximum: 2400 },
  heading1Scale: { default: 2, minimum: 0.75, maximum: 4 },
  heading2Scale: { default: 1.6, minimum: 0.75, maximum: 4 },
  heading3Scale: { default: 1.4, minimum: 0.75, maximum: 4 },
  heading4Scale: { default: 1.1, minimum: 0.75, maximum: 4 },
  heading5Scale: { default: 1, minimum: 0.75, maximum: 4 },
  heading6Scale: { default: 1, minimum: 0.75, maximum: 4 },
  heading1LineHeight: { default: 1.3, minimum: 1, maximum: 3 },
  heading2LineHeight: { default: 1.35, minimum: 1, maximum: 3 },
  heading3LineHeight: { default: 1.5, minimum: 1, maximum: 3 },
  heading4LineHeight: { default: 1.7, minimum: 1, maximum: 3 },
  heading5LineHeight: { default: 1.8, minimum: 1, maximum: 3 },
  heading6LineHeight: { default: 1.8, minimum: 1, maximum: 3 },
  contentPadding: { default: 24, minimum: 0, maximum: 96 },
  blockPadding: { default: 16, minimum: 0, maximum: 96 },
  gutterGap: { default: 24, minimum: 0, maximum: 96 },
  mathBlockPadding: { default: 8, minimum: 0, maximum: 96 },
  tableCellBlockPadding: { default: 6, minimum: 0, maximum: 48 },
  tableCellInlinePadding: { default: 12, minimum: 0, maximum: 64 },
  tableWidgetBlockPadding: { default: 8, minimum: 0, maximum: 48 },
  mermaidBlockPadding: { default: 8, minimum: 0, maximum: 48 },
} as const

export type PerwriteSettingName = keyof typeof PERWRITE_SETTING_SCHEMA
export type PerwriteSettings = { readonly [K in PerwriteSettingName]: number }

export interface AppearanceConfigurationReader {
  get(section: string): unknown
}

export interface EditorFontSettings {
  readonly family: string
  readonly size: number
}

export interface ResolvedAppearanceSettings {
  readonly perwrite: PerwriteSettings
  readonly editorFont: EditorFontSettings
}

export function defaultPerwriteSettings(): PerwriteSettings {
  return Object.fromEntries(
    Object.entries(PERWRITE_SETTING_SCHEMA).map(([name, schema]) => [name, schema.default]),
  ) as unknown as PerwriteSettings
}

export function validatePerwriteSettings(values: Readonly<Record<string, unknown>>): Result<PerwriteSettings> {
  const resolved: Partial<Record<PerwriteSettingName, number>> = {}
  for (const [name, schema] of Object.entries(PERWRITE_SETTING_SCHEMA) as Array<
    [PerwriteSettingName, (typeof PERWRITE_SETTING_SCHEMA)[PerwriteSettingName]]
  >) {
    const value = values[name] ?? schema.default
    if (typeof value !== 'number' || !Number.isFinite(value)
      || value < schema.minimum || value > schema.maximum) {
      return { ok: false, error: `Invalid perwrite.${name}: expected ${schema.minimum}..${schema.maximum}` }
    }
    resolved[name] = value
  }
  return { ok: true, value: resolved as PerwriteSettings }
}

export function validateEditorFont(family: unknown, size: unknown): Result<EditorFontSettings> {
  if (typeof family !== 'string' || family.trim().length === 0) {
    return { ok: false, error: 'Invalid editor.fontFamily: expected a non-empty string' }
  }
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    return { ok: false, error: 'Invalid editor.fontSize: expected a positive finite number' }
  }
  return { ok: true, value: { family, size } }
}

export function readAppearanceSettings(reader: AppearanceConfigurationReader): Result<ResolvedAppearanceSettings> {
  const values: Record<string, unknown> = {}
  for (const name of Object.keys(PERWRITE_SETTING_SCHEMA) as PerwriteSettingName[]) {
    values[name] = reader.get(`perwrite.${name}`)
  }
  const perwrite = validatePerwriteSettings(values)
  if (!perwrite.ok) return perwrite
  const editorFont = validateEditorFont(reader.get('editor.fontFamily'), reader.get('editor.fontSize'))
  if (!editorFont.ok) return editorFont
  return { ok: true, value: { perwrite: perwrite.value, editorFont: editorFont.value } }
}
