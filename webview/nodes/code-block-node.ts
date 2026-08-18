import type { Result } from '../../src/protocol'

export interface ShikiHighlighter {
  codeToHtml(code: string, options: { lang: string; theme: string }): string
  loadLanguage(lang: unknown): Promise<void>
  loadTheme(theme: unknown): Promise<void>
  dispose(): void
}

export interface HighlightLanguage {
  readonly requested: string
  readonly selected: string
  readonly loadError?: string
}

export interface HighlightedCode {
  readonly html: string
  readonly language: HighlightLanguage
}

export interface ActiveShikiSnapshot {
  readonly id: number
  readonly appearanceVersion: number
  readonly themeName: string
  readonly theme: Readonly<Record<string, unknown>>
  readonly loadedLanguages: readonly string[]
  readonly highlighter: ShikiHighlighter
}

interface ShikiCandidate {
  readonly appearanceVersion: number
  readonly baseSnapshotId: number | null
  readonly themeName: string
  readonly theme: Readonly<Record<string, unknown>>
  readonly languageInputs: readonly (readonly [string, unknown])[]
  readonly highlighter: ShikiHighlighter
}

interface LanguagePreparation {
  readonly snapshot: ActiveShikiSnapshot
  readonly language: HighlightLanguage
  readonly candidate?: ShikiCandidate
}

interface WidgetHighlight {
  readonly snapshot: ActiveShikiSnapshot
  readonly highlighted: HighlightedCode
}

export type ShikiHighlighterFactory = (
  theme: Readonly<Record<string, unknown>>,
  languageInputs: readonly unknown[],
) => Promise<ShikiHighlighter>

