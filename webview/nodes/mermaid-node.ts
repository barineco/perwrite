import { EditorSelection, Transaction } from '@codemirror/state'
import { WidgetType, type EditorView } from '@codemirror/view'
import arrowsPointingInIcon from 'heroicons/24/outline/arrows-pointing-in.svg'
import magnifyingGlassMinusIcon from 'heroicons/24/outline/magnifying-glass-minus.svg'
import magnifyingGlassPlusIcon from 'heroicons/24/outline/magnifying-glass-plus.svg'
import pencilSquareIcon from 'heroicons/24/outline/pencil-square.svg'
import xMarkIcon from 'heroicons/24/outline/x-mark.svg'
import { getAppearanceMetrics, getAppearanceVersion } from '../appearance'
import { getFontResourceGeneration } from '../font-resource'
import { imageDocumentGeneration } from '../editor/image-widget'
import { iconButton as createIconButton, Modal } from '../components/modal'
import type { RenderingProfile } from '../../src/protocol'
import {
  buildGeometryCacheKey,
  evaluateMermaidEstimatedHeight,
  getRememberedEditorContentWidth,
  mermaidInlineContentWidth,
  mermaidWidgetHeightFromDiagramHeight,
  readEditorContentWidth,
  setMermaidGeometryTheme,
  type MermaidBlockChrome,
} from '../mermaid-geometry-cache'
import {
  createMermaidPreparationTarget,
  prepareMermaidDiagram,
  type MermaidPreparationResult,
  type MermaidPreparationTarget,
  type PreparedMermaidDiagram,
} from '../renderers/mermaid-preparation'
import {
  renderMermaid,
  type MermaidFailure,
  type MermaidRenderInput,
  type MermaidRenderResult,
  type MermaidRenderTarget,
  type MermaidSvgMarkup,
} from '../renderers/mermaid-renderer'
import {
  fitViewport,
  inlineOverviewScale,
  reprojectViewportCenter,
  resolveViewportPresentation,
  transitionMermaidViewport,
  type MermaidViewportEvent,
  type MermaidViewportConfiguration,
  type MermaidViewportState,
  type SvgGeometry,
  type ViewportSize,
} from '../editor/mermaid-viewport'

export type MermaidConfiguration = Pick<
  RenderingProfile,
  'mermaidLayout' | 'mermaidMaxEdges' | 'mermaidPanStep' | 'mermaidZoomStep'
>

let mermaidTheme: 'default' | 'dark' = 'default'

const svgCache = new Map<string, MermaidSvgMarkup>()
const controllers = new WeakMap<HTMLElement, MermaidPresentationController>()
const activeControllers = new Set<MermaidPresentationController>()

function mermaidLineCount(source: string): number {
  return source.split('\n').length
}

function mermaidBlockChrome(): MermaidBlockChrome {
  const metrics = getAppearanceMetrics()
  return {
    paddingPx: metrics.mermaidBlockPaddingPx,
    borderPx: metrics.mermaidBlockBorderPx,
  }
}

function evaluateMermaidWidgetHeight(
  source: string,
  configuration: MermaidConfiguration,
): number {
  const chrome = mermaidBlockChrome()
  const editorWidth = getRememberedEditorContentWidth()
  const diagramHeight = evaluateMermaidEstimatedHeight({
    cacheKey: buildGeometryCacheKey(
      {
        theme: mermaidTheme,
        layout: configuration.mermaidLayout,
        maxEdges: configuration.mermaidMaxEdges,
        source,
      },
      getAppearanceVersion(),
      getFontResourceGeneration(),
    ),
    lineCount: mermaidLineCount(source),
    lineHeightPx: getAppearanceMetrics().lineHeightPx,
    availableWidth: editorWidth === null ? null : mermaidInlineContentWidth(editorWidth, chrome),
  })
  return mermaidWidgetHeightFromDiagramHeight(diagramHeight, chrome)
}

type MermaidIcon = 'zoom-in' | 'zoom-out' | 'fit' | 'close' | 'edit'

