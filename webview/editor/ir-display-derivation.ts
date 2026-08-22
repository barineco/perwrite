import { type EditorState, type Range } from '@codemirror/state'
import { Decoration } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import {
  createKaTeXBlockWidget,
  createKaTeXInlineWidget,
} from '../nodes/katex-node'
import { checkboxMarkerNode, type RenderRule } from './render-rules'
import { linkDestination, linkLabel, linkLabelRange, wikilinkDisplayRange } from './markdown-node-values'
import { revealRangeFacet } from './search-reveal'
import { ImageStatusWidget, ImageWidget, imageDocumentGeneration, prepareImage } from './image-widget'
import { CheckboxWidget, ListBulletWidget, ListNumberWidget } from './list-widget'
import { SourceTextWidget } from './widget-adapters'
import { linkActivation } from './link-activation'
import { extractTableCells, TableWidget } from './table-widget'
import { renderingProfileField } from './rendering-profile'
import { resolveFencedCodeWidget } from './ir-fenced-code-registry'
import type { NodeRenderData } from './ir-node-render-registry'

function hideDecoration() {
  return Decoration.replace({})
}

type IterateEnter = NonNullable<Parameters<ReturnType<typeof syntaxTree>['iterate']>[0]['enter']>
type SyntaxNodeRef = Parameters<IterateEnter>[0]
type SyntaxNode = SyntaxNodeRef['node']

function markDecoration(cls: string) {
  return Decoration.mark({ class: cls })
}


/** 表示規則の解釈に必要な状態と補助を導出器へ渡す。 */
export interface DeriveContext {
  readonly state: EditorState
  readonly decorations: Range<Decoration>[]
  readonly atomicRanges: Range<Decoration>[]
  readonly focused: boolean
  readonly activeReveal: boolean
}

function commitRange(ctx: DeriveContext, range: Range<Decoration>, cursorPassThrough: boolean): void {
  ctx.decorations.push(range)
  if (!cursorPassThrough) ctx.atomicRanges.push(range)
}

/** 対象ノードの参照。Lezer の SyntaxNodeRef から必要な情報を受け取る。 */
export interface NodeInfo {
  readonly name: string
  readonly from: number
  readonly to: number
  readonly node: SyntaxNode
}

// ノード種別ごとの装飾導出器。表示規則を受け取り装飾を積む。
// widget 構築や隠す区間の算出はこの側に属する。
export type NodeDeriver = (ctx: DeriveContext, node: NodeInfo, rule: RenderRule) => void

/** 非アクティブ時に、指定名の子マークを隠す。 */
function hideChildMarks(node: SyntaxNode, markName: string, ctx: DeriveContext, cursorPassThrough: boolean): void {
  let child = node.firstChild
  while (child) {
    if (child.name === markName) {
      commitRange(ctx, hideDecoration().range(child.from, child.to), cursorPassThrough)
    }
    child = child.nextSibling
  }
}

/** アクティブ判定の単位を表示規則から選び、アクティブか否かを返す。 */
export function isActiveForRule(
  state: EditorState,
  focused: boolean,
  from: number,
  to: number,
  rule: RenderRule,
): boolean {
  if (!focused) return false
  if (rule.activeUnit === 'line') {
    const line = state.doc.lineAt(from)
    return state.selection.ranges.some(range => range.from <= line.to && range.to >= line.from)
  }
  return state.selection.ranges.some(range => range.from <= to && range.to >= from)
}

export function isRuleActive(ctx: DeriveContext, node: NodeInfo, rule: RenderRule): boolean {
  if (!ctx.activeReveal) return false
  const target = ctx.state.facet(revealRangeFacet)
  // A non-empty target intersects source nodes as half-open ranges.  A caret
  // target opens the node containing that caret without leaking to neighbours.
  if (target && (target.from === target.to
    ? target.from >= node.from && target.from <= node.to
    : target.from < node.to && node.from < target.to)) return true
  return isActiveForRule(ctx.state, ctx.focused, node.from, node.to, rule)
}

