import '../../webview/theme/styles.css'
import { createEditor, setEditorContent } from '../../webview/editor/setup'
import { reconfigureRendering } from '../../webview/editor/rendering-profile'
import { refreshMermaidPresentations, updateMermaidTheme } from '../../webview/nodes/mermaid-node'
import { Modal } from '../../webview/components/modal'

const small = '```mermaid\ngraph TD\n  A --> B\n```'
const large = `\`\`\`mermaid\ngraph LR\n${Array.from({ length: 18 }, (_, index) => `  N${index}[Node ${index}] --> N${index + 1}[Node ${index + 1}]`).join('\n')}\n\`\`\``
const renderObservations: Array<{
  readonly location: 'preparation' | 'inline' | 'overlay' | 'unprepared'
  readonly visibility: string
  readonly configured: boolean
}> = []
const renderObserver = new MutationObserver(records => {
  for (const record of records) {
    for (const added of record.addedNodes) {
      if (!(added instanceof Element)) continue
      const svgs = [
        ...(added instanceof SVGSVGElement ? [added] : []),
        ...added.querySelectorAll<SVGSVGElement>('svg'),
      ]
      for (const svg of svgs) {
        const location = svg.closest('.cm-mermaid-preparation')
          ? 'preparation'
          : svg.closest('.cm-mermaid-overview')
            ? 'inline'
            : svg.closest('.cm-mermaid-overlay-canvas')
              ? 'overlay'
              : svg.id.startsWith('mermaid-')
                ? 'unprepared'
                : null
        if (!location) continue
        renderObservations.push({
          location,
          visibility: getComputedStyle(svg).visibility,
          configured: Boolean(svg.getAttribute('viewBox') && svg.style.width && svg.style.height),
        })
      }
    }
  }
})
renderObserver.observe(document.documentElement, { childList: true, subtree: true })
const root = document.getElementById('editor')!
const normalRoot = document.createElement('section')
const originalRoot = document.createElement('section')
const modifiedRoot = document.createElement('section')
normalRoot.className = 'mermaid-normal'
originalRoot.className = 'mermaid-side mermaid-original'
modifiedRoot.className = 'mermaid-side mermaid-modified'
root.append(normalRoot, originalRoot, modifiedRoot)
const rendering = {
  generation: 0, codeBlockWrap: true, mermaidLayout: 'dagre' as const, mermaidMaxEdges: 1024,
  mermaidPanStep: 80, mermaidZoomStep: 1.5, texRendering: true,
}
const normal = createEditor(normalRoot, `${small}\n\n${large}`, {}, 'render', rendering)
const original = createEditor(originalRoot, large, {}, 'render', rendering, { editable: false, immutable: true })
const modified = createEditor(modifiedRoot, large.replace('Node 8', 'Changed 8'), {}, 'render', rendering)
let preparedModal: Modal | null = null

Object.assign(globalThis, {
  mermaidScenario: {
    normal, original, modified,
    large,
    renderObservations() { return [...renderObservations] },
    setNormalContent(content: string) { setEditorContent(normal, content) },
    setLargeContent(content: string) { setEditorContent(normal, `${small}\n\n${content}`) },
    setLayout(layout: 'elk' | 'dagre') {
      normal.dispatch({ effects: reconfigureRendering({ ...rendering, mermaidLayout: layout }) })
    },
    setTheme(kind: string) {
      updateMermaidTheme(kind)
      refreshMermaidPresentations()
    },
    snapshot() {
      return {
        documents: [normal, original, modified].map(view => view.state.doc.toString()),
        selections: [normal, original, modified].map(view => view.state.selection.main.toJSON()),
        scrolls: [normal, original, modified].map(view => view.scrollDOM.scrollTop),
        widgets: [...document.querySelectorAll<HTMLElement>('.cm-mermaid-block')].map(widget => ({
          from: widget.dataset.sourceFrom, to: widget.dataset.sourceTo,
        })),
      }
    },
  },
  modalScenario: {
    prepare() {
      preparedModal = new Modal({
        label: 'Modal lifecycle test',
        returnTarget: normalRoot,
        onRequestClose: () => preparedModal?.dispose(false),
      })
      preparedModal.content.tabIndex = 0
      preparedModal.mount()
      return {
        phase: preparedModal.phase,
        visibility: getComputedStyle(preparedModal.root).visibility,
        connected: preparedModal.root.isConnected,
      }
    },
    present() {
      if (!preparedModal) throw new Error('Prepared modal is unavailable')
      preparedModal.present(preparedModal.content)
      return {
        phase: preparedModal.phase,
        visibility: getComputedStyle(preparedModal.root).visibility,
        focused: document.activeElement === preparedModal.content,
      }
    },
    dispose() {
      preparedModal?.dispose(false)
      preparedModal = null
    },
    invalidTransitions() {
      const modal = new Modal({
        label: 'Modal invalid transition test',
        returnTarget: normalRoot,
        onRequestClose() {},
      })
      const failures: string[] = []
      try { modal.present(modal.content) } catch (error) { failures.push(String(error)) }
      modal.mount()
      try { modal.mount() } catch (error) { failures.push(String(error)) }
      try { modal.present(normalRoot) } catch (error) { failures.push(String(error)) }
      modal.dispose(false)
      return failures
    },
  },
})