const iconMarkup: Readonly<Record<MermaidIcon, string>> = {
  'zoom-in': magnifyingGlassPlusIcon,
  'zoom-out': magnifyingGlassMinusIcon,
  fit: arrowsPointingInIcon,
  close: xMarkIcon,
  edit: pencilSquareIcon,
}

function iconButton(label: string, icon: MermaidIcon, className = ''): HTMLButtonElement {
  return createIconButton(label, iconMarkup[icon], className)
}

export function updateMermaidTheme(themeKind: string): void {
  mermaidTheme = (themeKind === 'light' || themeKind === 'hc-light') ? 'default' : 'dark'
  setMermaidGeometryTheme(mermaidTheme)
  svgCache.clear()
}

export function refreshMermaidPresentations(): void {
  for (const controller of activeControllers) void controller.refresh(mermaidTheme)
}

function failureElement(failure: MermaidFailure, source: string): HTMLElement {
  const root = document.createElement('div')
  root.className = 'cm-mermaid-error'
  root.dataset.failureKind = failure.kind
  root.append(
    Object.assign(document.createElement('div'), {
      className: 'cm-render-error-reason', textContent: `Mermaid ${failure.kind} failure: ${failure.reason}`,
    }),
    Object.assign(document.createElement('code'), {
      className: 'cm-render-error-source', textContent: source,
    }),
  )
  return root
}

function viewportSize(viewport: HTMLElement): ViewportSize {
  return {
    widthCssPx: viewport.clientWidth || window.innerWidth,
    heightCssPx: viewport.clientHeight || window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  }
}

export interface MermaidRenderIdentity {
  readonly cacheKey: string
}

export interface MermaidRequest {
  readonly generation: number
  readonly source: string
  readonly configuration: MermaidConfiguration
  readonly theme: 'default' | 'dark'
  readonly documentGeneration: number
  readonly appearanceVersion: number
  readonly fontResourceGeneration: number
  readonly renderIdentity: MermaidRenderIdentity
}

export type MermaidPresentation =
  | { readonly kind: 'Preparing'; readonly request: MermaidRequest }
  | { readonly kind: 'Empty'; readonly request: MermaidRequest }
  | { readonly kind: 'Presented'; readonly request: MermaidRequest; readonly diagram: PreparedMermaidDiagram }
  | { readonly kind: 'Failed'; readonly request: MermaidRequest; readonly failure: MermaidFailure }

export type MermaidOverlayState =
  | { readonly kind: 'Closed' }
  | {
    readonly kind: 'Open'
    readonly request: MermaidRequest
    readonly modal: Modal
    readonly viewport: HTMLElement
    readonly canvas: HTMLElement
    readonly svg: SVGSVGElement
    readonly diagram: PreparedMermaidDiagram
    readonly state: MermaidViewportState
    readonly documentScroll: { readonly left: number; readonly top: number }
  }
  | {
    readonly kind: 'OpenFailed'
    readonly request: MermaidRequest
    readonly modal: Modal
    readonly documentScroll: { readonly left: number; readonly top: number }
  }

export interface MermaidPresentationDependencies {
  readonly render: (input: MermaidRenderInput, target: MermaidRenderTarget) => Promise<MermaidRenderResult>
  readonly createPreparationTarget: (widthCssPx: number) => MermaidPreparationTarget
  readonly prepare: (
    rendered: MermaidSvgMarkup,
    target: MermaidPreparationTarget,
    measurement: import('../renderers/mermaid-preparation').MermaidMeasurementInput,
  ) => Promise<MermaidPreparationResult>
}

const productionMermaidPresentationDependencies: MermaidPresentationDependencies = {
  render: renderMermaid,
  createPreparationTarget: createMermaidPreparationTarget,
  prepare: prepareMermaidDiagram,
}

interface MermaidOverlayRecovery {
  readonly state: MermaidViewportState
  readonly geometry: SvgGeometry
  readonly documentScroll: { readonly left: number; readonly top: number }
  readonly reopen: true
}

