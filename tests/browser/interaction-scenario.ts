import '../../webview/theme/styles.css'
import { Transaction } from '@codemirror/state'
import { undoDepth } from '@codemirror/commands'
import { createEditor, type EditorCallbacks } from '../../webview/editor/setup'
import { setViewModeEffect, viewModeField, type ViewMode } from '../../webview/editor/view-mode'
import { compositionActiveField } from '../../webview/editor/composition-state'
import { irDecorationField } from '../../webview/editor/ir-state-field'
import { revealTarget, revealTargetField } from '../../webview/editor/search-reveal'
import { reconfigureRendering } from '../../webview/editor/rendering-profile'
import { codeBlockWrapState } from '../../webview/editor/code-block-wrapping'
import { syntaxTree } from '@codemirror/language'
import {
  initShikiHighlighter, ShikiCodeBlockWidget, textOffsetAtPoint,
} from '../../webview/nodes/code-block-node'
import { applyCssVariables, invalidateEditorAppearance } from '../../webview/appearance'
import type { PerwriteCssVariables } from '../../src/appearance-profile'

const root = document.getElementById('editor')!
let rendering = {
  generation: 0, codeBlockWrap: true, mermaidLayout: 'elk' as const, mermaidMaxEdges: 1024,
  mermaidPanStep: 80, mermaidZoomStep: 1.5, texRendering: true,
}
const shikiReady = initShikiHighlighter({
  name: 'perwrite-browser-test',
  type: 'light',
  colors: {
    'editor.foreground': '#202020',
    'editor.background': '#ffffff',
  },
  tokenColors: [],
})
const updates: string[] = []
const changes: Array<{ readonly before: string; readonly after: string; readonly selection: number }> = []
const activations: Array<{ readonly documentId: string; readonly destination: string }> = []
const callbacks: EditorCallbacks = {
  onDocUpdate(content) {
    updates.push(content)
  },
  onChanges(_changes, view, before, after) {
    changes.push({ before, after, selection: view.state.selection.main.head })
  },
  onLinkActivate(destination) {
    activations.push({ documentId: 'standard-document', destination })
  },
}

let view = createEditor(root, '', callbacks, 'render', rendering)

function reset(doc: string, anchor: number): void {
  view.destroy()
  root.replaceChildren()
  updates.length = 0
  changes.length = 0
  activations.length = 0
  view = createEditor(root, doc, callbacks, 'render', rendering)
  view.dispatch({
    selection: { anchor },
    annotations: Transaction.addToHistory.of(false),
  })
  view.focus()
}

function reconfigureCodeBlockWrap(enabled: boolean): number {
  rendering = { ...rendering, generation: rendering.generation + 1, codeBlockWrap: enabled }
  view.dispatch({ effects: reconfigureRendering(rendering) })
  return rendering.generation
}

function codeBlockWrapWitness() {
  const widget = document.querySelector<HTMLElement>('.cm-shiki-codeblock')
  const sourceLine = [...document.querySelectorAll<HTMLElement>('.cm-codeblock-line')]
    .find(element => (element.textContent?.length ?? 0) > 60) ?? null
  const code = widget?.querySelector<HTMLElement>('code, .cm-render-error-source') ?? null
  const target = code
    ? [...code.querySelectorAll<HTMLElement>('.line')].find(element => (element.textContent?.length ?? 0) > 60) ?? code
    : sourceLine
  const range = target ? document.createRange() : null
  if (target && range) range.selectNodeContents(target)
  const rects = range ? [...range.getClientRects()] : []
  const container = widget?.querySelector<HTMLElement>('pre') ?? sourceLine
  const style = code ? getComputedStyle(code) : target ? getComputedStyle(target) : null
  const state = view.state.field(codeBlockWrapState)
  return {
    state,
    mode: view.state.field(viewModeField),
    doc: view.state.doc.toString(),
    selection: view.state.selection.main.head,
    editorClass: view.dom.className,
    whiteSpace: style?.whiteSpace ?? null,
    overflowWrap: style?.overflowWrap ?? null,
    clientWidth: container?.clientWidth ?? null,
    scrollWidth: container?.scrollWidth ?? null,
    editorClientWidth: view.scrollDOM.clientWidth,
    editorScrollWidth: view.scrollDOM.scrollWidth,
    rectTops: [...new Set(rects.map(rect => Math.round(rect.top * 100) / 100))],
    sourceLineCount: document.querySelectorAll('.cm-codeblock-line').length,
    widgetCount: document.querySelectorAll('.cm-shiki-codeblock').length,
  }
}

