import { WidgetType } from '@codemirror/view'
import { KaTeXInlineWidget } from '../nodes/katex-node'
import { createImageDom, prepareImage } from './image-widget'

export class SourceTextWidget extends WidgetType {
  constructor(readonly source: string) { super() }
  eq(other: SourceTextWidget): boolean { return this.source === other.source }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.textContent = this.source
    return span
  }
}

export interface TableDomNode {
  readonly tag: string
  readonly text?: string
  readonly attributes?: Readonly<Record<string, string>>
  readonly mathSource?: string
  readonly children?: readonly TableDomNode[]
}

export interface TableDomAdapter {
  createTextNode(text: string): Node
  createElement(tag: string): HTMLElement
  createMathNode(source: string): Node
  createImageNode(source: string, alt: string, documentGeneration: number): Node
}

export const browserTableDomAdapter: TableDomAdapter = {
  createTextNode: text => document.createTextNode(text),
  createElement: tag => document.createElement(tag),
  createMathNode: source => new KaTeXInlineWidget(source).toDOM(),
  createImageNode: (source, alt, documentGeneration) => {
    return createImageDom(prepareImage(source, documentGeneration), source, alt)
  },
}

export function applyTableDomNode(
  node: TableDomNode,
  adapter: TableDomAdapter = browserTableDomAdapter,
  documentGeneration = 0,
): Node {
  if (node.tag === '#text') return adapter.createTextNode(node.text ?? '')
  if (node.tag === 'img') {
    const attributes = node.attributes ?? {}
    return adapter.createImageNode(attributes.src ?? '', attributes.alt ?? '', documentGeneration)
  }
  const element = adapter.createElement(node.tag)
  for (const [name, value] of Object.entries(node.attributes ?? {})) {
    element.setAttribute(name, value)
  }
  if (node.mathSource !== undefined) element.appendChild(adapter.createMathNode(node.mathSource))
  else if (node.text !== undefined) element.textContent = node.text
  for (const child of node.children ?? []) {
    element.appendChild(applyTableDomNode(child, adapter, documentGeneration))
  }
  return element
}