export class MermaidPresentationController {
  private generation = 0
  private request: MermaidRequest
  private presentation: MermaidPresentation
  private overlay: MermaidOverlayState = { kind: 'Closed' }
  private overlayViewportResizeObserver: ResizeObserver | null = null
  private overlayViewportObservedSize: ViewportSize | null = null
  private pointerId: number | null = null
  private pointerPoint: { x: number; y: number } | null = null
  private disposed = false
  private pendingDocumentScroll: { readonly left: number; readonly top: number } | null = null
  private sourceFrom: number

  constructor(
    private readonly root: HTMLElement,
    private readonly view: EditorView,
    source: string,
    configuration: MermaidConfiguration,
    theme: 'default' | 'dark',
    sourceFrom = -1,
    private readonly dependencies: MermaidPresentationDependencies = productionMermaidPresentationDependencies,
  ) {
    this.sourceFrom = sourceFrom
    this.request = this.createRequest(0, source, configuration, theme)
    this.presentation = { kind: 'Empty', request: this.request }
    this.root.dataset.mermaidController = 'true'
  }

  updateSourceFrom(sourceFrom: number): void {
    this.sourceFrom = sourceFrom
  }

  private editSource(): void {
    const sourceFrom = this.sourceFrom
    this.closeOverlay(false)
    if (sourceFrom < 0) return
    this.view.dispatch({
      selection: EditorSelection.cursor(sourceFrom),
      scrollIntoView: true,
      annotations: Transaction.userEvent.of('select.pointer'),
    })
    this.view.focus()
  }

  refresh(theme = this.request.theme): Promise<void> {
    return this.render(this.request.source, this.request.configuration, theme)
  }

  async render(
    source = this.request.source,
    configuration = this.request.configuration,
    theme = this.request.theme,
  ): Promise<void> {
    const request = this.beginRequest(source, configuration, theme)
    if (this.presentation.kind === 'Empty') return

    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    if (!this.isCurrent(request)) return

    const preparation = this.dependencies.createPreparationTarget(
      (() => {
        const chrome = mermaidBlockChrome()
        const editorWidth = readEditorContentWidth(this.view)
        const contentWidth = editorWidth === null ? null : mermaidInlineContentWidth(editorWidth, chrome)
        if (contentWidth !== null) return contentWidth
        const client = this.root.clientWidth || this.root.parentElement?.clientWidth || 0
        return mermaidInlineContentWidth(client, chrome) ?? Math.max(1, client)
      })(),
    )
    try {
      let rendered = svgCache.get(request.renderIdentity.cacheKey)
      if (!rendered) {
        const result = await this.dependencies.render({
          source: request.source,
          layout: request.configuration.mermaidLayout,
          maxEdges: request.configuration.mermaidMaxEdges,
          theme: request.theme,
        }, preparation)
        if (!this.isCurrent(request)) return
        if (!result.ok) {
          this.applyFailure(request, result.error)
          return
        }
        rendered = result.value
        svgCache.set(request.renderIdentity.cacheKey, rendered)
      }
      const prepared = await this.dependencies.prepare(rendered, preparation, {
        documentGeneration: request.documentGeneration,
        appearanceVersion: request.appearanceVersion,
        fontResourceGeneration: request.fontResourceGeneration,
      })
      if (!this.isCurrent(request)) return
      if (!prepared.ok) {
        this.applyFailure(request, prepared.error)
        return
      }
      this.completeRequest(request, prepared.value)
    } finally {
      preparation.dispose()
    }
  }

  private createRequest(
    generation: number,
    source: string,
    configuration: MermaidConfiguration,
    theme: 'default' | 'dark',
  ): MermaidRequest {
    return {
      generation,
      source,
      configuration,
      theme,
      documentGeneration: this.view.state.field(imageDocumentGeneration, false) ?? 0,
      appearanceVersion: getAppearanceVersion(),
      fontResourceGeneration: getFontResourceGeneration(),
      renderIdentity: {
        cacheKey: `${theme}\u0000${configuration.mermaidLayout}\u0000${configuration.mermaidMaxEdges}\u0000${source}`,
      },
    }
  }

