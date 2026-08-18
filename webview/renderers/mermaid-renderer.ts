import type { RenderingProfile } from '../../src/protocol'

export interface MermaidRenderInput {
  readonly source: string
  readonly layout: RenderingProfile['mermaidLayout']
  readonly maxEdges: number
  readonly theme: 'default' | 'dark'
}

export type MermaidFailureKind = 'parse' | 'layout' | 'render' | 'geometry' | 'font'

export interface MermaidFailure {
  readonly kind: MermaidFailureKind
  readonly reason: string
}

export interface MermaidRenderTarget {
  readonly element: HTMLElement
}

export interface MermaidSvgMarkup {
  readonly markup: string
}

export type MermaidRenderResult =
  | { readonly ok: true; readonly value: MermaidSvgMarkup }
  | { readonly ok: false; readonly error: MermaidFailure }

export interface MermaidPipelineAdapter {
  readonly parse: (source: string) => Promise<unknown>
  readonly prepareLayout: (input: MermaidRenderInput) => Promise<void>
  readonly render: (input: MermaidRenderInput, target: MermaidRenderTarget) => Promise<string>
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function executeMermaidPipeline(
  input: MermaidRenderInput,
  target: MermaidRenderTarget,
  adapter: MermaidPipelineAdapter,
): Promise<MermaidRenderResult> {
  try {
    await adapter.parse(input.source)
  } catch (error) {
    return { ok: false, error: { kind: 'parse', reason: reason(error) } }
  }
  try {
    await adapter.prepareLayout(input)
  } catch (error) {
    return { ok: false, error: { kind: 'layout', reason: reason(error) } }
  }
  try {
    const svg = await adapter.render(input, target)
    if (!svg.trim() || !/<svg(?:\s|>)/i.test(svg)) {
      return { ok: false, error: { kind: 'render', reason: 'Mermaid renderer did not return an SVG root' } }
    }
    return { ok: true, value: { markup: svg } }
  } catch (error) {
    return { ok: false, error: { kind: 'render', reason: reason(error) } }
  }
}

let layoutsRegistered = false
let renderQueue: Promise<void> = Promise.resolve()

async function render(input: MermaidRenderInput, target: MermaidRenderTarget): Promise<MermaidRenderResult> {
  let mermaid: typeof import('mermaid')['default']
  try {
    mermaid = (await import('mermaid')).default
  } catch (error) {
    return { ok: false, error: { kind: 'parse', reason: reason(error) } }
  }
  return executeMermaidPipeline(input, target, {
    parse: source => {
      mermaid.initialize({ startOnLoad: false, maxEdges: input.maxEdges })
      return Promise.resolve(mermaid.parse(source))
    },
    async prepareLayout(value) {
      if (!layoutsRegistered) {
        const layouts = (await import('@mermaid-js/layout-elk')).default
        mermaid.registerLayoutLoaders(layouts)
        layoutsRegistered = true
      }
      mermaid.initialize({ startOnLoad: false, theme: value.theme, layout: value.layout, maxEdges: value.maxEdges })
    },
    async render(value, renderTarget) {
      const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`
      try {
        return (await mermaid.render(id, value.source, renderTarget.element)).svg
      } finally {
        renderTarget.element.replaceChildren()
      }
    },
  })
}

export function renderMermaid(input: MermaidRenderInput, target: MermaidRenderTarget): Promise<MermaidRenderResult> {
  const result = renderQueue.then(() => render(input, target))
  renderQueue = result.then(() => undefined, () => undefined)
  return result
}
