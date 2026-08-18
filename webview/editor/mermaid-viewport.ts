export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface SvgGeometry {
  readonly viewBox: Rect
  readonly graphBounds: Rect
  readonly contentBounds: Rect
}

export interface ViewportSize {
  readonly widthCssPx: number
  readonly heightCssPx: number
  readonly devicePixelRatio: number
}

export interface MermaidViewportState {
  readonly scale: number
  readonly fitScale: number
  readonly scrollLeft: number
  readonly scrollTop: number
  readonly revision: number
}

export interface MermaidViewportConfiguration {
  readonly panStep: number
  readonly zoomStep: number
}

export interface MermaidViewportPresentation {
  readonly alignmentOffset: { readonly x: number; readonly y: number }
  readonly graphSize: { readonly width: number; readonly height: number }
  readonly canvasSize: { readonly width: number; readonly height: number }
  readonly centerGraph: { readonly x: number; readonly y: number }
}

export type MermaidViewportEvent =
  | { readonly type: 'fit' }
  | { readonly type: 'zoom-at'; readonly factor: number; readonly x: number; readonly y: number }
  | { readonly type: 'pan-by'; readonly dx: number; readonly dy: number }
  | { readonly type: 'wheel'; readonly deltaX: number; readonly deltaY: number; readonly x: number; readonly y: number; readonly zoom: boolean }
  | { readonly type: 'key'; readonly key: string; readonly x?: number; readonly y?: number }

export interface GeometryFailure {
  readonly kind: 'geometry'
  readonly reason: string
}

export type GeometryResult =
  | { readonly ok: true; readonly value: SvgGeometry }
  | { readonly ok: false; readonly error: GeometryFailure }

const OVERLAY_PADDING = 24
const MAX_SCALE = 8

function validPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function validRect(rect: Rect): boolean {
  return Number.isFinite(rect.x) && Number.isFinite(rect.y)
    && validPositive(rect.width) && validPositive(rect.height)
}

export function unionRect(left: Rect, right: Rect): Rect {
  const x = Math.min(left.x, right.x)
  const y = Math.min(left.y, right.y)
  const rightEdge = Math.max(left.x + left.width, right.x + right.width)
  const bottomEdge = Math.max(left.y + left.height, right.y + right.height)
  return { x, y, width: rightEdge - x, height: bottomEdge - y }
}

export function resolveSvgGeometry(svg: SVGSVGElement): GeometryResult {
  if (!(svg instanceof SVGSVGElement)) {
    return { ok: false, error: { kind: 'geometry', reason: 'SVG root is unavailable' } }
  }
  let box: DOMRect
  try {
    box = svg.getBBox()
  } catch (error) {
    return { ok: false, error: { kind: 'geometry', reason: `SVG bounding box is unavailable: ${error instanceof Error ? error.message : String(error)}` } }
  }
  const base = svg.viewBox?.baseVal
  const viewBox = base && { x: base.x, y: base.y, width: base.width, height: base.height }
  const graphBounds = { x: box.x, y: box.y, width: box.width, height: box.height }
  if (!viewBox || !validRect(viewBox)) {
    return { ok: false, error: { kind: 'geometry', reason: 'SVG viewBox must contain finite positive dimensions' } }
  }
  if (!validRect(graphBounds)) {
    return { ok: false, error: { kind: 'geometry', reason: 'SVG bounding box must contain finite positive dimensions' } }
  }
  return { ok: true, value: { viewBox, graphBounds, contentBounds: unionRect(viewBox, graphBounds) } }
}

export function inlineOverviewScale(geometry: SvgGeometry, availableWidthCssPx: number): number {
  if (!validPositive(availableWidthCssPx)) return 1
  return Math.min(1, availableWidthCssPx / geometry.contentBounds.width)
}

export function overlayFitScale(geometry: SvgGeometry, viewport: ViewportSize): number {
  if (!validPositive(viewport.widthCssPx) || !validPositive(viewport.heightCssPx) || !validPositive(viewport.devicePixelRatio)) return Number.NaN
  const widthDevicePx = Math.max(1, viewport.widthCssPx - OVERLAY_PADDING * 2) * viewport.devicePixelRatio
  const heightDevicePx = Math.max(1, viewport.heightCssPx - OVERLAY_PADDING * 2) * viewport.devicePixelRatio
  const graphWidthDevicePx = geometry.contentBounds.width * viewport.devicePixelRatio
  const graphHeightDevicePx = geometry.contentBounds.height * viewport.devicePixelRatio
  return Math.min(widthDevicePx / graphWidthDevicePx, heightDevicePx / graphHeightDevicePx, MAX_SCALE)
}

export function viewportAlignmentOffset(
  geometry: SvgGeometry,
  viewport: ViewportSize,
  scale: number,
): { readonly x: number; readonly y: number } {
  return {
    x: Math.max(0, (viewport.widthCssPx - geometry.contentBounds.width * scale) / 2),
    y: Math.max(0, (viewport.heightCssPx - geometry.contentBounds.height * scale) / 2),
  }
}

export function resolveViewportPresentation(
  geometry: SvgGeometry,
  viewport: ViewportSize,
  viewportState: MermaidViewportState,
): MermaidViewportPresentation {
  const alignmentOffset = viewportAlignmentOffset(geometry, viewport, viewportState.scale)
  const graphSize = {
    width: geometry.contentBounds.width * viewportState.scale,
    height: geometry.contentBounds.height * viewportState.scale,
  }
  return {
    alignmentOffset,
    graphSize,
    canvasSize: {
      width: Math.max(graphSize.width, viewport.widthCssPx),
      height: Math.max(graphSize.height, viewport.heightCssPx),
    },
    centerGraph: {
      x: geometry.contentBounds.x + (viewportState.scrollLeft + viewport.widthCssPx / 2 - alignmentOffset.x) / viewportState.scale,
      y: geometry.contentBounds.y + (viewportState.scrollTop + viewport.heightCssPx / 2 - alignmentOffset.y) / viewportState.scale,
    },
  }
}

