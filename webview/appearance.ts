import {
  createFallbackProfile,
  resolveAppearanceSources,
  type AppearanceDomInput,
  type AppearanceHostSources,
  type AppearanceMetrics,
  type AppearanceProfile,
  type AppearanceResolution,
  type PerwriteCssVariables,
} from '../src/appearance-profile'
import { readThemeKind, readVscodeColors } from './vscode-theme-adapter'
import type { ColorDecodeFailure } from './vscode-theme-adapter'
import type { ThemeData } from '../src/appearance-profile'
import { invalidateMeasuredHeightCacheOnAppearanceChange } from './widget-height-cache'

export interface AppearanceDomRead {
  readonly input: AppearanceDomInput | null
  readonly colorFailures: readonly ColorDecodeFailure[]
  readonly themeKindFailure: string | null
}

export function readAppearanceDom(style: Pick<CSSStyleDeclaration, 'getPropertyValue'>, kindAttribute: string | null): AppearanceDomRead {
  const { colors, failures } = readVscodeColors(name => style.getPropertyValue(name))
  const themeKind = readThemeKind(kindAttribute)
  return {
    input: themeKind.ok ? { colors, themeKind: themeKind.value } : null,
    colorFailures: failures,
    themeKindFailure: themeKind.ok ? null : themeKind.error,
  }
}

export function resolveAppearanceFromDom(
  sources: AppearanceHostSources,
  style: Pick<CSSStyleDeclaration, 'getPropertyValue'>,
  kindAttribute: string | null,
): AppearanceResolution {
  const dom = readAppearanceDom(style, kindAttribute)
  if (!dom.input) {
    return { ok: false, error: dom.themeKindFailure ?? 'VS Code theme kind is unavailable' }
  }
  const resolution = resolveAppearanceSources(sources, dom.input)
  if (dom.colorFailures.length === 0 && dom.themeKindFailure === null) return resolution
  const details = [
    dom.themeKindFailure,
    ...dom.colorFailures.map(failure => `${failure.source}: ${failure.reason}`),
  ].filter((value): value is string => value !== null)
  const notice = details.join('; ')
  return resolution.ok
    ? { ...resolution, notice: resolution.notice ? `${resolution.notice}; ${notice}` : notice }
    : {
      ok: false,
      error: `${resolution.error}; ${notice}`,
      fallback: createFallbackProfile(dom.input.themeKind, sources.fallbackFont, sources.version, dom.input.colors),
    }
}

export function resolutionFailureDisplay(resolution: AppearanceResolution): AppearanceFailureDisplay | null {
  if (resolution.ok) {
    return resolution.notice ? { title: 'Syntax colors use built-in palette', detail: resolution.notice } : null
  }
  return { title: 'Appearance rendering unavailable', detail: resolution.error }
}

const defaultMetrics: AppearanceMetrics = {
  editorWidthPx: 960,
  contentPaddingPx: 24,
  gutterGapPx: 24,
  fontSizePx: 14,
  editorContentWidthPx: 864,
  logicalColumnWidthPx: 14,
  lineHeightMultiplier: 2,
  lineHeightPx: 28,
  blockPaddingPx: 16,
  mathBlockPaddingPx: 8,
  tableCellBlockPaddingPx: 6,
  tableCellInlinePaddingPx: 12,
  tableRowHeightPx: 40,
  tableWidgetBlockPaddingPx: 8,
  mermaidBlockPaddingPx: 8,
  mermaidBlockBorderPx: 1,
  headingScales: [2, 1.6, 1.4, 1.1, 1, 1],
}

let currentMetrics = defaultMetrics
let currentAppearanceVersion = 0

export function getAppearanceMetrics(): AppearanceMetrics { return currentMetrics }
export function getAppearanceVersion(): number { return currentAppearanceVersion }

export interface AppearanceFailureDisplay {
  readonly title: string
  readonly detail: string
}

export interface AppearanceAdapter {
  applyCssVariables(values: PerwriteCssVariables): void
  prepareShikiTheme(theme: ThemeData, appearanceVersion: number): Promise<unknown>
  publishShikiTheme(candidate: unknown, isCurrent?: () => boolean): boolean
  applyMermaidTheme(themeKind: string): void
  applyMetrics(metrics: AppearanceMetrics, version: number): void
  invalidateEditorAppearances(): void
  beginFontResourcePreparation(): number
  invalidateWidgets(): void
  showFailure(display: AppearanceFailureDisplay | null): void
}

export interface AppliedAppearance {
  readonly profile: AppearanceProfile
  readonly initialized: boolean
}

export function applyMetrics(metrics: AppearanceMetrics, version: number): void {
  const previousVersion = currentAppearanceVersion
  currentMetrics = metrics
  currentAppearanceVersion = version
  if (previousVersion !== version) {
    invalidateMeasuredHeightCacheOnAppearanceChange({
      previousVersion,
      currentVersion: version,
    })
  }
}

// UI colors remain DOM-derived, and stale asynchronous generations are discarded.
export async function applyAppearanceResolution(
  resolution: AppearanceResolution,
  previous: AppliedAppearance | null,
  adapter: AppearanceAdapter,
  isCurrent?: () => boolean,
  appearanceVersion?: number,
): Promise<AppliedAppearance | null> {
  const profile = resolution.ok ? resolution.profile : resolution.fallback ?? previous?.profile ?? null
  const failure = resolutionFailureDisplay(resolution)
  if (!profile) {
    adapter.showFailure(failure)
    return previous
  }
  const candidateVersion = appearanceVersion ?? profile.version
  let rendererFailure: AppearanceFailureDisplay | null = null
  let candidate: unknown
  try {
    candidate = await adapter.prepareShikiTheme(profile.theme, candidateVersion)
  } catch (error) {
    rendererFailure = {
      title: 'Appearance rendering unavailable',
      detail: `Syntax theme update failed: ${error instanceof Error ? error.message : String(error)}`,
    }
    adapter.showFailure(rendererFailure)
    if (previous) return previous
  }
  if (candidate !== undefined) {
    const published = adapter.publishShikiTheme(candidate, isCurrent)
    if (!published) return previous ?? { profile, initialized: false }
  }
  if (isCurrent && !isCurrent()) return previous ?? { profile, initialized: false }
  adapter.applyCssVariables(profile.cssVariables)
  adapter.applyMermaidTheme(profile.themeKind)
  adapter.applyMetrics(profile.metrics, profile.version)
  adapter.invalidateEditorAppearances()
  adapter.beginFontResourcePreparation()
  adapter.invalidateWidgets()
  adapter.showFailure(rendererFailure ?? failure)
  return { profile, initialized: true }
}

export function applyCssVariables(root: HTMLElement, values: PerwriteCssVariables): void {
  for (const [name, value] of Object.entries(values)) root.style.setProperty(name, value)
}

export interface AppearanceViewAdapter {
  dispatch(transaction: Record<string, never>): void
  requestMeasure(): void
}

export function invalidateEditorAppearance(view: AppearanceViewAdapter): void {
  view.dispatch({})
  view.requestMeasure()
}

