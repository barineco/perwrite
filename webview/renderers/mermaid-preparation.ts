import {
  resolveSvgGeometry,
  type SvgGeometry,
} from '../editor/mermaid-viewport'
import type {
  MermaidFailure,
  MermaidRenderTarget,
  MermaidSvgMarkup,
} from './mermaid-renderer'
import { prepareFontResources, type PreparedFontResources } from '../font-resource'

export interface MermaidMeasurementInput {
  readonly documentGeneration: number
  readonly appearanceVersion: number
  readonly fontResourceGeneration: number
}

export interface PreparedMermaidDiagram {
  readonly svg: SVGSVGElement
  readonly geometry: SvgGeometry
  readonly measurement: MermaidMeasurementInput
}

export type MermaidPreparationResult =
  | { readonly ok: true; readonly value: PreparedMermaidDiagram }
  | { readonly ok: false; readonly error: MermaidFailure }

export interface MermaidPreparationTarget extends MermaidRenderTarget {
  readonly dispose: () => void
}

function nextFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()))
}

function svgFromMarkup(markup: string): SVGSVGElement | null {
  const holder = document.createElement('div')
  holder.innerHTML = markup
  const svg = holder.querySelector('svg')
  return svg instanceof SVGSVGElement && holder.querySelectorAll('svg').length === 1 ? svg : null
}

export function createMermaidPreparationTarget(widthCssPx: number): MermaidPreparationTarget {
  const element = document.createElement('div')
  element.className = 'cm-mermaid-preparation'
  element.dataset.mermaidPreparation = 'true'
  element.setAttribute('aria-hidden', 'true')
  element.style.width = `${Math.max(1, widthCssPx)}px`
  document.body.append(element)
  let disposed = false
  return {
    element,
    dispose() {
      if (disposed) return
      disposed = true
      element.remove()
    },
  }
}

export async function prepareMermaidDiagram(
  rendered: MermaidSvgMarkup,
  target: MermaidPreparationTarget,
  measurement: MermaidMeasurementInput,
): Promise<MermaidPreparationResult> {
  const fonts = await prepareFontResources(measurement.fontResourceGeneration)
  if (!fonts.ok) {
    return { ok: false, error: { kind: 'font', reason: fonts.error } }
  }
  const svg = svgFromMarkup(rendered.markup)
  if (!svg) {
    return { ok: false, error: { kind: 'render', reason: 'Rendered markup has no unique SVG root' } }
  }
  target.element.replaceChildren(svg)
  await nextFrame()
  const geometry = resolveSvgGeometry(svg)
  if (!geometry.ok) return geometry
  const bounds = geometry.value.contentBounds
  svg.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`)
  return { ok: true, value: { svg, geometry: geometry.value, measurement } }
}