  private beginRequest(
    source: string,
    configuration: MermaidConfiguration,
    theme: 'default' | 'dark',
  ): MermaidRequest {
    if (!source.trim()) this.closeOverlay(false)
    this.pendingDocumentScroll = null

    const request = this.createRequest(++this.generation, source, configuration, theme)
    this.request = request
    this.presentation = source.trim()
      ? { kind: 'Preparing', request }
      : { kind: 'Empty', request }
    this.presentInline()
    return request
  }

  private isCurrent(request: MermaidRequest): boolean {
    return !this.disposed
      && this.root.isConnected
      && this.request.generation === request.generation
      && (this.view.state.field(imageDocumentGeneration, false) ?? 0) === request.documentGeneration
      && getAppearanceVersion() === request.appearanceVersion
      && getFontResourceGeneration() === request.fontResourceGeneration
  }

  private completeRequest(request: MermaidRequest, diagram: PreparedMermaidDiagram): void {
    if (!this.isCurrent(request)) return
    const overlayWasOpen = this.overlay.kind === 'Open' || this.overlay.kind === 'OpenFailed'
    this.presentation = { kind: 'Presented', request, diagram }
    const open = this.presentInline()
    if (overlayWasOpen && open) this.mountOverlay(open, this.presentation)
    this.view.requestMeasure()
    this.root.dispatchEvent(new Event('mermaid-rendered', { bubbles: true }))
  }

