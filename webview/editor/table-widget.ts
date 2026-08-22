import { type EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { getAppearanceMetrics, getAppearanceVersion } from '../appearance'
import { imageDocumentGeneration } from './image-widget'
import { linkDestination, linkLabel, wikilinkAlias, wikilinkTarget } from './markdown-node-values'
import { WidgetType } from '@codemirror/view'
import { applyTableDomNode, browserTableDomAdapter, type TableDomAdapter, type TableDomNode } from './widget-adapters'
import {
  attachMeasuredHeightObserver,
  buildWidgetStructure,
  evaluateEstimatedHeight,
  tableMeasuredHeightCacheKey,
  type AppearanceState,
  type CacheKey,
} from '../widget-height-cache'
import type { LinkActivation } from './link-activation'

const heightObservers = new WeakMap<HTMLElement, ResizeObserver>()

function appearanceState(): AppearanceState {
  const metrics = getAppearanceMetrics()
  return {
    appearanceVersion: getAppearanceVersion(),
    lineHeightPx: metrics.lineHeightPx,
    tableRowHeightPx: metrics.tableRowHeightPx,
    tableWidgetBlockPaddingPx: metrics.tableWidgetBlockPaddingPx,
  }
}

function tableCacheKey(tableData: TableData, availableWidthPx: number): CacheKey {
  return tableMeasuredHeightCacheKey(tableData, availableWidthPx)
}

type IterateEnter = NonNullable<Parameters<ReturnType<typeof syntaxTree>['iterate']>[0]['enter']>
type SyntaxNodeRef = Parameters<IterateEnter>[0]
type SyntaxNode = SyntaxNodeRef['node']

export type TableInline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'emphasis'; readonly children: readonly TableInline[] }
  | { readonly kind: 'strong'; readonly children: readonly TableInline[] }
  | { readonly kind: 'strike'; readonly children: readonly TableInline[] }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'link'; readonly children: readonly TableInline[]; readonly url: string }
  | { readonly kind: 'wikilink'; readonly label: string; readonly target: string }
  | { readonly kind: 'math'; readonly source: string }
  | { readonly kind: 'image'; readonly alt: string; readonly src: string }

export interface TableCellData {
  readonly from: number
  readonly to: number
  readonly source: string
  readonly inline: readonly TableInline[]
}

export interface TableRowData {
  readonly header: boolean
  readonly cells: readonly TableCellData[]
}

export interface TableData {
  readonly from: number
  readonly to: number
  readonly rows: readonly TableRowData[]
}

export function textPart(state: EditorState, from: number, to: number): TableInline[] {
  return from < to ? [{ kind: 'text', text: state.doc.sliceString(from, to) }] : []
}

export function contentBetweenMarks(
  state: EditorState,
  node: SyntaxNode,
  markName: string,
): TableInline[] {
  const marks = node.getChildren(markName)
  if (marks.length < 2) return textPart(state, node.from, node.to)
  return inlineFromRange(state, node, marks[0].to, marks[marks.length - 1].from)
}

export function inlineNode(state: EditorState, node: SyntaxNode): TableInline[] {
  if (node.name === 'Escape') {
    return textPart(state, Math.min(node.from + 1, node.to), node.to)
  }
  if (node.name === 'Emphasis') {
    return [{ kind: 'emphasis', children: contentBetweenMarks(state, node, 'EmphasisMark') }]
  }
  if (node.name === 'StrongEmphasis') {
    return [{ kind: 'strong', children: contentBetweenMarks(state, node, 'EmphasisMark') }]
  }
  if (node.name === 'Strikethrough') {
    return [{ kind: 'strike', children: contentBetweenMarks(state, node, 'StrikethroughMark') }]
  }
  if (node.name === 'InlineCode') {
    const marks = node.getChildren('CodeMark')
    const from = marks.length > 0 ? marks[0].to : node.from
    const to = marks.length > 1 ? marks[marks.length - 1].from : node.to
    return [{ kind: 'code', text: state.doc.sliceString(from, to) }]
  }
  if (node.name === 'InlineMath') {
    const marks = node.getChildren('InlineMathMark')
    const from = marks.length > 0 ? marks[0].to : node.from
    const to = marks.length > 1 ? marks[marks.length - 1].from : node.to
    return [{ kind: 'math', source: state.doc.sliceString(from, to) }]
  }
  if (node.name === 'Wikilink') {
    const target = wikilinkTarget(state, node) ?? ''
    const label = wikilinkAlias(state, node) ?? target
    return [{ kind: 'wikilink', label, target }]
  }
  if (node.name === 'Link' || node.name === 'Image') {
    const marks = node.getChildren('LinkMark')
    const labelFrom = marks.length > 0 ? marks[0].to : node.from
    const labelTo = marks.length > 1 ? marks[1].from : labelFrom
    const target = linkDestination(state, node) ?? ''
    if (node.name === 'Image') {
      return [{ kind: 'image', alt: linkLabel(state, node), src: target }]
    }
    return [{
      kind: 'link',
      children: inlineFromRange(state, node, labelFrom, labelTo),
      url: target,
    }]
  }
  return textPart(state, node.from, node.to)
}

