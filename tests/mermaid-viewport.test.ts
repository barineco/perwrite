import { describe, expect, it } from 'vitest'
import {
  fitViewport,
  inlineOverviewScale,
  overlayFitScale,
  reprojectViewportCenter,
  resolveViewportPresentation,
  transitionMermaidViewport,
  unionRect,
  viewportAlignmentOffset,
  type SvgGeometry,
} from '../webview/editor/mermaid-viewport'

const geometry: SvgGeometry = {
  viewBox: { x: 0, y: 0, width: 1000, height: 500 },
  graphBounds: { x: -50, y: -25, width: 1100, height: 550 },
  contentBounds: { x: -50, y: -25, width: 1100, height: 550 },
}

const configuration = { panStep: 80, zoomStep: 1.5 }

describe('Mermaid viewport state', () => {
  it('uses the union of declared and rendered geometry', () => {
    expect(unionRect(geometry.viewBox, geometry.graphBounds)).toEqual(geometry.contentBounds)
  })

  it('only shrinks the inline overview', () => {
    expect(inlineOverviewScale(geometry, 550)).toBe(0.5)
    expect(inlineOverviewScale(geometry, 2200)).toBe(1)
  })

  it('fits horizontal and vertical bounds independently of DPR', () => {
    expect(overlayFitScale(geometry, { widthCssPx: 600, heightCssPx: 400, devicePixelRatio: 1 })).toBeCloseTo(552 / 1100)
    expect(overlayFitScale(geometry, { widthCssPx: 600, heightCssPx: 400, devicePixelRatio: 2 })).toBeCloseTo(552 / 1100)
  })

  it('keeps the pointer graph coordinate stable while zooming and clamps scale', () => {
    const viewport = { widthCssPx: 600, heightCssPx: 400, devicePixelRatio: 2 }
    const initial = fitViewport(geometry, viewport)
    const zoomed = transitionMermaidViewport(initial, { type: 'zoom-at', factor: 2, x: 200, y: 100 }, geometry, viewport, configuration)
    const initialOffset = viewportAlignmentOffset(geometry, viewport, initial.scale)
    const zoomedOffset = viewportAlignmentOffset(geometry, viewport, zoomed.scale)
    expect((initial.scrollLeft + 200 - initialOffset.x) / initial.scale)
      .toBeCloseTo((zoomed.scrollLeft + 200 - zoomedOffset.x) / zoomed.scale)
    const maximum = transitionMermaidViewport(zoomed, { type: 'zoom-at', factor: 100, x: 0, y: 0 }, geometry, viewport, configuration)
    expect(maximum.scale).toBe(8)
  })

  it('clamps pan on every side and increments one revision per accepted event', () => {
    const viewport = { widthCssPx: 300, heightCssPx: 200, devicePixelRatio: 1 }
    let state = fitViewport(geometry, viewport)
    state = transitionMermaidViewport(state, { type: 'zoom-at', factor: 4, x: 0, y: 0 }, geometry, viewport, configuration)
    const negative = transitionMermaidViewport(state, { type: 'pan-by', dx: -9999, dy: -9999 }, geometry, viewport, configuration)
    expect([negative.scrollLeft, negative.scrollTop]).toEqual([0, 0])
    const positive = transitionMermaidViewport(negative, { type: 'pan-by', dx: 9999, dy: 9999 }, geometry, viewport, configuration)
    expect(positive.scrollLeft).toBeGreaterThan(0)
    expect(positive.scrollTop).toBeGreaterThan(0)
    expect(positive.revision).toBe(negative.revision + 1)
  })

  it('maps wheel and keyboard to the same transitions and fit reset', () => {
    const viewport = { widthCssPx: 300, heightCssPx: 200, devicePixelRatio: 1 }
    const initial = fitViewport(geometry, viewport)
    const wheel = transitionMermaidViewport(initial, { type: 'wheel', deltaX: 0, deltaY: -120, x: 100, y: 50, zoom: true }, geometry, viewport, configuration)
    const key = transitionMermaidViewport(wheel, { type: 'key', key: 'ArrowRight' }, geometry, viewport, configuration)
    const fitted = transitionMermaidViewport(key, { type: 'key', key: '0' }, geometry, viewport, configuration)
    expect(wheel.scale / initial.scale).toBeCloseTo(configuration.zoomStep)
    expect(wheel.scale).toBeGreaterThan(initial.scale)
    const availablePan = geometry.contentBounds.width * wheel.scale - viewport.widthCssPx - wheel.scrollLeft
    expect(key.scrollLeft - wheel.scrollLeft).toBeCloseTo(Math.min(configuration.panStep, availablePan))
    expect(fitted).toMatchObject({ scale: initial.scale, scrollLeft: 0, scrollTop: 0 })
  })

  it('reprojects the viewport center graph coordinate after geometry changes', () => {
    const viewport = { widthCssPx: 300, heightCssPx: 200, devicePixelRatio: 1 }
    const state = { ...fitViewport(geometry, viewport), scale: 1, fitScale: 0.2, scrollLeft: 250, scrollTop: 100, revision: 4 }
    const nextGeometry: SvgGeometry = {
      viewBox: { x: -300, y: -100, width: 1800, height: 900 },
      graphBounds: { x: -300, y: -100, width: 1800, height: 900 },
      contentBounds: { x: -300, y: -100, width: 1800, height: 900 },
    }
    const projected = reprojectViewportCenter(state, geometry, nextGeometry, viewport)
    const previousOffset = viewportAlignmentOffset(geometry, viewport, state.scale)
    const nextOffset = viewportAlignmentOffset(nextGeometry, viewport, projected.scale)
    const previousCenter = {
      x: geometry.contentBounds.x + (state.scrollLeft + viewport.widthCssPx / 2 - previousOffset.x) / state.scale,
      y: geometry.contentBounds.y + (state.scrollTop + viewport.heightCssPx / 2 - previousOffset.y) / state.scale,
    }
    const nextCenter = {
      x: nextGeometry.contentBounds.x + (projected.scrollLeft + viewport.widthCssPx / 2 - nextOffset.x) / projected.scale,
      y: nextGeometry.contentBounds.y + (projected.scrollTop + viewport.heightCssPx / 2 - nextOffset.y) / projected.scale,
    }
    expect(nextCenter.x).toBeCloseTo(previousCenter.x)
    expect(nextCenter.y).toBeCloseTo(previousCenter.y)
    expect(projected).toMatchObject({ scale: 1, revision: 5 })
  })

  it('preserves the viewport center graph coordinate when geometry is unchanged and viewport size updates', () => {
    const newViewport = { widthCssPx: 300, heightCssPx: 200, devicePixelRatio: 1 }
    const state = { scale: 1, fitScale: 0.5, scrollLeft: 250, scrollTop: 100, revision: 4 }
    const previousGeometry = geometry
    const nextGeometry = geometry
    expect(previousGeometry).toEqual(nextGeometry)
    const projected = reprojectViewportCenter(state, previousGeometry, nextGeometry, newViewport)
    const preservedOffset = viewportAlignmentOffset(geometry, newViewport, state.scale)
    const preservedCenter = {
      x: geometry.contentBounds.x + (state.scrollLeft + newViewport.widthCssPx / 2 - preservedOffset.x) / state.scale,
      y: geometry.contentBounds.y + (state.scrollTop + newViewport.heightCssPx / 2 - preservedOffset.y) / state.scale,
    }
    const presentation = resolveViewportPresentation(geometry, newViewport, projected)
    expect(presentation.centerGraph.x).toBeCloseTo(preservedCenter.x)
    expect(presentation.centerGraph.y).toBeCloseTo(preservedCenter.y)
    expect(projected.revision).toBe(state.revision + 1)
  })

  it('centers fitted content on both axes and removes the offset as content overflows', () => {
    const viewport = { widthCssPx: 600, heightCssPx: 400, devicePixelRatio: 1 }
    const fitted = fitViewport(geometry, viewport)
    const centered = viewportAlignmentOffset(geometry, viewport, fitted.scale)
    expect(centered.x).toBeCloseTo(24)
    expect(centered.y).toBeGreaterThan(0)
    expect(viewportAlignmentOffset(geometry, viewport, 2)).toEqual({ x: 0, y: 0 })
  })

  it('resolves DOM presentation from geometry, viewport, and viewport state', () => {
    const viewport = { widthCssPx: 600, heightCssPx: 400, devicePixelRatio: 1 }
    const viewportState = fitViewport(geometry, viewport)
    const presentation = resolveViewportPresentation(geometry, viewport, viewportState)
    expect(presentation.canvasSize).toEqual({ width: 600, height: 400 })
    expect(presentation.alignmentOffset.x).toBeCloseTo(24)
    expect(presentation.centerGraph).toEqual({ x: 500, y: 250 })
  })

  it('rejects invalid viewport dimensions', () => {
    const state = { scale: 1, fitScale: 0.5, scrollLeft: 0, scrollTop: 0, revision: 0 }
    expect(overlayFitScale(geometry, { widthCssPx: 0, heightCssPx: 10, devicePixelRatio: 1 })).toBeNaN()
    expect(() => fitViewport(geometry, { widthCssPx: 10, heightCssPx: 10, devicePixelRatio: 0 })).toThrow()
    expect(() => reprojectViewportCenter(state, geometry, geometry, { widthCssPx: 0, heightCssPx: 10, devicePixelRatio: 1 })).toThrow()
    expect(() => reprojectViewportCenter(state, geometry, geometry, { widthCssPx: 10, heightCssPx: 10, devicePixelRatio: 0 })).toThrow()
  })
})