  private presentInline(): HTMLElement | null {
    const presentation = this.presentation
    this.root.replaceChildren()
    if (presentation.kind === 'Preparing') {
      this.root.style.minHeight = `${evaluateMermaidWidgetHeight(
        presentation.request.source,
        presentation.request.configuration,
      )}px`
      this.root.dataset.presentation = 'preparing'
      return null
    }
    if (presentation.kind === 'Empty') {
      this.root.style.minHeight = ''
      this.root.dataset.presentation = 'empty'
      this.root.replaceChildren(Object.assign(document.createElement('em'), {
        className: 'cm-mermaid-placeholder', textContent: 'Empty mermaid diagram',
      }))
      return null
    }
    if (presentation.kind === 'Failed') {
      this.root.style.minHeight = ''
      this.root.dataset.presentation = 'failed'
      this.root.replaceChildren(failureElement(presentation.failure, presentation.request.source))
      return null
    }
    const { diagram } = presentation
    const bounds = diagram.geometry.contentBounds
    const overview = document.createElement('div')
    overview.className = 'cm-mermaid-overview'
    overview.tabIndex = 0
    overview.setAttribute('role', 'button')
    overview.setAttribute('aria-label', '拡大表示')
    const editorWidth = readEditorContentWidth(this.view)
    const chrome = mermaidBlockChrome()
    const available = (editorWidth === null ? null : mermaidInlineContentWidth(editorWidth, chrome)) ?? bounds.width
    const scale = inlineOverviewScale(diagram.geometry, available)
    const svg = diagram.svg.cloneNode(true) as SVGSVGElement
    svg.style.width = `${bounds.width * scale}px`
    svg.style.height = `${bounds.height * scale}px`
    overview.append(svg)
    overview.addEventListener('mousedown', event => {
      this.pendingDocumentScroll = { left: this.view.scrollDOM.scrollLeft, top: this.view.scrollDOM.scrollTop }
      event.preventDefault()
      event.stopPropagation()
    })
    overview.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      this.openOverlay(overview)
    })
    overview.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      event.stopPropagation()
      this.openOverlay(overview)
    })
    this.root.style.minHeight = ''
    this.root.dataset.presentation = 'presented'
    this.root.replaceChildren(overview)
    return overview
  }

  private applyFailure(request: MermaidRequest, failure: MermaidFailure): void {
    if (!this.isCurrent(request)) return
    this.presentation = { kind: 'Failed', request, failure }
    if (this.overlay.kind === 'Open' || this.overlay.kind === 'OpenFailed') {
      const modal = this.overlay.modal
      const documentScroll = this.overlay.documentScroll
      modal.root.dataset.failureKind = failure.kind
      modal.surface.classList.add('cm-mermaid-overlay-failure')
      const close = iconButton('閉じる', 'close')
      close.addEventListener('click', event => { event.stopPropagation(); this.closeOverlay(true) })
      modal.actions.replaceChildren(close)
      modal.content.replaceChildren(failureElement(failure, request.source))
      this.overlay = { kind: 'OpenFailed', request, modal, documentScroll }
      this.pointerId = null
      this.pointerPoint = null
      close.focus()
    }
    this.root.style.minHeight = ''
    this.root.dataset.presentation = 'failed'
    this.root.replaceChildren(failureElement(failure, request.source))
    this.view.requestMeasure()
    this.root.dispatchEvent(new CustomEvent('mermaid-failed', { bubbles: true, detail: failure }))
  }

  private openOverlay(returnTarget: HTMLElement): void {
    const presentation = this.presentation
    if (this.overlay.kind !== 'Closed' || presentation.kind !== 'Presented' || !this.isCurrent(presentation.request)) return
    this.mountOverlay(returnTarget, presentation)
  }

  private mountOverlay(
    returnTarget: HTMLElement,
    presentation: Extract<MermaidPresentation, { kind: 'Presented' }>,
  ): void {
    if (!this.isCurrent(presentation.request)) return
    const previousOverlay = this.overlay
    const recovery: MermaidOverlayRecovery | null = previousOverlay.kind === 'Open'
      ? { state: previousOverlay.state, geometry: previousOverlay.diagram.geometry, documentScroll: previousOverlay.documentScroll, reopen: true }
      : null
    const documentScroll = this.pendingDocumentScroll ?? recovery?.documentScroll ?? {
      left: this.view.scrollDOM.scrollLeft,
      top: this.view.scrollDOM.scrollTop,
    }
    this.pendingDocumentScroll = null
    this.closeOverlay(false)
    const modal = new Modal({
      label: 'Mermaid プレビュー',
      returnTarget,
      onRequestClose: () => this.closeOverlay(true),
      className: 'cm-mermaid-overlay',
      surfaceClassName: 'cm-mermaid-overlay-panel',
      actionsClassName: 'cm-mermaid-overlay-controls',
      contentClassName: 'cm-mermaid-overlay-viewport',
    })
    const viewport = modal.content
    viewport.tabIndex = 0
    const canvas = document.createElement('div')
    canvas.className = 'cm-mermaid-overlay-canvas'
    const svg = presentation.diagram.svg.cloneNode(true) as SVGSVGElement
    svg.removeAttribute('style')
    canvas.append(svg)
    viewport.append(canvas)
    const actions: readonly [string, MermaidIcon, () => void][] = [
      ['編集', 'edit', () => this.editSource()],
      ['拡大', 'zoom-in', () => this.transition({ type: 'zoom-at', factor: presentation.request.configuration.mermaidZoomStep, x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 })],
      ['縮小', 'zoom-out', () => this.transition({ type: 'zoom-at', factor: 1 / presentation.request.configuration.mermaidZoomStep, x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 })],
      ['全体表示', 'fit', () => this.transition({ type: 'fit' })],
      ['閉じる', 'close', () => this.closeOverlay(true)],
    ]
    for (const [label, icon, action] of actions) {
      const button = iconButton(label, icon)
      button.addEventListener('click', event => { event.stopPropagation(); action() })
      modal.actions.append(button)
    }
    viewport.addEventListener('wheel', event => {
      event.preventDefault()
      event.stopPropagation()
      const rect = viewport.getBoundingClientRect()
      this.transition({ type: 'wheel', deltaX: event.deltaX, deltaY: event.deltaY, x: event.clientX - rect.left, y: event.clientY - rect.top, zoom: event.ctrlKey || event.metaKey })
    }, { passive: false })
    viewport.addEventListener('pointerdown', event => {
      this.pointerId = event.pointerId
      this.pointerPoint = { x: event.clientX, y: event.clientY }
      viewport.setPointerCapture(event.pointerId)
    })
    viewport.addEventListener('pointermove', event => {
      if (event.pointerId !== this.pointerId || !this.pointerPoint) return
      this.transition({ type: 'pan-by', dx: this.pointerPoint.x - event.clientX, dy: this.pointerPoint.y - event.clientY })
      this.pointerPoint = { x: event.clientX, y: event.clientY }
    })
    const endPointer = (event: PointerEvent) => {
      if (event.pointerId !== this.pointerId) return
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId)
      this.pointerId = null
      this.pointerPoint = null
    }
    viewport.addEventListener('pointerup', endPointer)
    viewport.addEventListener('pointercancel', endPointer)
    viewport.addEventListener('keydown', event => {
      if (['+', '=', '-', '0', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault()
        event.stopPropagation()
        this.transition({ type: 'key', key: event.key })
      }
    })
    modal.root.addEventListener('click', event => event.stopPropagation())
    modal.root.dataset.returnTarget = returnTarget.className
    modal.mount()
    const size = viewportSize(viewport)
    const state = recovery
      ? reprojectViewportCenter(recovery.state, recovery.geometry, presentation.diagram.geometry, size)
      : fitViewport(presentation.diagram.geometry, size)
    this.overlay = {
      kind: 'Open', request: presentation.request, modal, viewport, canvas, svg,
      diagram: presentation.diagram, state, documentScroll,
    }
    this.applyViewportState()
    this.attachOverlayViewportResizeObservation(viewport)
    modal.present(viewport)
  }

  private attachOverlayViewportResizeObservation(viewport: HTMLElement): void {
    this.detachOverlayViewportResizeObservation()
    this.overlayViewportObservedSize = viewportSize(viewport)
    const observer = new ResizeObserver(() => this.handleOverlayViewportResize())
    observer.observe(viewport)
    this.overlayViewportResizeObserver = observer
  }

  private detachOverlayViewportResizeObservation(): void {
    this.overlayViewportResizeObserver?.disconnect()
    this.overlayViewportResizeObserver = null
    this.overlayViewportObservedSize = null
  }

  private handleOverlayViewportResize(): void {
    const overlay = this.overlay
    if (overlay.kind !== 'Open') return
    const nextSize = viewportSize(overlay.viewport)
    const previousSize = this.overlayViewportObservedSize
    if (
      previousSize &&
      previousSize.widthCssPx === nextSize.widthCssPx &&
      previousSize.heightCssPx === nextSize.heightCssPx &&
      previousSize.devicePixelRatio === nextSize.devicePixelRatio
    ) return
    if (
      !(Number.isFinite(nextSize.widthCssPx) && nextSize.widthCssPx > 0) ||
      !(Number.isFinite(nextSize.heightCssPx) && nextSize.heightCssPx > 0) ||
      !(Number.isFinite(nextSize.devicePixelRatio) && nextSize.devicePixelRatio > 0)
    ) return
    const geometry = overlay.diagram.geometry
    const state = reprojectViewportCenter(overlay.state, geometry, geometry, nextSize)
    this.overlay = { ...overlay, state }
    this.overlayViewportObservedSize = nextSize
    this.applyViewportState()
  }

  private transition(event: MermaidViewportEvent): void {
    const overlay = this.overlay
    if (overlay.kind !== 'Open' || !this.isCurrent(overlay.request)) return
    const configuration: MermaidViewportConfiguration = {
      panStep: overlay.request.configuration.mermaidPanStep,
      zoomStep: overlay.request.configuration.mermaidZoomStep,
    }
    const state = transitionMermaidViewport(
      overlay.state, event, overlay.diagram.geometry, viewportSize(overlay.viewport), configuration,
    )
    this.overlay = { ...overlay, state }
    this.applyViewportState()
  }

  private applyViewportState(): void {
    const overlay = this.overlay
    if (overlay.kind !== 'Open' || !this.isCurrent(overlay.request)) return
    const bounds = overlay.diagram.geometry.contentBounds
    const presentation = resolveViewportPresentation(overlay.diagram.geometry, viewportSize(overlay.viewport), overlay.state)
    overlay.canvas.style.width = `${presentation.canvasSize.width}px`
    overlay.canvas.style.height = `${presentation.canvasSize.height}px`
    overlay.svg.style.width = `${bounds.width}px`
    overlay.svg.style.height = `${bounds.height}px`
    overlay.svg.style.left = `${presentation.alignmentOffset.x}px`
    overlay.svg.style.top = `${presentation.alignmentOffset.y}px`
    overlay.svg.style.transformOrigin = '0 0'
    overlay.svg.style.transform = `translate(0px, 0px) scale(${overlay.state.scale})`
    overlay.viewport.scrollLeft = overlay.state.scrollLeft
    overlay.viewport.scrollTop = overlay.state.scrollTop
    overlay.modal.root.dataset.viewportRevision = String(overlay.state.revision)
    overlay.modal.root.dataset.viewportScale = String(overlay.state.scale)
    overlay.modal.root.dataset.viewportScrollLeft = String(overlay.state.scrollLeft)
    overlay.modal.root.dataset.viewportScrollTop = String(overlay.state.scrollTop)
    overlay.modal.root.dataset.viewportCenterGraphX = String(presentation.centerGraph.x)
    overlay.modal.root.dataset.viewportCenterGraphY = String(presentation.centerGraph.y)
  }

  closeOverlay(restoreFocus: boolean): void {
    const overlay = this.overlay
    if (overlay.kind === 'Closed') return
    if (overlay.kind === 'Open' && this.pointerId !== null && overlay.viewport.hasPointerCapture(this.pointerId)) {
      overlay.viewport.releasePointerCapture(this.pointerId)
    }
    this.detachOverlayViewportResizeObservation()
    overlay.modal.dispose(restoreFocus)
    this.overlay = { kind: 'Closed' }
    this.pointerId = null
    this.pointerPoint = null
    this.view.scrollDOM.scrollLeft = overlay.documentScroll.left
    this.view.scrollDOM.scrollTop = overlay.documentScroll.top
  }

  destroy(): void {
    this.disposed = true
    this.generation++
    this.closeOverlay(false)
  }
}

