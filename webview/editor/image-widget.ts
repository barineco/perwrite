import { EditorSelection, StateField, Transaction } from '@codemirror/state'
import { ViewPlugin, WidgetType, type EditorView } from '@codemirror/view'
import pencilSquareIcon from 'heroicons/24/outline/pencil-square.svg'
import xMarkIcon from 'heroicons/24/outline/x-mark.svg'
import { iconButton, Modal } from '../components/modal'

let baseResourceUri = ''

export function setBaseResourceUri(uri: string): void {
  baseResourceUri = uri.endsWith('/') ? uri : uri + '/'
}

export function resolveImageSrc(src: string): string {
  if (/^https?:\/\/|^data:|^vscode-webview-resource:/.test(src)) return src
  if (baseResourceUri) return baseResourceUri + src
  return src
}

export const imageDocumentGeneration = StateField.define<number>({
  create: () => 0,
  update(value, transaction) {
    return transaction.docChanged ? value + 1 : value
  },
})

export interface DecodedImage {
  readonly source: string
  readonly resolvedSrc: string
  readonly documentGeneration: number
  readonly naturalWidth: number
  readonly naturalHeight: number
}

export type ImagePreparation =
  | { readonly kind: 'pending'; readonly source: string; readonly documentGeneration: number }
  | { readonly kind: 'ready'; readonly value: DecodedImage }
  | { readonly kind: 'failed'; readonly source: string; readonly documentGeneration: number; readonly failure: string }

type ImageCompletion = {
  readonly documentGeneration: number
  readonly resolvedSrc: string
}

type ImageLoader = (source: string, resolvedSrc: string, documentGeneration: number) => Promise<DecodedImage>

type ImageListener = (completion: ImageCompletion) => void

function imageError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function decodeImage(source: string, resolvedSrc: string, documentGeneration: number): Promise<DecodedImage> {
  const image = new Image()
  image.decoding = 'async'
  let resolveLoad: (() => void) | undefined
  let rejectLoad: ((error: Error) => void) | undefined
  const loaded = new Promise<void>((resolve, reject) => {
    resolveLoad = resolve
    rejectLoad = reject
    image.addEventListener('load', () => resolve(), { once: true })
    image.addEventListener('error', () => reject(new Error('Image load failed')), { once: true })
  })
  image.src = resolvedSrc
  if (image.complete) {
    if (image.naturalWidth > 0) resolveLoad?.()
    else rejectLoad?.(new Error('Image load failed'))
  }
  await loaded
  if (typeof image.decode === 'function') await image.decode()
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) throw new Error('Image has no intrinsic geometry')
  return {
    source,
    resolvedSrc,
    documentGeneration,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
  }
}

export class ImagePreparationCoordinator {
  private readonly entries = new Map<string, ImagePreparation>()
  private readonly requests = new Map<string, symbol>()
  private readonly listeners = new Set<ImageListener>()

  constructor(private readonly load: ImageLoader = decodeImage) {}

  prepare(source: string, documentGeneration: number): ImagePreparation {
    const resolvedSrc = resolveImageSrc(source)
    const key = `${documentGeneration}:${resolvedSrc}`
    const existing = this.entries.get(key)
    if (existing) return existing

    const pending: ImagePreparation = { kind: 'pending', source, documentGeneration }
    const request = Symbol(key)
    this.entries.set(key, pending)
    this.requests.set(key, request)
    void this.load(source, resolvedSrc, documentGeneration).then(value => {
      if (this.requests.get(key) !== request) return
      const current = this.entries.get(key)
      if (!current || current.kind !== 'pending') return
      if (value.documentGeneration !== documentGeneration || value.resolvedSrc !== resolvedSrc) return
      this.entries.set(key, { kind: 'ready', value })
      this.emit({ documentGeneration, resolvedSrc })
    }).catch(error => {
      if (this.requests.get(key) !== request) return
      const current = this.entries.get(key)
      if (!current || current.kind !== 'pending') return
      this.entries.set(key, {
        kind: 'failed', source, documentGeneration, failure: imageError(error),
      })
      this.emit({ documentGeneration, resolvedSrc })
    })
    return pending
  }

