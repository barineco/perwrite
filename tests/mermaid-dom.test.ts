import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fitViewport,
  resolveSvgGeometry,
  resolveViewportPresentation,
  type SvgGeometry,
} from '../webview/editor/mermaid-viewport'
import { executeMermaidPipeline } from '../webview/renderers/mermaid-renderer'
import {
  MermaidPresentationController,
  MermaidWidget,
  type MermaidRequest,
} from '../webview/nodes/mermaid-node'

const configuration = {
  mermaidLayout: 'elk' as const,
  mermaidMaxEdges: 1024,
  mermaidPanStep: 80,
  mermaidZoomStep: 1.5,
}

class MockSvg {
  viewBox = { baseVal: { x: 0, y: 0, width: 100, height: 50 } }
  getBBox() { return { x: -5, y: -2, width: 110, height: 54 } }
}

;(globalThis as any).SVGSVGElement = MockSvg

afterEach(() => vi.restoreAllMocks())

describe('Mermaid DOM and render adapters', () => {
  const target = { element: {} as HTMLElement }

  it('defines widget equality by source, Mermaid configuration, and source range', () => {
    const widget = new MermaidWidget('graph TD', configuration, 4, 12)
    expect(widget.eq(new MermaidWidget('graph TD', configuration, 4, 12))).toBe(true)
    expect(widget.eq(new MermaidWidget('graph TD', { ...configuration, mermaidLayout: 'dagre' }, 4, 12))).toBe(false)
    expect(widget.eq(new MermaidWidget('graph TD', { ...configuration, mermaidMaxEdges: 512 }, 4, 12))).toBe(false)
    expect(widget.eq(new MermaidWidget('graph LR', configuration, 4, 12))).toBe(false)
  })

  it('resolves a unique finite geometry and includes graph overflow', () => {
    const result = resolveSvgGeometry(new MockSvg() as unknown as SVGSVGElement)
    expect(result).toEqual({ ok: true, value: {
      viewBox: { x: 0, y: 0, width: 100, height: 50 },
      graphBounds: { x: -5, y: -2, width: 110, height: 54 },
      contentBounds: { x: -5, y: -2, width: 110, height: 54 },
    } })
  })

  it.each([
    ['viewBox', () => { const svg = new MockSvg(); svg.viewBox.baseVal.width = 0; return svg }],
    ['bounding box', () => { const svg = new MockSvg(); svg.getBBox = () => ({ x: 0, y: 0, width: Number.NaN, height: 2 }); return svg }],
  ])('maps invalid %s to geometry failure', (_name, create) => {
    expect(resolveSvgGeometry(create() as unknown as SVGSVGElement)).toEqual(expect.objectContaining({
      ok: false, error: expect.objectContaining({ kind: 'geometry' }),
    }))
  })

  it.each(['parse', 'layout', 'render'] as const)('classifies %s failure without running later stages', async kind => {
    const calls: string[] = []
    const adapter = {
      async parse() { calls.push('parse'); if (kind === 'parse') throw new Error('parse reason') },
      async prepareLayout() { calls.push('layout'); if (kind === 'layout') throw new Error('layout reason') },
      async render() { calls.push('render'); if (kind === 'render') throw new Error('render reason'); return '<svg></svg>' },
    }
    const result = await executeMermaidPipeline({ source: 'graph TD', layout: 'elk', maxEdges: 1024, theme: 'dark' }, target, adapter)
    expect(result).toEqual({ ok: false, error: { kind, reason: `${kind} reason` } })
    expect(calls).toEqual(kind === 'parse' ? ['parse'] : kind === 'layout' ? ['parse', 'layout'] : ['parse', 'layout', 'render'])
  })

  it('accepts only an SVG render result', async () => {
    const adapter = { parse: async () => {}, prepareLayout: async () => {}, render: async () => '<div />' }
    expect(await executeMermaidPipeline({ source: 'x', layout: 'dagre', maxEdges: 1024, theme: 'default' }, target, adapter)).toEqual(expect.objectContaining({
      ok: false, error: expect.objectContaining({ kind: 'render' }),
    }))
  })

  it('requires the preparation target and returns non-presentable SVG markup', async () => {
    let received: unknown
    const adapter = {
      parse: async () => {},
      prepareLayout: async () => {},
      render: async (_input: unknown, actual: unknown) => { received = actual; return '<svg viewBox="0 0 1 1"></svg>' },
    }
    const result = await executeMermaidPipeline(
      { source: 'x', layout: 'dagre', maxEdges: 1024, theme: 'default' }, target, adapter,
    )
    expect(received).toBe(target)
    expect(result).toEqual({ ok: true, value: { markup: '<svg viewBox="0 0 1 1"></svg>' } })
  })
})