export class MermaidWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly configuration: MermaidConfiguration,
    readonly sourceFrom = -1,
    readonly sourceTo = -1,
  ) { super() }

  eq(other: MermaidWidget): boolean {
    return this.source === other.source
      && this.configuration.mermaidLayout === other.configuration.mermaidLayout
      && this.configuration.mermaidMaxEdges === other.configuration.mermaidMaxEdges
      && this.configuration.mermaidPanStep === other.configuration.mermaidPanStep
      && this.configuration.mermaidZoomStep === other.configuration.mermaidZoomStep
      && this.sourceFrom === other.sourceFrom && this.sourceTo === other.sourceTo
  }

  ignoreEvent(event: Event): boolean {
    const target = event.target
    return target instanceof Element && Boolean(target.closest('.cm-mermaid-overview, .cm-mermaid-overlay'))
  }

  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement('div')
    root.className = 'cm-mermaid-block'
    root.dataset.sourceFrom = String(this.sourceFrom)
    root.dataset.sourceTo = String(this.sourceTo)
    const controller = new MermaidPresentationController(root, view, this.source, this.configuration, mermaidTheme, this.sourceFrom)
    controllers.set(root, controller)
    activeControllers.add(controller)
    void controller.render()
    return root
  }

  updateDOM(dom: HTMLElement, _view: EditorView): boolean {
    const controller = controllers.get(dom)
    if (!controller) return false
    dom.dataset.sourceFrom = String(this.sourceFrom)
    dom.dataset.sourceTo = String(this.sourceTo)
    controller.updateSourceFrom(this.sourceFrom)
    void controller.render(this.source, this.configuration, mermaidTheme)
    return true
  }

  destroy(dom: HTMLElement): void {
    const controller = controllers.get(dom)
    controller?.destroy()
    if (controller) activeControllers.delete(controller)
    controllers.delete(dom)
  }

  get estimatedHeight(): number {
    return evaluateMermaidWidgetHeight(this.source, this.configuration)
  }
}
