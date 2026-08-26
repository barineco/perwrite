import type { AppearanceHostSources } from '../../src/appearance-profile'
import type { EditorConfiguration, HostMessage, Result, WebviewMessage } from '../../src/protocol'
import { contentHash } from '../../src/protocol'
import { defaultPerwriteSettings } from '../../src/settings-resolver'
import { EditorView } from '@codemirror/view'
import { setViewModeEffect, type ViewMode } from '../../webview/editor/view-mode'
import { markdownLezerParser, setCompleteMarkdownTreeEffect } from '../../webview/editor/rendering-profile'


const outbound: WebviewMessage[] = []
Object.assign(globalThis, { acquireVsCodeApi: () => ({ postMessage(message: WebviewMessage) { outbound.push(message) }, getState() { return undefined }, setState() {} }) })
document.documentElement.style.setProperty('--vscode-editor-background', '#123456')
document.documentElement.style.setProperty('--vscode-editor-foreground', '#abcdef')
document.body.dataset.vscodeThemeKind = 'vscode-dark'
await import('../../webview/index')

const appearance: AppearanceHostSources = {
  version: 1,
  settings: { ok: true, value: { perwrite: defaultPerwriteSettings(), editorFont: { family: 'Mono', size: 14 } } },
  fallbackFont: { family: 'Mono', size: 14 },
  tokenTheme: { ok: true, value: { name: 'sample', type: 'dark', tokenColors: [], semanticTokenColors: {}, semanticHighlighting: false } },
}
let rendering = { generation: 1, codeBlockWrap: true, mermaidLayout: 'elk' as const, mermaidMaxEdges: 1024, mermaidPanStep: 80, mermaidZoomStep: 1.5, texRendering: true }
const editorConfiguration = (): Result<EditorConfiguration> => ({ ok: true, value: { defaultViewMode: 'render', configurationFailure: null, rendering } })
const uri = 'file:host-scenario'
let generation = 0
let content = '# Title\n'
let selection: number[] = []

function view(): EditorView {
  const editor = document.querySelector<HTMLElement>('.cm-editor')
  const resolved = editor && EditorView.findFromDOM(editor)
  if (!resolved) throw new Error('editor unavailable')
  return resolved
}

function sendSnapshot(externalChange: string | null = null): void {
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'draft-snapshot', uri, content, contentHash: contentHash(content), selection, generation, dirty: content !== '# Title\n', externalChange } satisfies HostMessage,
  }))
}

Object.assign(globalThis, {
  perwriteHost: {
    outbound,
    sendInit() {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'init', documentId: uri, content, documentVersion: generation, appearance, baseResourceUri: 'https://perwrite.test/', configuration: editorConfiguration() } satisfies HostMessage,
      }))
    },
    sendSnapshot,
    undo() { content = '# Title\n'; selection = [1, 0]; generation++; sendSnapshot() },
    redo() { content = '# Title\nA'; selection = [8, 7]; generation++; sendSnapshot() },
    externalClean(value: string) { content = value; selection = []; generation++; sendSnapshot() },
    externalDirty(value: string) { generation++; sendSnapshot(value) },
    rejectCanonical(value: string) { content = value; selection = [0, 0]; generation++; sendSnapshot() },
    select(anchor: number, head: number) { view().dispatch({ selection: { anchor, head } }) },
    input(value: string) { const current = view(); current.dispatch({ changes: { from: current.state.doc.length, insert: value } }) },
    toggle() { document.querySelector<HTMLButtonElement>('#toggle-view')?.click() },
    replaceContent(value: string) {
      const current = view()
      current.dispatch({
        changes: { from: 0, to: current.state.doc.length, insert: value },
        effects: setCompleteMarkdownTreeEffect.of(markdownLezerParser(rendering).parse(value)),
      })
    },
    edit(change: { from: number; to: number; insert: string }) {
      const current = view()
      const next = current.state.doc.sliceString(0, change.from) + change.insert + current.state.doc.sliceString(change.to)
      current.dispatch({
        changes: change,
        effects: setCompleteMarkdownTreeEffect.of(markdownLezerParser(rendering).parse(next)),
      })
    },
    setMode(mode: ViewMode) {
      const current = view()
      current.dispatch({
        effects: [
          setViewModeEffect.of(mode),
          setCompleteMarkdownTreeEffect.of(markdownLezerParser(rendering).parse(current.state.doc.toString())),
        ],
      })
      document.querySelector<HTMLButtonElement>('#toggle-view')!.textContent = mode.charAt(0).toUpperCase() + mode.slice(1)
    },
    configurationChange(codeBlockWrap: boolean) {
      rendering = { ...rendering, generation: rendering.generation + 1, codeBlockWrap }
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'configuration-change', configuration: editorConfiguration() } satisfies HostMessage,
      }))
    },
    reveal(from: number, to: number) {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'reveal-target', documentId: uri, from, to, source: 'external' } satisfies HostMessage,
      }))
    },
    revealState() {
      const current = view()
      return { editorClass: current.dom.className, exact: current.dom.querySelectorAll('.cm-reveal-target-exact').length, lines: current.dom.querySelectorAll('.cm-reveal-target-line').length }
    },
    view() {
      const current = view()
      return { docLength: current.state.doc.length, viewportFrom: current.viewport.from, viewportTo: current.viewport.to, scrollTop: current.scrollDOM.scrollTop, scrollHeight: current.scrollDOM.scrollHeight, clientHeight: current.scrollDOM.clientHeight }
    },
    scrollTo(pos: number) {
      const current = view()
      const scrollerRect = current.scrollDOM.getBoundingClientRect()
      const rect = current.coordsAtPos(pos)
      current.scrollDOM.scrollTop = rect
        ? current.scrollDOM.scrollTop + rect.top - scrollerRect.top - 120
        : Math.max(0, current.lineBlockAt(pos).top - 120)
    },
    anchor(pos: number) {
      const current = view()
      const rect = current.coordsAtPos(pos)
      if (!rect) return null
      const scroller = current.scrollDOM.getBoundingClientRect()
      return { pos, relativeTop: rect.top - scroller.top, viewportTop: scroller.top, viewportBottom: scroller.bottom, rectTop: rect.top, rectBottom: rect.bottom }
    },
    witness() {
      const current = view()
      return { content: current.state.doc.toString(), selection: current.state.selection.ranges.flatMap(range => [range.anchor, range.head]), generation: document.body.dataset.webviewSessionGeneration, dirty: document.body.dataset.dirty, conflict: document.body.dataset.externalConflict, outbound: outbound.slice() }
    },
  },
})

declare global {
  // Test-only API injected into the browser page.
  // eslint-disable-next-line no-var
  var perwriteHost: Record<string, (...args: any[]) => any> & { outbound: WebviewMessage[] }
}