function shikiWitness() {
  const wrappers = [...document.querySelectorAll<HTMLElement>('.cm-shiki-codeblock')]
  return wrappers.map(wrapper => ({
    state: wrapper.dataset.shikiState ?? null,
    snapshotId: wrapper.dataset.shikiSnapshotId ?? null,
    appearanceVersion: wrapper.dataset.shikiAppearanceVersion ?? null,
    text: wrapper.textContent ?? '',
    html: wrapper.innerHTML,
    tokenCount: wrapper.querySelectorAll('.shiki .line').length,
    connected: wrapper.isConnected,
  }))
}

function snapshot() {
  return {
    doc: view.state.doc.toString(),
    ranges: view.state.selection.ranges.map(range => ({
      anchor: range.anchor,
      head: range.head,
      from: range.from,
      to: range.to,
    })),
    mainIndex: view.state.selection.mainIndex,
    compositionActive: view.state.field(compositionActiveField),
    undoDepth: undoDepth(view.state),
    updates: [...updates],
    changes: [...changes],
  }
}

/** Concrete JSON witness for each real CodeMirror search-panel operation. */
function repeatRevealOnly(): void {
  const target = view.state.field(revealTargetField)
  if (target) revealTarget(view, target.from, target.to, target.source)
}

function searchRevealWitness() {
  const offset = (element: Element, at: number): number | null => {
    try { return view.posAtDOM(element, at) } catch { return null }
  }
  const exact = [...document.querySelectorAll<HTMLElement>('.cm-reveal-target-exact')]
  return {
    query: document.querySelector<HTMLInputElement>('.cm-search input[name="search"]')?.value ?? null,
    replacement: document.querySelector<HTMLInputElement>('.cm-search input[name="replace"]')?.value ?? null,
    document: view.state.doc.toString(),
    selection: view.state.selection.ranges.map(range => ({
      anchor: range.anchor, head: range.head, from: range.from, to: range.to,
    })),
    target: view.state.field(revealTargetField),
    lineOffsets: [...document.querySelectorAll<HTMLElement>('.cm-reveal-target-line')]
      .map(element => offset(element, 0)),
    exactOffsets: exact.map(element => ({
      from: offset(element, 0),
      to: offset(element, element.childNodes.length),
    })),
    undoDepth: undoDepth(view.state),
    scrollTop: view.scrollDOM.scrollTop,
    panel: (() => {
      const panel = view.dom.querySelector<HTMLElement>('.cm-panel.cm-search')
      const scroller = view.scrollDOM.getBoundingClientRect()
      const rect = panel?.getBoundingClientRect()
      return rect ? { top: rect.top, bottom: rect.bottom, scrollerTop: scroller.top, scrollerBottom: scroller.bottom } : null
    })(),
  }
}

function atomicRangeCount(): number {
  let count = 0
  const atomic = view.state.field(irDecorationField).atomicRanges.iter()
  while (atomic.value) {
    count++
    atomic.next()
  }
  return count
}

function setMode(mode: ViewMode): void {
  view.dispatch({ effects: setViewModeEffect.of(mode) })
}

function setSelection(anchor: number): void {
  view.dispatch({ selection: { anchor } })
  view.focus()
}

function reveal(from: number, to: number): { target: unknown; lines: number; exact: number; selection: number } {
  revealTarget(view, from, to, 'external')
  return {
    target: view.state.field(revealTargetField),
    lines: document.querySelectorAll('.cm-reveal-target-line').length,
    exact: document.querySelectorAll('.cm-reveal-target-exact').length,
    selection: view.state.selection.main.head,
  }
}

function syntaxRange(nodeName: string): { from: number; to: number } | null {
  let result: { from: number; to: number } | null = null
  syntaxTree(view.state).iterate({
    enter(node) {
      if (!result && node.name === nodeName) {
        result = { from: node.from, to: node.to }
      }
    },
  })
  return result
}

function linkActivationWitness() {
  return [...activations]
}

function tableLinkActivationWitness(modifier: 'ctrl' | 'meta' | null): { readonly activations: readonly { readonly documentId: string; readonly destination: string }[]; readonly sourceVisible: boolean } {
  const source = '| A | B |\n|---|---|\n| [open](child.md) | value |\n\nafter'
  reset(source, source.length)
  setMode('render')
  const anchor = document.querySelector<HTMLAnchorElement>('.cm-table-widget a[data-link-destination]')
  if (!anchor) return { activations: [], sourceVisible: false }
  anchor.addEventListener('click', event => event.preventDefault(), { once: true })
  anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: modifier === 'ctrl', metaKey: modifier === 'meta' }))
  return { activations: [...activations], sourceVisible: document.querySelector('.cm-table-widget') !== null }
}