type DomSurface = {
  style: Record<string, string>
  dataset: Record<string, string>
  clientWidth: number
  clientHeight: number
  scrollLeft: number
  scrollTop: number
  isConnected: boolean
  hasPointerCapture: (pointerId: number) => boolean
  releasePointerCapture: (pointerId: number) => void
  replaceChildren: (...nodes: unknown[]) => void
  dispatchEvent: (event: Event) => boolean
  addEventListener: () => void
  removeEventListener: () => void
  focus: () => void
}

type OverlayHarness = {
  controller: MermaidPresentationController
  internals: {
    overlay: unknown
    overlayViewportResizeObserver: ResizeObserver | null
    attachOverlayViewportResizeObservation: (viewport: HTMLElement) => void
    applyViewportState: () => void
  }
  viewport: DomSurface
  canvas: DomSurface
  svg: DomSurface
  modalRoot: DomSurface
  observers: MockResizeObserver[]
  request: MermaidRequest
  geometry: SvgGeometry
}

class MockResizeObserver {
  static instances: MockResizeObserver[] = []
  readonly observed: unknown[] = []
  disconnected = false
  constructor(readonly callback: ResizeObserverCallback) {
    MockResizeObserver.instances.push(this)
  }
  observe(target: unknown): void {
    this.observed.push(target)
  }
  unobserve(): void {}
  disconnect(): void {
    this.disconnected = true
    this.observed.length = 0
  }
  notify(): void {
    this.callback([], this)
  }
}

function createSurface(clientWidth: number, clientHeight: number): DomSurface {
  return {
    style: {},
    dataset: {},
    clientWidth,
    clientHeight,
    scrollLeft: 0,
    scrollTop: 0,
    isConnected: true,
    hasPointerCapture: () => false,
    releasePointerCapture: () => {},
    replaceChildren: () => {},
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
    focus: () => {},
  }
}

function openOverlayFixture(initialSize = { width: 300, height: 200 }): OverlayHarness {
  MockResizeObserver.instances = []
  vi.stubGlobal('ResizeObserver', MockResizeObserver)
  vi.stubGlobal('window', {
    innerWidth: 1024,
    innerHeight: 768,
    devicePixelRatio: 1,
  })

  const geometry: SvgGeometry = {
    viewBox: { x: 0, y: 0, width: 1000, height: 500 },
    graphBounds: { x: -50, y: -25, width: 1100, height: 550 },
    contentBounds: { x: -50, y: -25, width: 1100, height: 550 },
  }
  const root = createSurface(400, 300)
  const viewport = createSurface(initialSize.width, initialSize.height)
  const canvas = createSurface(0, 0)
  const svg = createSurface(0, 0)
  const modalRoot = createSurface(0, 0)
  const view = {
    state: { field: () => 0 },
    scrollDOM: { scrollLeft: 0, scrollTop: 0 },
    requestMeasure() {},
    dispatch() {},
    focus() {},
  } as unknown as EditorView

  const controller = new MermaidPresentationController(
    root as unknown as HTMLElement,
    view,
    'graph TD',
    configuration,
    'dark',
    -1,
    {
      render: async () => ({ ok: true, value: { markup: '<svg></svg>' } }),
      createPreparationTarget: () => ({ element: createSurface(1, 1) as unknown as HTMLElement, dispose() {} }),
      prepare: async () => ({
        ok: true,
        value: {
          svg: svg as unknown as SVGSVGElement,
          geometry,
          measurement: { documentGeneration: 0, appearanceVersion: 0, fontResourceGeneration: 0 },
        },
      }),
    },
  )

  const internals = controller as unknown as OverlayHarness['internals'] & {
    request: MermaidRequest
    presentation: unknown
  }
  const request: MermaidRequest = {
    generation: 1,
    source: 'graph TD',
    configuration,
    theme: 'dark',
    documentGeneration: 0,
    appearanceVersion: 0,
    fontResourceGeneration: 0,
    renderIdentity: { cacheKey: 'fixture' },
  }
  internals.request = request
  internals.presentation = {
    kind: 'Presented',
    request,
    diagram: {
      svg: svg as unknown as SVGSVGElement,
      geometry,
      measurement: { documentGeneration: 0, appearanceVersion: 0, fontResourceGeneration: 0 },
    },
  }
  const size = {
    widthCssPx: viewport.clientWidth,
    heightCssPx: viewport.clientHeight,
    devicePixelRatio: 1,
  }
  const state = fitViewport(geometry, size)
  internals.overlay = {
    kind: 'Open',
    request,
    modal: {
      root: modalRoot,
      dispose() {},
    },
    viewport,
    canvas,
    svg,
    diagram: {
      svg: svg as unknown as SVGSVGElement,
      geometry,
      measurement: { documentGeneration: 0, appearanceVersion: 0, fontResourceGeneration: 0 },
    },
    state,
    documentScroll: { left: 0, top: 0 },
  }
  internals.applyViewportState()
  internals.attachOverlayViewportResizeObservation(viewport as unknown as HTMLElement)

  return {
    controller,
    internals: controller as unknown as OverlayHarness['internals'],
    viewport,
    canvas,
    svg,
    modalRoot,
    observers: MockResizeObserver.instances,
    request,
    geometry,
  }
}