export function inlineFromRange(
  state: EditorState,
  parent: SyntaxNode,
  from: number,
  to: number,
): TableInline[] {
  const result: TableInline[] = []
  let position = from
  let child = parent.firstChild
  while (child) {
    if (child.from >= from && child.to <= to) {
      result.push(...textPart(state, position, child.from))
      result.push(...inlineNode(state, child))
      position = child.to
    }
    child = child.nextSibling
  }
  result.push(...textPart(state, position, to))
  return result
}

/** GFM Table の構文木から、区切り行を除いた行・セル・セル内 inline 表示を導出する。 */
export function extractTableCells(state: EditorState, table: SyntaxNode): TableData {
  const rows: TableRowData[] = []
  let rowNode = table.firstChild
  while (rowNode) {
    if (rowNode.name === 'TableHeader' || rowNode.name === 'TableRow') {
      const cells: TableCellData[] = []
      let cellNode = rowNode.firstChild
      while (cellNode) {
        if (cellNode.name === 'TableCell') {
          cells.push({
            from: cellNode.from,
            to: cellNode.to,
            source: state.doc.sliceString(cellNode.from, cellNode.to),
            inline: inlineFromRange(state, cellNode, cellNode.from, cellNode.to),
          })
        }
        cellNode = cellNode.nextSibling
      }
      rows.push({ header: rowNode.name === 'TableHeader', cells })
    }
    rowNode = rowNode.nextSibling
  }
  return { from: table.from, to: table.to, rows }
}

export function serializeTableInline(inline: readonly TableInline[]): TableDomNode[] {
  return inline.map((part): TableDomNode => {
    if (part.kind === 'text') return { tag: '#text', text: part.text }
    if (part.kind === 'image') return { tag: 'img', attributes: { alt: part.alt, src: part.src } }
    if (part.kind === 'code') return { tag: 'code', text: part.text, attributes: { class: 'cm-inline-code' } }
    if (part.kind === 'math') return { tag: 'span', mathSource: part.source }
    if (part.kind === 'wikilink') {
      return { tag: 'a', text: part.label, attributes: { class: 'cm-wikilink', title: part.target, 'data-link-destination': part.target.endsWith('.md') ? part.target : `${part.target}.md` } }
    }
    const tag = part.kind === 'emphasis' ? 'em'
      : part.kind === 'strong' ? 'strong'
        : part.kind === 'strike' ? 'del'
          : 'a'
    const attributes = part.kind === 'link'
      ? { class: 'cm-link', href: part.url, title: part.url, 'data-link-destination': part.url }
      : undefined
    return { tag, attributes, children: serializeTableInline(part.children) }
  })
}

export function serializeTableData(tableData: TableData): TableDomNode {
  return {
    tag: 'table',
    children: tableData.rows.map(row => ({
      tag: 'tr',
      children: row.cells.map(cell => ({
        tag: row.header ? 'th' : 'td',
        children: serializeTableInline(cell.inline),
      })),
    })),
  }
}

export class TableWidget extends WidgetType {
  private readonly appearanceVersion = getAppearanceVersion()
  private availableWidthPx = 0
  constructor(
    readonly tableData: TableData,
    readonly documentGeneration = 0,
    private readonly domAdapter: TableDomAdapter = browserTableDomAdapter,
    private readonly onLinkActivate: LinkActivation | null = null,
  ) { super() }

  eq(other: TableWidget): boolean {
    return JSON.stringify(this.tableData) === JSON.stringify(other.tableData)
      && this.appearanceVersion === other.appearanceVersion
      && this.documentGeneration === other.documentGeneration
      && this.onLinkActivate === other.onLinkActivate
  }

  ignoreEvent(): boolean { return false }

  toDOM(): HTMLElement {
    const wrapper = this.domAdapter.createElement('div')
    wrapper.className = 'cm-table-widget'
    wrapper.appendChild(applyTableDomNode(serializeTableData(this.tableData), this.domAdapter, this.documentGeneration))
    wrapper.addEventListener?.('click', event => {
      if (!event.ctrlKey && !event.metaKey) return
      const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[data-link-destination]')
      const destination = anchor?.dataset.linkDestination
      if (!destination || !this.onLinkActivate) return
      event.preventDefault()
      event.stopPropagation()
      this.onLinkActivate(destination)
    })
    heightObservers.set(wrapper, attachMeasuredHeightObserver(wrapper, () => {
      this.availableWidthPx = wrapper.clientWidth || wrapper.parentElement?.clientWidth || 0
      return tableCacheKey(this.tableData, this.availableWidthPx)
    }))
    return wrapper
  }

  destroy(dom: HTMLElement): void {
    heightObservers.get(dom)?.disconnect()
    heightObservers.delete(dom)
  }

  get estimatedHeight(): number {
    const appearance = appearanceState()
    return evaluateEstimatedHeight({
      cacheKey: tableCacheKey(this.tableData, this.availableWidthPx),
      staticInput: {
        structure: buildWidgetStructure({ kind: 'Table', rowCount: this.tableData.rows.length }),
        appearance,
      },
    })
  }
}