function tableWitness() {
  const wrapper = document.querySelector<HTMLElement>('.cm-table-widget')
  const table = wrapper?.querySelector<HTMLElement>('table') ?? null
  const header = table?.querySelector<HTMLElement>('th') ?? null
  const body = table?.querySelector<HTMLElement>('td') ?? null
  const sourceLine = [...document.querySelectorAll<HTMLElement>('.cm-line')]
    .find(element => element.textContent?.includes('| A | B |')) ?? null
  const styleOf = (element: HTMLElement | null) => {
    const style = element ? getComputedStyle(element) : null
    return style ? {
      paddingTop: style.paddingTop, paddingRight: style.paddingRight,
      paddingBottom: style.paddingBottom, paddingLeft: style.paddingLeft,
      marginTop: style.marginTop, marginRight: style.marginRight,
      marginBottom: style.marginBottom, marginLeft: style.marginLeft,
      backgroundColor: style.backgroundColor, borderTopLeftRadius: style.borderTopLeftRadius,
    } : null
  }
  return {
    snapshot: snapshot(),
    widgetCount: document.querySelectorAll('.cm-table-widget').length,
    tableClassCount: document.querySelectorAll('[class*="cm-table-"]').length,
    wrapper: styleOf(wrapper), table: styleOf(table), header: styleOf(header), body: styleOf(body),
    sourceLine: styleOf(sourceLine),
  }
}

function setTableAppearance(blockPadding: number, inlinePadding: number, widgetPadding: number): void {
  applyCssVariables(document.documentElement, {
    '--perwrite-table-cell-block-padding': `${blockPadding}px`,
    '--perwrite-table-cell-inline-padding': `${inlinePadding}px`,
    '--perwrite-table-widget-block-padding': `${widgetPadding}px`,
  } as PerwriteCssVariables)
  invalidateEditorAppearance(view)
}

function clickCodeWidgetSource(
  code: string,
  codeFrom: number,
  offset: number,
  form: 'plain' | 'error',
): ReturnType<typeof snapshot> {
  const wrapper = new ShikiCodeBlockWidget(code, 'text', codeFrom).toDOM(view)
  if (form === 'error') {
    const source = document.createElement('pre')
    source.className = 'cm-render-error-source'
    source.textContent = code
    wrapper.replaceChildren(source)
  }
  document.body.appendChild(wrapper)
  const source = wrapper.querySelector<HTMLElement>('code, .cm-render-error-source')!
  const text = source.firstChild!
  const range = document.createRange()
  range.setStart(text, offset)
  range.setEnd(text, Math.min(offset + 1, code.length))
  const rect = range.getBoundingClientRect()
  source.dispatchEvent(new MouseEvent('mousedown', {
    bubbles: true,
    button: 0,
    clientX: rect.left + 0.1,
    clientY: (rect.top + rect.bottom) / 2,
  }))
  wrapper.remove()
  return snapshot()
}

function clickActualPlainCode(
  doc: string,
  anchor: number,
  offset: number,
): {
  snapshot: ReturnType<typeof snapshot>
  widgetCount: number
  sourceLineCount: number
} {
  reset(doc, anchor)
  const wrapper = document.querySelector<HTMLElement>('.cm-shiki-codeblock')!
  const source = wrapper.querySelector<HTMLElement>('.cm-shiki-pre code')!
  const text = source.firstChild!
  const range = document.createRange()
  range.setStart(text, offset)
  range.setEnd(text, Math.min(offset + 1, text.textContent?.length ?? offset))
  const rect = range.getBoundingClientRect()
  source.dispatchEvent(new MouseEvent('mousedown', {
    bubbles: true,
    button: 0,
    clientX: rect.left + 0.1,
    clientY: (rect.top + rect.bottom) / 2,
  }))
  view.dispatch({ effects: [] })
  return {
    snapshot: snapshot(),
    widgetCount: document.querySelectorAll('.cm-shiki-codeblock').length,
    sourceLineCount: document.querySelectorAll('.cm-codeblock-line').length,
  }
}

function unresolvedCodeOffsets(code: string) {
  const element = document.createElement('code')
  element.textContent = code
  document.body.appendChild(element)
  const rect = element.getBoundingClientRect()
  const locate = () => null
  const before = textOffsetAtPoint(element, rect.left, rect.top - 10, code.length, locate)
  const after = textOffsetAtPoint(element, rect.right, rect.bottom + 10, code.length, locate)
  element.remove()
  return { before, after }
}