/** 装飾クラスのみを付すインライン mark ( 非アクティブ時は子マークを隠す ) の導出器を作る。 */
export function inlineMarkDeriver(cls: string, childMarkName: string): NodeDeriver {
  return (ctx, node, rule) => {
    if (!isRuleActive(ctx, node, rule)) {
      hideChildMarks(node.node, childMarkName, ctx, rule.cursorPassThrough)
    }
    commitRange(ctx, markDecoration(cls).range(node.from, node.to), rule.cursorPassThrough)
  }
}

export const deriveLink: NodeDeriver = (ctx, node, rule) => {
  if (isRuleActive(ctx, node, rule)) return
  const visible = linkLabelRange(node.node)
  if (visible) {
    commitRange(ctx, hideDecoration().range(node.from, node.from + 1), rule.cursorPassThrough)
    commitRange(ctx, Decoration.mark({
      class: 'cm-link',
      tagName: 'a',
      attributes: { href: linkDestination(ctx.state, node.node) ?? '' },
    }).range(
      visible.from,
      visible.to,
    ), rule.cursorPassThrough)
    commitRange(ctx, hideDecoration().range(visible.to, node.to), rule.cursorPassThrough)
  }
}

export const deriveWikilink: NodeDeriver = (ctx, node, rule) => {
  if (isRuleActive(ctx, node, rule)) return
  const visible = wikilinkDisplayRange(node.node)
  if (!visible) return
  commitRange(ctx, hideDecoration().range(node.from, visible.from), rule.cursorPassThrough)
  commitRange(ctx, markDecoration('cm-wikilink').range(visible.from, visible.to), rule.cursorPassThrough)
  commitRange(ctx, hideDecoration().range(visible.to, node.to), rule.cursorPassThrough)
}

export const deriveHeading: NodeDeriver = (ctx, node, rule) => {
  const level = parseInt(node.name.slice(-1))
  ctx.decorations.push(
    Decoration.line({ class: `cm-heading cm-heading-${level}` }).range(
      ctx.state.doc.lineAt(node.from).from,
    ),
  )
  if (isRuleActive(ctx, node, rule)) return
  const headerMark = node.node.getChild('HeaderMark')
  if (headerMark) {
    const afterMark = ctx.state.doc.sliceString(headerMark.to, headerMark.to + 1)
    const hideEnd = afterMark === ' ' ? headerMark.to + 1 : headerMark.to
    commitRange(ctx, hideDecoration().range(headerMark.from, hideEnd), rule.cursorPassThrough)
  }
}

export const deriveHorizontalRule: NodeDeriver = (ctx, node, rule) => {
  if (isRuleActive(ctx, node, rule)) return
  ctx.decorations.push(
    Decoration.line({ class: 'cm-hr-rendered' }).range(
      ctx.state.doc.lineAt(node.from).from,
    ),
  )
  commitRange(ctx, hideDecoration().range(node.from, node.to), rule.cursorPassThrough)
}

export const deriveQuoteMark: NodeDeriver = (ctx, node, rule) => {
  const line = ctx.state.doc.lineAt(node.from)
  ctx.decorations.push(
    Decoration.line({ class: 'cm-blockquote' }).range(line.from),
  )
  if (isRuleActive(ctx, node, rule)) return
  const afterQuote = ctx.state.doc.sliceString(node.to, node.to + 1)
  const qHideEnd = afterQuote === ' ' ? node.to + 1 : node.to
  commitRange(ctx, hideDecoration().range(node.from, qHideEnd), rule.cursorPassThrough)
}

/** アクティブ時に block 全体へ行装飾を付す ( 編集用の枠表示 ) 。 */
export function pushBlockLines(ctx: DeriveContext, from: number, to: number, base: string): void {
  const firstLine = ctx.state.doc.lineAt(from)
  const lastLine = ctx.state.doc.lineAt(to)
  for (let i = firstLine.number; i <= lastLine.number; i++) {
    const line = ctx.state.doc.line(i)
    let cls = base + '-line'
    if (i === firstLine.number) cls += ` ${base}-first`
    if (i === lastLine.number) cls += ` ${base}-last`
    ctx.decorations.push(Decoration.line({ class: cls }).range(line.from))
  }
}

