export function iconButton(label: string, svgMarkup: string, className = ''): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.setAttribute('aria-label', label)
  button.title = label
  const template = document.createElement('template')
  template.innerHTML = svgMarkup
  const svg = template.content.firstElementChild
  if (!(svg instanceof SVGSVGElement)) throw new Error(`Icon markup is unavailable: ${label}`)
  const text = document.createElement('span')
  text.className = 'cm-mermaid-button-label'
  text.textContent = label
  button.append(svg, text)
  return button
}

export interface ModalOptions {
  readonly label: string
  readonly returnTarget: HTMLElement
  readonly onRequestClose: () => void
  readonly className?: string
  readonly surfaceClassName?: string
  readonly actionsClassName?: string
  readonly contentClassName?: string
}

export type ModalPhase = 'detached' | 'preparing' | 'presented' | 'disposed'

const focusableSelector = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function classes(base: string, extra?: string): string {
  return extra ? `${base} ${extra}` : base
}

export class Modal {
  readonly root: HTMLDivElement
  readonly surface: HTMLDivElement
  readonly actions: HTMLDivElement
  readonly content: HTMLDivElement
  private currentPhase: ModalPhase = 'detached'

  constructor(private readonly options: ModalOptions) {
    this.root = document.createElement('div')
    this.root.className = classes('perwrite-modal', options.className)
    this.root.dataset.phase = this.currentPhase
    this.root.setAttribute('role', 'dialog')
    this.root.setAttribute('aria-modal', 'true')
    this.root.setAttribute('aria-label', options.label)
    this.surface = document.createElement('div')
    this.surface.className = classes('perwrite-modal-surface', options.surfaceClassName)
    this.actions = document.createElement('div')
    this.actions.className = classes('perwrite-modal-actions', options.actionsClassName)
    this.content = document.createElement('div')
    this.content.className = classes('perwrite-modal-content', options.contentClassName)
    this.surface.append(this.actions, this.content)
    this.root.append(this.surface)
    this.root.addEventListener('mousedown', event => {
      if (event.target === this.root) options.onRequestClose()
    })
    this.root.addEventListener('keydown', event => this.handleKeydown(event))
  }

  get phase(): ModalPhase {
    return this.currentPhase
  }

  mount(): void {
    if (this.currentPhase !== 'detached') throw new Error(`Modal cannot mount from ${this.currentPhase}`)
    this.setPhase('preparing')
    document.body.append(this.root)
  }

  present(initialFocus: HTMLElement): void {
    if (this.currentPhase !== 'preparing') throw new Error(`Modal cannot present from ${this.currentPhase}`)
    if (!this.surface.contains(initialFocus)) throw new Error('Modal initial focus must be inside its surface')
    this.setPhase('presented')
    initialFocus.focus()
  }

  dispose(restoreFocus: boolean): void {
    if (this.currentPhase === 'disposed') return
    this.root.remove()
    this.setPhase('disposed')
    if (restoreFocus && this.options.returnTarget.isConnected) {
      this.options.returnTarget.focus({ preventScroll: true })
    }
  }

  private setPhase(phase: ModalPhase): void {
    this.currentPhase = phase
    this.root.dataset.phase = phase
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.options.onRequestClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...this.surface.querySelectorAll<HTMLElement>(focusableSelector)]
      .filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true')
    if (!focusable.length) {
      event.preventDefault()
      return
    }
    const current = focusable.indexOf(document.activeElement as HTMLElement)
    const next = current < 0
      ? (event.shiftKey ? focusable.length - 1 : 0)
      : (current + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length
    event.preventDefault()
    focusable[next].focus()
  }
}