function clampedCodeOffset(code: string): {
  offset: ReturnType<typeof textOffsetAtPoint>
  calls: readonly { x: number; y: number }[]
  rect: { left: number; right: number; top: number; bottom: number }
} {
  const element = document.createElement('code')
  element.textContent = code
  document.body.appendChild(element)
  const rect = element.getBoundingClientRect()
  const calls: { x: number; y: number }[] = []
  const locate = (_document: Document, x: number, y: number) => {
    calls.push({ x, y })
    return calls.length === 1 ? null : { node: element.firstChild!, offset: 2 }
  }
  const offset = textOffsetAtPoint(element, rect.left - 100, rect.top + 1, code.length, locate)
  element.remove()
  return {
    offset,
    calls,
    rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
  }
}

function gutterSnapshot(expectedNormalLine: number) {
  const gutter = document.querySelector<HTMLElement>('.cm-block-lineNumbers')
  if (!gutter) return null
  const rangeMarkers = [...gutter.querySelectorAll<HTMLElement>('.cm-block-gutter-range')]
  const normalElement = [...gutter.querySelectorAll<HTMLElement>(':scope > .cm-gutterElement')]
    .find(element =>
      element.style.visibility !== 'hidden' &&
      !element.querySelector('.cm-block-gutter-range') &&
      element.textContent?.trim() === String(expectedNormalLine) &&
      element.getBoundingClientRect().height > 0)
  const normalStyle = normalElement ? getComputedStyle(normalElement) : null
  const widgets = [...document.querySelectorAll<HTMLElement>('.cm-shiki-codeblock')]
  return {
    gutterClass: gutter.className,
    normal: normalElement && normalStyle ? {
      text: normalElement.textContent,
      className: normalElement.className,
      fontFamily: normalStyle.fontFamily,
      fontSize: normalStyle.fontSize,
      fontWeight: normalStyle.fontWeight,
      color: normalStyle.color,
      opacity: normalStyle.opacity,
      fontVariantNumeric: normalStyle.fontVariantNumeric,
      height: normalElement.getBoundingClientRect().height,
    } : null,
    ranges: rangeMarkers.map((marker, index) => {
      const element = marker.parentElement as HTMLElement
      const elementStyle = getComputedStyle(element)
      const numberStyle = getComputedStyle(marker.querySelector<HTMLElement>('.cm-block-gutter-num')!)
      const elementRect = element.getBoundingClientRect()
      const markerRect = marker.getBoundingClientRect()
      const widgetRect = widgets[index]?.getBoundingClientRect()
      return {
        text: [...marker.querySelectorAll('.cm-block-gutter-num')].map(node => node.textContent),
        parentClassName: element.className,
        parentIsDirectGutterChild: element.parentElement === gutter,
        fontFamily: numberStyle.fontFamily,
        fontSize: numberStyle.fontSize,
        fontWeight: numberStyle.fontWeight,
        color: numberStyle.color,
        opacity: elementStyle.opacity,
        fontVariantNumeric: numberStyle.fontVariantNumeric,
        elementTop: elementRect.top,
        elementBottom: elementRect.bottom,
        elementHeight: elementRect.height,
        markerTop: markerRect.top,
        markerBottom: markerRect.bottom,
        markerHeight: markerRect.height,
        widgetTop: widgetRect?.top ?? null,
        widgetBottom: widgetRect?.bottom ?? null,
        widgetHeight: widgetRect?.height ?? null,
      }
    }),
  }
}

function applyGutterFont(fontFamily: string, fontSize: string): void {
  applyCssVariables(document.documentElement, {
    '--perwrite-font-family': fontFamily,
    '--perwrite-font-size': fontSize,
  } as PerwriteCssVariables)
  invalidateEditorAppearance(view)
}

Object.assign(globalThis, {
  interactionScenario: {
    get view() { return view },
    shikiReady,
    reset,
    setMode,
    setSelection,
    reveal,
    syntaxRange,
    tableWitness,
    setTableAppearance,
    snapshot,
    linkActivationWitness,
    tableLinkActivationWitness,
    shikiWitness,
    searchRevealWitness,
    repeatRevealOnly,
    atomicRangeCount,
    clickCodeWidgetSource,
    clickActualPlainCode,
    unresolvedCodeOffsets,
    clampedCodeOffset,
    reconfigureCodeBlockWrap,
    codeBlockWrapWitness,
    gutterSnapshot,
    applyGutterFont,
  },
})
