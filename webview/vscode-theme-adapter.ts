import type { Result } from '../src/protocol'
import { colorSourceTokens, type ThemeKind } from '../src/appearance-profile'

export function vscodeColorSources(): readonly string[] {
  return colorSourceTokens()
}

export function vscodeVariableName(token: string): string {
  return `--vscode-${token.replace(/\./g, '-')}`
}

function toHexComponent(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
}

export function parseCssColorValue(value: string): Result<string> {
  const trimmed = value.trim()
  const hex = /^#([0-9a-f]{6}([0-9a-f]{2})?)$/i.exec(trimmed)
  if (hex) return { ok: true, value: `#${hex[1].toLowerCase()}` }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(trimmed)
  if (rgb) {
    const r = Number(rgb[1]); const g = Number(rgb[2]); const b = Number(rgb[3])
    if (![r, g, b].every(component => Number.isFinite(component) && component >= 0 && component <= 255)) {
      return { ok: false, error: `Invalid CSS color: ${value}` }
    }
    const base = `#${toHexComponent(r)}${toHexComponent(g)}${toHexComponent(b)}`
    if (rgb[4] === undefined) return { ok: true, value: base }
    const alpha = Number(rgb[4])
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) return { ok: false, error: `Invalid CSS color alpha: ${value}` }
    return { ok: true, value: `${base}${toHexComponent(alpha * 255)}` }
  }
  return { ok: false, error: `Invalid CSS color: ${value}` }
}

export interface ColorDecodeFailure {
  readonly source: string
  readonly variable: string
  readonly value: string
  readonly reason: string
}

export interface VscodeColorRead {
  readonly colors: Record<string, string>
  readonly failures: readonly ColorDecodeFailure[]
}

export function readVscodeColors(
  read: (variable: string) => string,
  sources: readonly string[] = vscodeColorSources(),
): VscodeColorRead {
  const colors: Record<string, string> = {}
  const failures: ColorDecodeFailure[] = []
  for (const source of sources) {
    const variable = vscodeVariableName(source)
    const raw = read(variable).trim()
    if (raw.length === 0) continue
    const parsed = parseCssColorValue(raw)
    if (!parsed.ok) { failures.push({ source, variable, value: raw, reason: parsed.error }); continue }
    colors[source] = parsed.value
  }
  return { colors, failures }
}

const THEME_KIND_BY_ATTRIBUTE: Readonly<Record<string, ThemeKind>> = {
  'vscode-light': 'light',
  'vscode-dark': 'dark',
  'vscode-high-contrast': 'hc-dark',
  'vscode-high-contrast-light': 'hc-light',
}

export type ThemeKindRead =
  | { readonly ok: true; readonly value: ThemeKind }
  | { readonly ok: false; readonly error: string; readonly attribute: string | null | undefined }

export function readThemeKind(attribute: string | null | undefined): ThemeKindRead {
  if (!attribute) return { ok: false, error: 'VS Code theme kind is missing', attribute }
  const value = THEME_KIND_BY_ATTRIBUTE[attribute]
  return value
    ? { ok: true, value }
    : { ok: false, error: `Unknown VS Code theme kind: ${attribute}`, attribute }
}

// Theme changes are read from the DOM at callback time; the element receiving Perwrite variables is not observed.
export function observeThemeDom(callback: () => void): () => void {
  if (typeof MutationObserver === 'undefined') return () => {}
  const attributeFilter = ['class', 'data-vscode-theme-kind', 'data-vscode-theme-name']
  const observer = new MutationObserver(() => callback())
  observer.observe(document.body, { attributes: true, attributeFilter })
  observer.observe(document.documentElement, { attributes: true, attributeFilter })
  return () => observer.disconnect()
}