export function deriveRichNode(ctx: DeriveContext, node: NodeInfo): void {
  const inlineClass: Readonly<Record<string, string>> = {
    Emphasis: 'cm-em',
    StrongEmphasis: 'cm-strong',
    Strikethrough: 'cm-strikethrough',
    InlineCode: 'cm-inline-code',
    Link: 'cm-link',
    Wikilink: 'cm-wikilink',
    InlineMath: 'cm-math-source',
    Image: 'cm-image-source',
    [checkboxMarkerNode]: 'cm-task-source',
    ListMark: 'cm-list-source',
  }
  const cls = inlineClass[node.name]
  if (cls) {
    ctx.decorations.push(markDecoration(cls).range(node.from, node.to))
    return
  }
  if (node.name.startsWith('ATXHeading')) {
    const level = parseInt(node.name.slice(-1))
    ctx.decorations.push(Decoration.line({ class: `cm-heading cm-heading-${level}` }).range(ctx.state.doc.lineAt(node.from).from))
    return
  }
  if (node.name === 'HorizontalRule') {
    ctx.decorations.push(Decoration.line({ class: 'cm-hr-source' }).range(ctx.state.doc.lineAt(node.from).from))
    return
  }
  if (node.name === 'QuoteMark') {
    ctx.decorations.push(Decoration.line({ class: 'cm-blockquote' }).range(ctx.state.doc.lineAt(node.from).from))
    return
  }
  if (node.name === 'FencedCode') {
    pushBlockLines(ctx, node.from, node.to, 'cm-codeblock')
    return
  }
  if (node.name === 'BlockMath') {
    pushBlockLines(ctx, node.from, node.to, 'cm-mathblock')
  }
}

export const deriveFencedCode: NodeDeriver = (ctx, node, rule) => {
  const codeMarks = node.node.getChildren('CodeMark')
  if (codeMarks.length < 2) return
  if (isRuleActive(ctx, node, rule)) {
    pushBlockLines(ctx, node.from, node.to, 'cm-codeblock')
    return
  }
  const codeInfo = node.node.getChild('CodeInfo')
  const lang = codeInfo ? ctx.state.doc.sliceString(codeInfo.from, codeInfo.to) : ''
  const codeText = node.node.getChild('CodeText')
  const code = codeText ? ctx.state.doc.sliceString(codeText.from, codeText.to) : ''
  const widget = resolveFencedCodeWidget({
    lang, code,
    codeFrom: codeText?.from ?? node.from,
    sourceFrom: node.from, sourceTo: node.to,
    getProfile: () => ctx.state.field(renderingProfileField),
  })
  commitRange(ctx, Decoration.replace({ widget, block: true }).range(node.from, node.to), rule.cursorPassThrough)
}

export const deriveBlockMath: NodeDeriver = (ctx, node, rule) => {
  const marks = node.node.getChildren('BlockMathMark')
  if (marks.length < 2) return
  if (isRuleActive(ctx, node, rule)) {
    pushBlockLines(ctx, node.from, node.to, 'cm-mathblock')
    return
  }
  let mathContent = ''
  if (marks.length >= 2) {
    mathContent = ctx.state.doc.sliceString(marks[0].to, marks[1].from).trim()
  } else if (marks.length === 1) {
    mathContent = ctx.state.doc.sliceString(marks[0].to, node.to).trim()
  }
  const widget = createKaTeXBlockWidget(mathContent)
  if (widget === null) return
  commitRange(ctx, Decoration.replace({ widget, block: true }).range(node.from, node.to), rule.cursorPassThrough)
}

export const deriveInlineMath: NodeDeriver = (ctx, node, rule) => {
  if (isRuleActive(ctx, node, rule)) return
  const imMarks = node.node.getChildren('InlineMathMark')
  let inlineMathContent = ''
  if (imMarks.length >= 2) {
    inlineMathContent = ctx.state.doc.sliceString(imMarks[0].to, imMarks[1].from)
  }
  const widget = createKaTeXInlineWidget(inlineMathContent)
  if (widget === null) return
  commitRange(ctx, Decoration.replace({ widget }).range(node.from, node.to), rule.cursorPassThrough)
}