describe('Mermaid overlay resize observation lifecycle', () => {
  beforeEach(() => {
    MockResizeObserver.instances = []
  })

  it('observes the overlay viewport only while Open and reapplies after resize', () => {
    const harness = openOverlayFixture()
    expect(harness.observers).toHaveLength(1)
    expect(harness.observers[0].observed).toEqual([harness.viewport])
    expect(harness.internals.overlayViewportResizeObserver).toBe(harness.observers[0])

    const openOverlay = harness.internals.overlay as { state: { revision: number } }
    const revisionBefore = openOverlay.state.revision
    harness.viewport.clientWidth = 480
    harness.viewport.clientHeight = 320
    harness.observers[0].notify()

    const resizedOverlay = harness.internals.overlay as {
      kind: string
      state: { revision: number; scale: number; scrollLeft: number; scrollTop: number }
    }
    expect(resizedOverlay.kind).toBe('Open')
    expect(resizedOverlay.state.revision).toBe(revisionBefore + 1)

    const nextSize = {
      widthCssPx: 480,
      heightCssPx: 320,
      devicePixelRatio: 1,
    }
    const expected = resolveViewportPresentation(harness.geometry, nextSize, resizedOverlay.state)
    const bounds = harness.geometry.contentBounds
    expect(harness.canvas.style.width).toBe(`${expected.canvasSize.width}px`)
    expect(harness.canvas.style.height).toBe(`${expected.canvasSize.height}px`)
    expect(harness.svg.style.width).toBe(`${bounds.width}px`)
    expect(harness.svg.style.height).toBe(`${bounds.height}px`)
    expect(harness.svg.style.left).toBe(`${expected.alignmentOffset.x}px`)
    expect(harness.svg.style.top).toBe(`${expected.alignmentOffset.y}px`)
    expect(harness.svg.style.transform).toBe(`translate(0px, 0px) scale(${resizedOverlay.state.scale})`)
    expect(harness.viewport.scrollLeft).toBe(resizedOverlay.state.scrollLeft)
    expect(harness.viewport.scrollTop).toBe(resizedOverlay.state.scrollTop)
    expect(harness.modalRoot.dataset.viewportRevision).toBe(String(resizedOverlay.state.revision))
    expect(harness.modalRoot.dataset.viewportScale).toBe(String(resizedOverlay.state.scale))
    expect(harness.modalRoot.dataset.viewportScrollLeft).toBe(String(resizedOverlay.state.scrollLeft))
    expect(harness.modalRoot.dataset.viewportScrollTop).toBe(String(resizedOverlay.state.scrollTop))
    expect(harness.modalRoot.dataset.viewportCenterGraphX).toBe(String(expected.centerGraph.x))
    expect(harness.modalRoot.dataset.viewportCenterGraphY).toBe(String(expected.centerGraph.y))

    const revisionAfterResize = resizedOverlay.state.revision
    const datasetRevision = harness.modalRoot.dataset.viewportRevision
    harness.controller.closeOverlay(false)

    expect(harness.observers[0].disconnected).toBe(true)
    expect(harness.internals.overlayViewportResizeObserver).toBeNull()
    expect(harness.internals.overlay).toEqual({ kind: 'Closed' })

    harness.viewport.clientWidth = 640
    harness.viewport.clientHeight = 400
    harness.observers[0].notify()
    expect(harness.internals.overlay).toEqual({ kind: 'Closed' })
    expect(harness.modalRoot.dataset.viewportRevision).toBe(datasetRevision)
    expect(revisionAfterResize).toBe(revisionBefore + 1)
  })

  it('does not add ResizeObserver to the image overlay module', () => {
    const imageWidget = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../webview/editor/image-widget.ts'),
      'utf8',
    )
    expect(imageWidget).not.toMatch(/ResizeObserver/)
  })
})
