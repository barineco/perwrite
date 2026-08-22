import { EditorView, keymap, drawSelection } from '@codemirror/view'
import { Compartment, EditorSelection, EditorState, Facet, Transaction, type ChangeSet, type Extension, type StateEffect } from '@codemirror/state'
import { defaultKeymap } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import { closeSearchPanel, search, searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { editorFocused, irDecorationField, irFocusHandler, irMouseUpHandler } from './ir-state-field'
import { irTransactionFilter } from './ir-transaction-filter'
import { irKeymap } from './ir-keymap'
import { initialViewMode, viewModeField, profileFor, type ViewMode } from './view-mode'
import { perwriteTheme } from './theme'
import { blockLineNumbers } from './block-line-numbers'
import { linkDestination, wikilinkTarget } from './markdown-node-values'
import { completeMarkdownTreeField, initialCompleteMarkdownTree, markdownLezerParser, renderingProfileExtensions } from './rendering-profile'
import { compositionActiveField, compositionEventHandlers } from './composition-state'
import { imageDocumentGeneration, imagePreparationExtension } from './image-widget'
import { mermaidGeometryPreparationExtension } from './mermaid-geometry-preparation'
import { searchRevealExtension, setRevealTargetEffect } from './search-reveal'
import { toggleTaskMarker } from './task-editing'
import { linkActivation, type LinkActivation } from './link-activation'
import type { RenderingProfile } from '../../src/protocol'

export interface EditorCallbacks {
  onDocUpdate?: (content: string) => void
  onChanges?: (changes: ChangeSet, view: EditorView, beforeContent: string, afterContent: string) => void
  onLinkActivate?: LinkActivation
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

function linkDestinationForClick(event: MouseEvent, view: EditorView): string | null {
  const positions: number[] = []
  const target = event.target
  if (target instanceof Node && view.dom.contains(target)) {
    try {
      const start = view.posAtDOM(target, 0)
      const end = view.posAtDOM(target, target.childNodes.length)
      positions.push(start)
      if (end !== start) positions.push(end - 1)
    } catch {}
  }
  if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
    const position = view.posAtCoords({ x: event.clientX, y: event.clientY })
    if (position !== null && !positions.includes(position)) positions.push(position)
  }
  for (const position of positions) {
    const destination = markdownLinkAt(view.state, position)
    if (destination !== null) return destination
  }
  const eventElement = event.composedPath().find(value => typeof value === 'object' && value !== null && 'nodeType' in value) as Node | undefined
  const element = target && typeof target === 'object' && 'nodeType' in target
    ? (target as Node).nodeType === Node.ELEMENT_NODE ? target as Element : (target as Node).parentElement
    : eventElement?.nodeType === Node.ELEMENT_NODE ? eventElement as Element : eventElement?.parentElement ?? null
  const destination = element?.closest<HTMLAnchorElement>('a[href]')?.getAttribute('href')
  return destination || null
}

export function createEditor(
  root: HTMLElement,
  initialContent: string,
  callbacks: EditorCallbacks,
  initialMode: ViewMode,
  renderingConfiguration: RenderingProfile,
  options: EditorOptions = {},
): EditorView {
  const completeTree = markdownLezerParser(renderingConfiguration).parse(initialContent)
  const view = new EditorView({
    state: EditorState.create({
      doc: initialContent,
      extensions: [
        renderingProfileExtensions(renderingConfiguration, reason => callbacks.onConfigurationFailure?.(reason)),
        EditorState.allowMultipleSelections.of(true),
        imageDocumentGeneration,
        imagePreparationExtension,
        mermaidGeometryPreparationExtension,
        keymap.of([{ key: 'Escape', run: closeSearchPanel }, ...defaultKeymap, ...searchKeymap]),
        search({
          top: false,
          scrollToMatch: (range, _view) => setRevealTargetEffect.of({ from: range.from, to: range.to, source: 'internal' }),
        }),
        searchRevealExtension,
        highlightSelectionMatches(),
        drawSelection(),
        EditorView.lineWrapping,
        blockLineNumbers,
        perwriteTheme,

        editorFocused,
        linkActivation.of(callbacks.onLinkActivate ?? null),
        initialViewMode.of(initialMode),
        viewModeField,
        editorEditableCompartment.of(editorEditable.of(options.editable ?? true)),
        EditorState.readOnly.compute([viewModeField, editorEditable], state =>
          !profileFor(state.field(viewModeField)).editable || !state.facet(editorEditable)),
        EditorView.editable.compute([viewModeField, editorEditable], state =>
          profileFor(state.field(viewModeField)).editable && state.facet(editorEditable)),
        irFocusHandler,
        compositionActiveField,
        initialCompleteMarkdownTree.of(completeTree),
        completeMarkdownTreeField,
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
            callbacks.onChanges?.(update.changes, update.view, update.startState.doc.toString(), update.state.doc.toString())
          }
        }),
      ],
    }),
    parent: root,
  })

  view.contentDOM.addEventListener('click', event => {
    if (!event.ctrlKey && !event.metaKey) return
    const destination = linkDestinationForClick(event, view)
    if (destination === null || !callbacks.onLinkActivate) return
    callbacks.onLinkActivate(destination)
    event.preventDefault()
  })

  return view
}


function editorSelection(selection: readonly number[] | undefined): EditorSelection | undefined {
  if (!selection || selection.length < 2) return undefined
  return EditorSelection.create(selection.reduce<ReturnType<typeof EditorSelection.range>[]>((ranges, value, index) => index % 2 === 0 ? ranges : [...ranges, EditorSelection.range(selection[index - 1], value)], []))
}

export function setEditorContent(view: EditorView, newContent: string, selection?: readonly number[]): void {
  const currentContent = view.state.doc.toString()
  const nextSelection = editorSelection(selection)
  if (currentContent === newContent) {
    if (nextSelection) view.dispatch({ selection: nextSelection })
    return
  }

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
    ...(nextSelection ? { selection: nextSelection } : {}),
    effects: view.scrollSnapshot(),
    annotations: Transaction.addToHistory.of(false),
  })
}