export const deriveImage: NodeDeriver = (ctx, node, rule) => {
  if (isRuleActive(ctx, node, rule)) return
  const src = linkDestination(ctx.state, node.node)
  if (src === null) return
  const documentGeneration = ctx.state.field(imageDocumentGeneration, false) ?? 0
  const preparation = prepareImage(src, documentGeneration)
  const widget = preparation.kind === 'ready'
    ? new ImageWidget(preparation.value, linkLabel(ctx.state, node.node), node.from, node.to)
    : new ImageStatusWidget(
      src,
      preparation.kind === 'pending' ? 'pending' : 'failed',
      preparation.kind === 'failed' ? preparation.failure : '',
    )
  commitRange(ctx, Decoration.replace({ widget }).range(node.from, node.to), rule.cursorPassThrough)
}

export const deriveCheckboxMarker: NodeDeriver = (ctx, node, rule) => {
  if (isRuleActive(ctx, node, rule)) return
  const markerText = ctx.state.doc.sliceString(node.from, node.to)
  const isChecked = markerText === '[x]' || markerText === '[X]'
  const afterMarker = ctx.state.doc.sliceString(node.to, node.to + 1)
  const hideEnd = afterMarker === ' ' ? node.to + 1 : node.to
  commitRange(ctx, Decoration.replace({
    widget: new CheckboxWidget(isChecked),
  }).range(node.from, hideEnd), rule.cursorPassThrough)
}

export const deriveListMark: NodeDeriver = (ctx, node, rule) => {
  if (isRuleActive(ctx, node, rule)) return
  const listItem = node.node.parent
  if (listItem?.getChild(checkboxMarkerNode)) return

  const listParent = listItem?.parent
  const lmAfter = ctx.state.doc.sliceString(node.to, node.to + 1)
  const lmHideEnd = lmAfter === ' ' ? node.to + 1 : node.to

  if (listParent?.name === 'BulletList') {
    let depth = 0
    let ancestor = listParent.parent
    while (ancestor) {
      if (ancestor.name === 'BulletList' || ancestor.name === 'OrderedList') depth++
      ancestor = ancestor.parent
    }
    commitRange(ctx, Decoration.replace({
      widget: new ListBulletWidget(depth),
    }).range(node.from, lmHideEnd), rule.cursorPassThrough)
  } else if (listParent?.name === 'OrderedList') {
    const numText = ctx.state.doc.sliceString(node.from, node.to)
    commitRange(ctx, Decoration.replace({
      widget: new ListNumberWidget(numText),
    }).range(node.from, lmHideEnd), rule.cursorPassThrough)
  }
}

export const deriveTable: NodeDeriver = (ctx, node, rule) => {
  if (isRuleActive(ctx, node, rule)) return
  commitRange(ctx, Decoration.replace({
    widget: new TableWidget(
      extractTableCells(ctx.state, node.node),
      ctx.state.field(imageDocumentGeneration, false) ?? 0,
      undefined,
      ctx.state.facet(linkActivation),
    ),
    block: true,
  }).range(node.from, node.to), rule.cursorPassThrough)
}

export function interpretDisplay(ctx: DeriveContext, node: NodeInfo, rule: RenderRule, data: NodeRenderData): void {
  const materials = data.deriveMaterials(ctx, node, rule)
  const selected = materials[rule.display]
  if (selected !== undefined) {
    ctx.decorations.push(...selected)
    return
  }
  if (isRuleActive(ctx, node, rule)) return
  if (rule.display === 'widget') {
    commitRange(ctx, Decoration.replace({
      widget: new SourceTextWidget(ctx.state.doc.sliceString(node.from, node.to)),
    }).range(node.from, node.to), rule.cursorPassThrough)
  } else if (rule.display === 'mark') {
    commitRange(ctx, markDecoration(`cm-${node.name.toLowerCase()}`).range(node.from, node.to), rule.cursorPassThrough)
  } else {
    commitRange(ctx, hideDecoration().range(node.from, node.to), rule.cursorPassThrough)
  }
}
