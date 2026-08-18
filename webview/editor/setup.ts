import { EditorView, keymap, drawSelection } from '@codemirror/view'
import { Compartment, EditorState, Facet, Transaction, type ChangeSet, type Extension, type StateEffect } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import { closeSearchPanel, search, searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { editorFocused, irDecorationField, irFocusHandler, irMouseUpHandler } from './ir-state-field'
import { irTransactionFilter } from './ir-transaction-filter'
import { irKeymap } from './ir-keymap'
import { initialViewMode, viewModeField, profileFor, type ViewMode } from './view-mode'
import { perwriteTheme } from './theme'
import { blockLineNumbers } from './block-line-numbers'
import { linkDestination, wikilinkTarget } from './markdown-node-values'
import { renderingProfileExtensions } from './rendering-profile'
import { compositionActiveField, compositionEventHandlers } from './composition-state'
import { imageDocumentGeneration, imagePreparationExtension } from './image-widget'
import { mermaidGeometryPreparationExtension } from './mermaid-geometry-preparation'
import { searchRevealExtension, setRevealTargetEffect } from './search-reveal'
import { toggleTaskMarker } from './task-editing'
import type { RenderingProfile } from '../../src/protocol'

export interface EditorCallbacks {
  onDocUpdate?: (content: string) => void
  onChanges?: (changes: ChangeSet, view: EditorView, beforeContent: string, afterContent: string) => void
  onLinkClick?: (url: string) => void
  onConfigurationFailure?: (reason: string) => void
}

export interface EditorOptions {
  readonly editable?: boolean
  readonly immutable?: boolean
  readonly extensions?: Extension
}

const editorEditable = Facet.define<boolean, boolean>({
  combine: values => values.length === 0 || values.every(Boolean),
})
const editorEditableCompartment = new Compartment()

export function reconfigureEditorEditable(editable: boolean): readonly StateEffect<unknown>[] {
  return [editorEditableCompartment.reconfigure(editorEditable.of(editable))]
}

export function markdownLinkAt(state: EditorState, position: number): string | null {
  let node = syntaxTree(state).resolve(position, 1)
  while (node.parent && node.name !== 'Link' && node.name !== 'Wikilink') node = node.parent
  if (node.name === 'Link') return linkDestination(state, node)
  if (node.name === 'Wikilink') {
    const target = wikilinkTarget(state, node)
    if (target === null) return null
    return target.endsWith('.md') ? target : target + '.md'
  }
  return null
}

export function createEditor(
  root: HTMLElement,
  initialContent: string,
  callbacks: EditorCallbacks,
  initialMode: ViewMode,
  renderingConfiguration: RenderingProfile,
  options: EditorOptions = {},
): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc: initialContent,
      extensions: [
        renderingProfileExtensions(renderingConfiguration, reason => callbacks.onConfigurationFailure?.(reason)),
        EditorState.allowMultipleSelections.of(true),
        imageDocumentGeneration,
        imagePreparationExtension,
        mermaidGeometryPreparationExtension,
        keymap.of([{ key: 'Escape', run: closeSearchPanel }, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        search({
          top: false,
          scrollToMatch: (range, _view) => setRevealTargetEffect.of({ from: range.from, to: range.to, source: 'internal' }),
        }),
        searchRevealExtension,
        highlightSelectionMatches(),
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        blockLineNumbers,
        perwriteTheme,

        editorFocused,
        initialViewMode.of(initialMode),
        viewModeField,
        editorEditableCompartment.of(editorEditable.of(options.editable ?? true)),
        EditorState.readOnly.compute([viewModeField, editorEditable], state =>
          !profileFor(state.field(viewModeField)).editable || !state.facet(editorEditable)),
        EditorView.editable.compute([viewModeField, editorEditable], state =>
          profileFor(state.field(viewModeField)).editable && state.facet(editorEditable)),
        irFocusHandler,
        compositionActiveField,
        irDecorationField,
        irTransactionFilter,
        irKeymap,
        irMouseUpHandler,
        compositionEventHandlers,
        options.extensions ?? [],
        options.immutable
          ? EditorState.transactionFilter.of(transaction => transaction.docChanged ? [] : transaction)
          : [],

        EditorView.domEventHandlers({
          click(event, view) {
            if (event.ctrlKey || event.metaKey) {
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
              if (pos === null) return false
              const url = markdownLinkAt(view.state, pos)
              if (url !== null && callbacks.onLinkClick) {
                callbacks.onLinkClick(url)
                event.preventDefault()
                return true
              }
              return false
            }
            return false
          },
          mousedown(event, view) {
            const target = event.target as HTMLElement

            if (!(target instanceof HTMLInputElement && target.classList.contains('cm-task-checkbox'))) {
              return false
            }
            event.preventDefault()
            const pos = view.posAtDOM(target)
            const spec = toggleTaskMarker(view.state, pos)
              ?? toggleTaskMarker(view.state, Math.max(0, pos - 1))
            if (!spec) return false
            view.dispatch(spec)
            return true
          },
        }),

        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            callbacks.onDocUpdate?.(update.state.doc.toString())
            callbacks.onChanges?.(update.changes, view, update.startState.doc.toString(), update.state.doc.toString())
          }
        }),
      ],
    }),
    parent: root,
  })

  return view
}

export function setEditorContent(view: EditorView, newContent: string): void {
  const currentContent = view.state.doc.toString()
  if (currentContent === newContent) return

  let prefixLen = 0
  const minLen = Math.min(currentContent.length, newContent.length)
  while (prefixLen < minLen && currentContent[prefixLen] === newContent[prefixLen]) {
    prefixLen++
  }

  let suffixLen = 0
  while (
    suffixLen < minLen - prefixLen &&
    currentContent[currentContent.length - 1 - suffixLen] === newContent[newContent.length - 1 - suffixLen]
  ) {
    suffixLen++
  }

  const from = prefixLen
  const to = currentContent.length - suffixLen
  const insert = newContent.slice(prefixLen, newContent.length - suffixLen)

  view.dispatch({
    changes: { from, to, insert },
    effects: view.scrollSnapshot(),
    annotations: Transaction.addToHistory.of(false),
  })
}
