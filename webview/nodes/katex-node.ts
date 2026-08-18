import { WidgetType } from '@codemirror/view'
import { getAppearanceMetrics, getAppearanceVersion } from '../appearance'
import { renderKaTeX } from '../renderers/katex-renderer'
import {
  attachMeasuredHeightObserver,
  buildWidgetStructure,
  contentDigestKaTeX,
  evaluateEstimatedHeight,
  widthBucketPolicyFor,
  type AppearanceState,
  type CacheKey,
} from '../widget-height-cache'

const heightObservers = new WeakMap<HTMLElement, ResizeObserver>()

function appearanceState(): AppearanceState {
  const metrics = getAppearanceMetrics()
  return {
    appearanceVersion: getAppearanceVersion(),
    lineHeightPx: metrics.lineHeightPx,
    tableRowHeightPx: metrics.tableRowHeightPx,
    tableWidgetBlockPaddingPx: metrics.tableWidgetBlockPaddingPx,
  }
}

function katexBlockCacheKey(source: string): CacheKey {
  return {
    contentIdentity: {
      widgetKind: 'KaTeX',
      contentDigest: contentDigestKaTeX(source),
    },
    appearanceVersion: getAppearanceVersion(),
    widthBucket: widthBucketPolicyFor('KaTeX'),
  }
}

export function createKaTeXBlockWidget(value: string): KaTeXBlockWidget | null {
  const result = renderKaTeX({ source: value, displayMode: true })
  return result.ok ? new KaTeXBlockWidget(value, result.value) : null
}

export function createKaTeXInlineWidget(value: string): KaTeXInlineWidget | null {
  const result = renderKaTeX({ source: value, displayMode: false })
  return result.ok ? new KaTeXInlineWidget(value, result.value) : null
}

export class KaTeXBlockWidget extends WidgetType {
  private readonly appearanceVersion = getAppearanceVersion()
  constructor(
    readonly value: string,
    private readonly renderedHtml?: string,
  ) { super() }

  eq(other: KaTeXBlockWidget): boolean {
    return this.value === other.value && this.appearanceVersion === other.appearanceVersion
  }

  ignoreEvent(): boolean { return false }

  toDOM(): HTMLElement {
    const div = document.createElement('div')
    const result = this.renderedHtml === undefined
      ? renderKaTeX({ source: this.value, displayMode: true })
      : { ok: true as const, value: this.renderedHtml }
    if (result.ok) {
      div.className = 'cm-katex-block'
      div.innerHTML = result.value
    } else {
      div.textContent = `$$\n${this.value}\n$$`
    }
    heightObservers.set(div, attachMeasuredHeightObserver(div, () => katexBlockCacheKey(this.value)))
    return div
  }

  destroy(dom: HTMLElement): void {
    heightObservers.get(dom)?.disconnect()
    heightObservers.delete(dom)
  }

  get estimatedHeight(): number {
    const appearance = appearanceState()
    return evaluateEstimatedHeight({
      cacheKey: katexBlockCacheKey(this.value),
      staticInput: {
        structure: buildWidgetStructure({ kind: 'KaTeX', source: this.value }),
        appearance,
      },
    })
  }
}

export class KaTeXInlineWidget extends WidgetType {
  private readonly appearanceVersion = getAppearanceVersion()
  constructor(
    readonly value: string,
    private readonly renderedHtml?: string,
  ) { super() }

  eq(other: KaTeXInlineWidget): boolean {
    return this.value === other.value && this.appearanceVersion === other.appearanceVersion
  }

  ignoreEvent(): boolean { return false }

  toDOM(): HTMLElement {
    const span = document.createElement('span')
    const result = this.renderedHtml === undefined
      ? renderKaTeX({ source: this.value, displayMode: false })
      : { ok: true as const, value: this.renderedHtml }
    if (result.ok) {
      span.className = 'cm-katex-inline'
      span.innerHTML = result.value
    } else {
      span.textContent = `$${this.value}$`
    }
    return span
  }
}