  subscribe(listener: ImageListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  clear(): void {
    this.entries.clear()
    this.requests.clear()
  }

  private emit(completion: ImageCompletion): void {
    for (const listener of this.listeners) listener(completion)
  }
}

const imageCoordinator = new ImagePreparationCoordinator()

export function prepareImage(source: string, documentGeneration: number): ImagePreparation {
  return imageCoordinator.prepare(source, documentGeneration)
}

export function getImagePreparationCoordinator(): ImagePreparationCoordinator {
  return imageCoordinator
}

export const imagePreparationExtension = ViewPlugin.fromClass(class {
  private readonly unsubscribe: () => void

  constructor(private readonly view: EditorView) {
    this.unsubscribe = imageCoordinator.subscribe(completion => {
      if ((view.state.field(imageDocumentGeneration, false) ?? 0) !== completion.documentGeneration) return
      view.dispatch({ effects: [] })
    })
  }

  destroy(): void {
    this.unsubscribe()
  }
})

export function createImageDom(preparation: ImagePreparation, source: string, alt: string): HTMLElement {
  if (preparation.kind === 'ready') {
    const img = document.createElement('img')
    img.className = 'cm-image'
    img.dataset.imageState = 'ready'
    img.dataset.imageDocumentGeneration = String(preparation.value.documentGeneration)
    img.src = preparation.value.resolvedSrc
    if (alt) img.alt = alt
    img.style.maxWidth = '100%'
    return img
  }
  const element = document.createElement('span')
  element.className = 'cm-image-status'
  element.dataset.imageState = preparation.kind
  const reason = document.createElement('span')
  reason.className = 'cm-image-status-reason'
  reason.textContent = preparation.kind === 'pending' ? 'Loading image' : `Image unavailable: ${preparation.failure}`
  element.append(reason)
  const sourceElement = document.createElement('code')
  sourceElement.textContent = source
  element.append(sourceElement)
  return element
}

function openImageOverlay(
  view: EditorView,
  returnTarget: HTMLElement,
  resolvedSrc: string,
  alt: string,
  sourceFrom: number,
): void {
  const modal = new Modal({
    label: alt || 'Image preview',
    returnTarget,
    onRequestClose: () => modal.dispose(true),
    className: 'cm-image-overlay',
    surfaceClassName: 'cm-image-overlay-panel',
    actionsClassName: 'cm-image-overlay-controls',
    contentClassName: 'cm-image-overlay-viewport',
  })
  const img = document.createElement('img')
  img.className = 'cm-image-overlay-image'
  img.src = resolvedSrc
  if (alt) img.alt = alt
  modal.content.append(img)
  modal.content.tabIndex = 0
  const edit = iconButton('編集', pencilSquareIcon)
  edit.addEventListener('click', event => {
    event.stopPropagation()
    modal.dispose(false)
    if (sourceFrom < 0) return
    view.dispatch({
      selection: EditorSelection.cursor(sourceFrom),
      scrollIntoView: true,
      annotations: Transaction.userEvent.of('select.pointer'),
    })
    view.focus()
  })
  const close = iconButton('閉じる', xMarkIcon)
  close.addEventListener('click', event => { event.stopPropagation(); modal.dispose(true) })
  modal.actions.append(edit, close)
  modal.root.addEventListener('click', event => event.stopPropagation())
  modal.mount()
  modal.present(modal.content)
}

export class ImageWidget extends WidgetType {
  constructor(
    readonly image: DecodedImage,
    readonly alt: string,
    readonly sourceFrom = -1,
    readonly sourceTo = -1,
  ) { super() }

  eq(other: ImageWidget): boolean {
    return this.image.source === other.image.source &&
      this.image.resolvedSrc === other.image.resolvedSrc &&
      this.image.documentGeneration === other.image.documentGeneration &&
      this.image.naturalWidth === other.image.naturalWidth &&
      this.image.naturalHeight === other.image.naturalHeight &&
      this.alt === other.alt &&
      this.sourceFrom === other.sourceFrom && this.sourceTo === other.sourceTo
  }

  ignoreEvent(event: Event): boolean {
    const target = event.target
    return target instanceof Element && Boolean(target.closest('.cm-image-overlay'))
  }

  toDOM(view: EditorView): HTMLElement {
    const img = createImageDom({ kind: 'ready', value: this.image }, this.image.source, this.alt) as HTMLImageElement
    img.classList.add('cm-image-clickable')
    img.tabIndex = 0
    img.setAttribute('role', 'button')
    img.setAttribute('aria-label', this.alt || '拡大表示')
    img.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      openImageOverlay(view, img, this.image.resolvedSrc, this.alt, this.sourceFrom)
    })
    img.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      event.stopPropagation()
      openImageOverlay(view, img, this.image.resolvedSrc, this.alt, this.sourceFrom)
    })
    return img
  }
}

export class ImageStatusWidget extends WidgetType {
  constructor(readonly source: string, readonly state: 'pending' | 'failed', readonly detail = '') { super() }

  eq(other: ImageStatusWidget): boolean {
    return this.source === other.source && this.state === other.state && this.detail === other.detail
  }

  ignoreEvent(): boolean { return false }

  toDOM(): HTMLElement {
    const element = document.createElement('span')
    element.className = 'cm-image-status'
    element.dataset.imageState = this.state
    const reason = document.createElement('span')
    reason.className = 'cm-image-status-reason'
    reason.textContent = this.state === 'pending' ? 'Loading image' : `Image unavailable: ${this.detail}`
    element.append(reason)
    const source = document.createElement('code')
    source.textContent = this.source
    element.append(source)
    return element
  }
}
