export interface FailureElement {
  textContent: string | null
  setAttribute(name: string, value: string): void
  insertAdjacentElement(position: 'afterend', element: any): unknown
  remove(): void
  appendChild?(element: any): unknown
  addEventListener?(type: string, callback: () => void): void
  focus?(): void
}

export interface FailureDocument {
  getElementById(id: string): FailureElement | null
  createElement(tag: string): FailureElement
}

export interface FailureDisplay {
  readonly title: string
  readonly detail: string
  readonly actions?: readonly { readonly label: string; readonly run: () => void }[]
}

export function applyFailureDisplay(
  documentAdapter: FailureDocument,
  elementId: string,
  role: string,
  display: FailureDisplay | null,
): void {
  const toolbar = documentAdapter.getElementById('toolbar')
  if (!toolbar) return
  let element = documentAdapter.getElementById(elementId)
  if (!display) {
    element?.remove()
    return
  }
  if (!element) {
    element = documentAdapter.createElement('div')
    element.setAttribute('id', elementId)
    element.setAttribute('role', role)
    toolbar.insertAdjacentElement('afterend', element)
  }
  element.textContent = `${display.title}: ${display.detail}`
  for (const action of display.actions ?? []) {
    const button = documentAdapter.createElement('button')
    button.textContent = action.label
    button.setAttribute('type', 'button')
    button.addEventListener?.('click', action.run)
    element.appendChild?.(button)
  }
  if (display.actions?.length) element.focus?.()
}