export function fitViewport(geometry: SvgGeometry, viewport: ViewportSize): MermaidViewportState {
  const scale = overlayFitScale(geometry, viewport)
  if (!validPositive(scale)) throw new Error('Viewport dimensions and device pixel ratio must be finite positive values')
  return { scale, fitScale: scale, scrollLeft: 0, scrollTop: 0, revision: 0 }
}

function limits(geometry: SvgGeometry, viewport: ViewportSize, scale: number): { x: number; y: number } {
  return {
    x: Math.max(0, geometry.contentBounds.width * scale - viewport.widthCssPx),
    y: Math.max(0, geometry.contentBounds.height * scale - viewport.heightCssPx),
  }
}

function clamp(value: number, maximum: number): number {
  return Math.min(maximum, Math.max(0, Number.isFinite(value) ? value : 0))
}

export function reprojectViewportCenter(
  state: MermaidViewportState,
  previousGeometry: SvgGeometry,
  nextGeometry: SvgGeometry,
  viewport: ViewportSize,
): MermaidViewportState {
  const nextFitScale = overlayFitScale(nextGeometry, viewport)
  if (!validPositive(nextFitScale)) throw new Error('Viewport dimensions and device pixel ratio must be finite positive values')
  const previousOffset = viewportAlignmentOffset(previousGeometry, viewport, state.scale)
  const centerGraphX = previousGeometry.contentBounds.x + (state.scrollLeft + viewport.widthCssPx / 2 - previousOffset.x) / state.scale
  const centerGraphY = previousGeometry.contentBounds.y + (state.scrollTop + viewport.heightCssPx / 2 - previousOffset.y) / state.scale
  const scale = Math.min(MAX_SCALE, Math.max(nextFitScale, state.scale))
  const nextOffset = viewportAlignmentOffset(nextGeometry, viewport, scale)
  const maximum = limits(nextGeometry, viewport, scale)
  return {
    scale,
    fitScale: nextFitScale,
    scrollLeft: clamp(nextOffset.x + (centerGraphX - nextGeometry.contentBounds.x) * scale - viewport.widthCssPx / 2, maximum.x),
    scrollTop: clamp(nextOffset.y + (centerGraphY - nextGeometry.contentBounds.y) * scale - viewport.heightCssPx / 2, maximum.y),
    revision: state.revision + 1,
  }
}

export function transitionMermaidViewport(
  state: MermaidViewportState,
  event: MermaidViewportEvent,
  geometry: SvgGeometry,
  viewport: ViewportSize,
  configuration: MermaidViewportConfiguration,
): MermaidViewportState {
  if (event.type === 'fit' || (event.type === 'key' && event.key === '0')) {
    return { ...fitViewport(geometry, viewport), revision: state.revision + 1 }
  }
  if (event.type === 'key') {
    if (event.key === '+' || event.key === '=') {
      return transitionMermaidViewport(state, { type: 'zoom-at', factor: configuration.zoomStep, x: event.x ?? viewport.widthCssPx / 2, y: event.y ?? viewport.heightCssPx / 2 }, geometry, viewport, configuration)
    }
    if (event.key === '-') {
      return transitionMermaidViewport(state, { type: 'zoom-at', factor: 1 / configuration.zoomStep, x: event.x ?? viewport.widthCssPx / 2, y: event.y ?? viewport.heightCssPx / 2 }, geometry, viewport, configuration)
    }
    const movement: Readonly<Record<string, readonly [number, number]>> = {
      ArrowLeft: [-configuration.panStep, 0], ArrowRight: [configuration.panStep, 0],
      ArrowUp: [0, -configuration.panStep], ArrowDown: [0, configuration.panStep],
    }
    const delta = movement[event.key]
    return delta ? transitionMermaidViewport(state, { type: 'pan-by', dx: delta[0], dy: delta[1] }, geometry, viewport, configuration) : state
  }
  if (event.type === 'wheel') {
    return event.zoom
      ? transitionMermaidViewport(state, { type: 'zoom-at', factor: Math.pow(configuration.zoomStep, -event.deltaY / 120), x: event.x, y: event.y }, geometry, viewport, configuration)
      : transitionMermaidViewport(state, { type: 'pan-by', dx: event.deltaX, dy: event.deltaY }, geometry, viewport, configuration)
  }
  if (event.type === 'zoom-at') {
    const scale = Math.min(MAX_SCALE, Math.max(state.fitScale, state.scale * event.factor))
    const ratio = scale / state.scale
    const previousOffset = viewportAlignmentOffset(geometry, viewport, state.scale)
    const nextOffset = viewportAlignmentOffset(geometry, viewport, scale)
    const maximum = limits(geometry, viewport, scale)
    return {
      ...state,
      scale,
      scrollLeft: clamp(nextOffset.x + (state.scrollLeft + event.x - previousOffset.x) * ratio - event.x, maximum.x),
      scrollTop: clamp(nextOffset.y + (state.scrollTop + event.y - previousOffset.y) * ratio - event.y, maximum.y),
      revision: state.revision + 1,
    }
  }
  const maximum = limits(geometry, viewport, state.scale)
  return {
    ...state,
    scrollLeft: clamp(state.scrollLeft + event.dx, maximum.x),
    scrollTop: clamp(state.scrollTop + event.dy, maximum.y),
    revision: state.revision + 1,
  }
}