const LANG_LOADERS: Record<string, () => Promise<unknown>> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  ts: () => import('shiki/langs/typescript.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  js: () => import('shiki/langs/javascript.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  py: () => import('shiki/langs/python.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  rs: () => import('shiki/langs/rust.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  bash: () => import('shiki/langs/bash.mjs'),
  shell: () => import('shiki/langs/bash.mjs'),
  sh: () => import('shiki/langs/bash.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  yml: () => import('shiki/langs/yaml.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  md: () => import('shiki/langs/markdown.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  svelte: () => import('shiki/langs/svelte.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
}

function normalizeTheme(themeJSON: Record<string, unknown>): Readonly<Record<string, unknown>> {
  const theme = { ...themeJSON }
  if (!theme.name) theme.name = 'vscode-theme'
  return Object.freeze(theme)
}

function moduleDefault(module: unknown): unknown {
  if (typeof module === 'object' && module !== null && 'default' in module) {
    return (module as { default: unknown }).default
  }
  return module
}

const defaultHighlighterFactory: ShikiHighlighterFactory = async (theme, languageInputs) => {
  const { createHighlighterCore } = await import('shiki/core')
  const { createJavaScriptRegexEngine } = await import('shiki/engine/javascript')
  return await createHighlighterCore({
    themes: [theme] as any,
    langs: [...languageInputs] as any,
    engine: createJavaScriptRegexEngine(),
  }) as unknown as ShikiHighlighter
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class ShikiCoordinator {
  private activeSnapshot: ActiveShikiSnapshot | null = null
  private nextSnapshotId = 1

  constructor(private readonly createHighlighter: ShikiHighlighterFactory = defaultHighlighterFactory) {}

  get active(): ActiveShikiSnapshot | null { return this.activeSnapshot }

  async prepareTheme(themeJSON: Record<string, unknown>, appearanceVersion: number): Promise<ShikiCandidate> {
    const theme = normalizeTheme(themeJSON)
    const base = this.activeSnapshot
    return this.createCandidate(
      theme,
      appearanceVersion,
      base?.loadedLanguages.map((language, index) => [language, (base as ActiveSnapshotInternals).languageInputs[index][1]] as const) ?? [],
      base?.id ?? null,
    )
  }

  publishTheme(candidate: ShikiCandidate, isCurrent?: () => boolean): ActiveShikiSnapshot | null {
    if (isCurrent && !isCurrent()) {
      candidate.highlighter.dispose()
      return null
    }
    const snapshot = this.publishCandidate(candidate)
    return snapshot
  }

  disposeCandidate(candidate: ShikiCandidate): void {
    if (this.activeSnapshot?.highlighter !== candidate.highlighter) candidate.highlighter.dispose()
  }

  async prepareLanguage(snapshot: ActiveShikiSnapshot, language: string): Promise<Result<LanguagePreparation>> {
    const normalized = language.toLowerCase()
    if (!normalized || !LANG_LOADERS[normalized]) {
      return {
        ok: true,
        value: {
          snapshot,
          language: { requested: normalized, selected: 'text' },
        },
      }
    }
    if (snapshot.loadedLanguages.includes(normalized)) {
      return { ok: true, value: { snapshot, language: { requested: normalized, selected: normalized } } }
    }

    let languageInput: unknown
    try {
      languageInput = moduleDefault(await LANG_LOADERS[normalized]())
    } catch (error) {
      return {
        ok: true,
        value: {
          snapshot,
          language: { requested: normalized, selected: 'text', loadError: errorMessage(error) },
        },
      }
    }

    try {
      const base = snapshot as ActiveSnapshotInternals
      const inputs = [
        ...base.languageInputs,
        [normalized, languageInput] as const,
      ]
      const candidate = await this.createCandidate(snapshot.theme, snapshot.appearanceVersion, inputs, snapshot.id)
      return {
        ok: true,
        value: {
          snapshot,
          language: { requested: normalized, selected: normalized },
          candidate,
        },
      }
    } catch (error) {
      return {
        ok: true,
        value: {
          snapshot,
          language: { requested: normalized, selected: 'text', loadError: errorMessage(error) },
        },
      }
    }
  }

  publishLanguage(candidate: ShikiCandidate, isCurrent?: () => boolean): ActiveShikiSnapshot | null {
    if (isCurrent && !isCurrent()) {
      candidate.highlighter.dispose()
      return null
    }
    if (this.activeSnapshot?.id !== candidate.baseSnapshotId) {
      candidate.highlighter.dispose()
      return null
    }
    return this.publishCandidate(candidate)
  }

  async highlightForWidget(
    code: string,
    lang: string,
    appearanceVersion: number,
  ): Promise<Result<WidgetHighlight>> {
    let snapshot = this.activeSnapshot
    if (!snapshot) return { ok: false, error: 'Syntax highlighter is preparing' }
    if (snapshot.appearanceVersion !== appearanceVersion) {
      return { ok: false, error: 'Appearance snapshot is not current' }
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      const preparation = await this.prepareLanguage(snapshot, lang)
      if (!preparation.ok) return preparation
      let outputSnapshot = snapshot
      if (preparation.value.candidate) {
        const published = this.publishLanguage(
          preparation.value.candidate,
          () => this.activeSnapshot?.id === snapshot?.id && this.activeSnapshot?.appearanceVersion === appearanceVersion,
        )
        if (!published) {
          snapshot = this.activeSnapshot
          if (!snapshot || snapshot.appearanceVersion !== appearanceVersion) {
            return { ok: false, error: 'Appearance snapshot changed while loading language' }
          }
          continue
        }
        outputSnapshot = published
      }

      try {
        return {
          ok: true,
          value: {
            snapshot: outputSnapshot,
            highlighted: {
              html: outputSnapshot.highlighter.codeToHtml(code, {
                lang: preparation.value.language.selected,
                theme: outputSnapshot.themeName,
              }),
              language: preparation.value.language,
            },
          },
        }
      } catch (error) {
        return { ok: false, error: errorMessage(error) }
      }
    }
    return { ok: false, error: 'Appearance snapshot changed while loading language' }
  }

  private async createCandidate(
    theme: Readonly<Record<string, unknown>>,
    appearanceVersion: number,
    languageInputs: readonly (readonly [string, unknown])[],
    baseSnapshotId: number | null,
  ): Promise<ShikiCandidate> {
    const highlighter = await this.createHighlighter(theme, languageInputs.map(([, input]) => input))
    return {
      appearanceVersion,
      baseSnapshotId,
      themeName: String(theme.name),
      theme,
      languageInputs: Object.freeze(languageInputs.map(entry => Object.freeze(entry))),
      highlighter,
    }
  }

  private publishCandidate(candidate: ShikiCandidate): ActiveShikiSnapshot {
    const snapshot = {
      id: this.nextSnapshotId++,
      appearanceVersion: candidate.appearanceVersion,
      themeName: candidate.themeName,
      theme: candidate.theme,
      loadedLanguages: Object.freeze(candidate.languageInputs.map(([language]) => language)),
      highlighter: candidate.highlighter,
      languageInputs: candidate.languageInputs,
    } satisfies ActiveSnapshotInternals
    this.activeSnapshot = Object.freeze(snapshot)
    return snapshot
  }
}

type ActiveSnapshotInternals = ActiveShikiSnapshot & {
  readonly languageInputs: readonly (readonly [string, unknown])[]
}

const shikiCoordinator = new ShikiCoordinator()

export function getShikiCoordinator(): ShikiCoordinator { return shikiCoordinator }
export function getActiveShikiSnapshot(): ActiveShikiSnapshot | null { return shikiCoordinator.active }

export async function prepareShikiTheme(
  themeJSON: Record<string, unknown>,
  appearanceVersion: number,
): Promise<unknown> {
  return shikiCoordinator.prepareTheme(themeJSON, appearanceVersion)
}

export function publishShikiTheme(candidate: unknown, isCurrent?: () => boolean): boolean {
  return shikiCoordinator.publishTheme(candidate as ShikiCandidate, isCurrent) !== null
}

export function disposeShikiTheme(candidate: unknown): void {
  shikiCoordinator.disposeCandidate(candidate as ShikiCandidate)
}

export async function initShikiHighlighter(
  themeJSON: Record<string, unknown>,
  appearanceVersion = 0,
): Promise<void> {
  const candidate = await shikiCoordinator.prepareTheme(themeJSON, appearanceVersion)
  shikiCoordinator.publishTheme(candidate)
}

export async function updateShikiTheme(
  themeJSON: Record<string, unknown>,
  appearanceVersion = 0,
): Promise<void> {
  const candidate = await shikiCoordinator.prepareTheme(themeJSON, appearanceVersion)
  shikiCoordinator.publishTheme(candidate)
}

export async function resolveHighlightLanguage(
  highlighter: ShikiHighlighter,
  lang: string,
  loadedLanguages: Set<string> = new Set<string>(),
): Promise<HighlightLanguage> {
  const normalized = lang.toLowerCase()
  if (loadedLanguages.has(normalized)) return { requested: normalized, selected: normalized }
  const loader = LANG_LOADERS[normalized]
  if (!loader) return { requested: normalized, selected: 'text' }

  try {
    await highlighter.loadLanguage(moduleDefault(await loader()))
    loadedLanguages.add(normalized)
    return { requested: normalized, selected: normalized }
  } catch (error) {
    return {
      requested: normalized,
      selected: 'text',
      loadError: errorMessage(error),
    }
  }
}

export async function highlightCode(code: string, lang: string): Promise<Result<HighlightedCode>> {
  const snapshot = shikiCoordinator.active
  if (!snapshot) return { ok: false, error: 'Syntax highlighter is unavailable' }
  const result = await shikiCoordinator.highlightForWidget(code, lang, snapshot.appearanceVersion)
  if (!result.ok) return result
  return { ok: true, value: result.value.highlighted }
}

import { EditorSelection, Transaction } from '@codemirror/state'
import { WidgetType, type EditorView } from '@codemirror/view'
import { getAppearanceMetrics, getAppearanceVersion } from '../appearance'
import { reportCodeBlockFailureEffect, resolveCodePoint, type CodePointLocator } from '../editor/code-block-wrapping'
import {
  attachMeasuredHeightObserver,
  buildWidgetStructure,
  contentDigestCodeBlock,
  evaluateEstimatedHeight,
  widthBucketPolicyFor,
  type AppearanceState,
  type CacheKey,
} from '../widget-height-cache'

const heightObservers = new WeakMap<HTMLElement, ResizeObserver>()
const lastAvailableWidthPxByDigest = new Map<string, number>()

function appearanceState(): AppearanceState {
  const metrics = getAppearanceMetrics()
  return {
    appearanceVersion: getAppearanceVersion(),
    lineHeightPx: metrics.lineHeightPx,
    tableRowHeightPx: metrics.tableRowHeightPx,
    tableWidgetBlockPaddingPx: metrics.tableWidgetBlockPaddingPx,
  }
}

function codeBlockCacheKey(code: string, lang: string, availableWidthPx: number): CacheKey {
  return {
    contentIdentity: {
      widgetKind: 'CodeBlock',
      contentDigest: contentDigestCodeBlock(code, lang),
    },
    appearanceVersion: getAppearanceVersion(),
    widthBucket: widthBucketPolicyFor('CodeBlock', availableWidthPx),
  }
}

export function textOffsetAtPoint(
  code: HTMLElement,
  x: number,
  y: number,
  textLength: number,
  locate?: CodePointLocator,
) {
  return resolveCodePoint(code, x, y, textLength, locate)
}

export class ShikiCodeBlockWidget extends WidgetType {
  private readonly appearanceVersion: number

  constructor(
    readonly code: string,
    readonly lang: string,
    readonly codeFrom: number,
  ) {
    super()
    const active = getActiveShikiSnapshot()
    this.appearanceVersion = active?.appearanceVersion ?? getAppearanceVersion()
  }

  eq(other: ShikiCodeBlockWidget): boolean {
    return this.code === other.code && this.lang === other.lang
      && this.codeFrom === other.codeFrom && this.appearanceVersion === other.appearanceVersion
  }

  ignoreEvent(): boolean { return false }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'cm-shiki-codeblock'
    wrapper.dataset.shikiState = getActiveShikiSnapshot() ? 'preparing' : 'fallback'
    wrapper.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return
      const code = wrapper.querySelector<HTMLElement>('code, .cm-render-error-source')
      if (!code) return
      const offset = textOffsetAtPoint(code, event.clientX, event.clientY, this.code.length)
      if (!offset.ok) {
        view.dispatch({ effects: reportCodeBlockFailureEffect.of(offset.error) })
        return
      }
      event.preventDefault()
      event.stopPropagation()
      view.dispatch({
        selection: EditorSelection.cursor(this.codeFrom + offset.value),
        scrollIntoView: true,
        annotations: Transaction.userEvent.of('select.pointer'),
      })
      view.focus()
    })

    if (this.lang) {
      const label = document.createElement('div')
      label.className = 'cm-shiki-lang'
      label.textContent = this.lang
      wrapper.appendChild(label)
    }

    const pre = document.createElement('pre')
    pre.className = 'cm-shiki-pre'
    const code = document.createElement('code')
    code.textContent = this.code
    pre.appendChild(code)
    wrapper.appendChild(pre)

    shikiCoordinator.highlightForWidget(this.code, this.lang, this.appearanceVersion).then((result) => {
      if (!wrapper.isConnected) return
      if (!result.ok) {
        if (result.error === 'Syntax highlighter is preparing' || result.error === 'Appearance snapshot is not current') return
        const active = getActiveShikiSnapshot()
        if (!active || active.appearanceVersion !== this.appearanceVersion) return
        const reason = document.createElement('div')
        reason.className = 'cm-render-error-reason'
        reason.textContent = `Shiki rendering failed: ${result.error}`
        const source = document.createElement('pre')
        source.className = 'cm-render-error-source'
        source.textContent = this.code
        wrapper.replaceChildren(reason, source)
        wrapper.classList.add('cm-shiki-error')
        wrapper.dataset.shikiState = 'failed'
        delete wrapper.dataset.shikiSnapshotId
        delete wrapper.dataset.shikiAppearanceVersion
        return
      }
      const active = getActiveShikiSnapshot()
      if (!active || active.appearanceVersion !== this.appearanceVersion) return
      let html = result.value.highlighted.html
      html = html.replace(/background(?:-color)?:[^;"}]+;?/g, '')
      const container = document.createElement('div')
      container.innerHTML = html
      const label = this.lang ? document.createElement('div') : null
      if (label) {
        label.className = 'cm-shiki-lang'
        label.textContent = this.lang
      }
      wrapper.replaceChildren()
      if (label) wrapper.appendChild(label)
      if (result.value.highlighted.language.loadError) {
        const warning = document.createElement('div')
        warning.className = 'cm-render-error-reason'
        warning.textContent = `Shiki language ${result.value.highlighted.language.requested} failed; showing text: ${result.value.highlighted.language.loadError}`
        wrapper.appendChild(warning)
      }
      while (container.firstChild) wrapper.appendChild(container.firstChild)
      wrapper.classList.remove('cm-shiki-error')
      const state = result.value.highlighted.language.selected === 'text' ? 'fallback' : 'ready'
      wrapper.dataset.shikiState = state
      if (state === 'ready') {
        wrapper.dataset.shikiSnapshotId = String(result.value.snapshot.id)
        wrapper.dataset.shikiAppearanceVersion = String(result.value.snapshot.appearanceVersion)
      } else {
        delete wrapper.dataset.shikiSnapshotId
        delete wrapper.dataset.shikiAppearanceVersion
      }
    }).catch((error) => {
      if (!wrapper.isConnected) return
      const active = getActiveShikiSnapshot()
      if (!active || active.appearanceVersion !== this.appearanceVersion) return
      const reason = document.createElement('div')
      reason.className = 'cm-render-error-reason'
      reason.textContent = `Shiki rendering failed: ${errorMessage(error)}`
      const source = document.createElement('pre')
      source.className = 'cm-render-error-source'
      source.textContent = this.code
      wrapper.replaceChildren(reason, source)
      wrapper.classList.add('cm-shiki-error')
      wrapper.dataset.shikiState = 'failed'
      delete wrapper.dataset.shikiSnapshotId
      delete wrapper.dataset.shikiAppearanceVersion
    })

    heightObservers.set(wrapper, attachMeasuredHeightObserver(wrapper, () => {
      const availableWidthPx = wrapper.clientWidth || wrapper.parentElement?.clientWidth || 0
      const digest = contentDigestCodeBlock(this.code, this.lang)
      lastAvailableWidthPxByDigest.set(digest, availableWidthPx)
      return codeBlockCacheKey(this.code, this.lang, availableWidthPx)
    }))

    return wrapper
  }

  destroy(dom: HTMLElement): void {
    heightObservers.get(dom)?.disconnect()
    heightObservers.delete(dom)
  }

  get estimatedHeight(): number {
    const digest = contentDigestCodeBlock(this.code, this.lang)
    const availableWidthPx = lastAvailableWidthPxByDigest.get(digest) ?? 0
    const appearance = appearanceState()
    return evaluateEstimatedHeight({
      cacheKey: codeBlockCacheKey(this.code, this.lang, availableWidthPx),
      staticInput: {
        structure: buildWidgetStructure({ kind: 'CodeBlock', code: this.code }),
        appearance,
      },
    })
  }
}
