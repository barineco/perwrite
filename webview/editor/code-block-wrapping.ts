import { Facet, StateEffect, StateField, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import type { RenderingProfile, Result } from '../../src/protocol'

export interface CodeBlockWrapValue {
  readonly generation: number
  readonly enabled: boolean
}

type CaretDocument = Document & {
  caretRangeFromPoint?(x: number, y: number): Range | null
}

export type CodePointLocator = (
  document: CaretDocument,
  x: number,
  y: number,
) => { readonly node: Node; readonly offset: number } | null

function locateCodePoint(document: CaretDocument, x: number, y: number) {
  const position = document.caretPositionFromPoint?.(x, y)
  if (position) return { node: position.offsetNode, offset: position.offset }
  const range = document.caretRangeFromPoint?.(x, y)
  return range ? { node: range.startContainer, offset: range.startOffset } : null
}

export function resolveCodePoint(
  code: HTMLElement,
  x: number,
  y: number,
  textLength: number,
  locate: CodePointLocator = locateCodePoint,
): Result<number> {
  const document = code.ownerDocument as CaretDocument
  const rect = code.getBoundingClientRect()
  const inset = 0.5
  const clampedX = rect.width > inset * 2 ? Math.min(Math.max(x, rect.left + inset), rect.right - inset) : rect.left
  const clampedY = rect.height > inset * 2 ? Math.min(Math.max(y, rect.top + inset), rect.bottom - inset) : rect.top

  for (const [candidateX, candidateY] of [[x, y], [clampedX, clampedY]]) {
    const caret = locate(document, candidateX, candidateY)
    if (!caret || (caret.node !== code && !code.contains(caret.node))) continue
    if (caret.node.nodeType === 3) {
      const text = caret.node.textContent ?? ''
      if (caret.offset > 0 && caret.offset < text.length
        && /[\uD800-\uDBFF]/.test(text[caret.offset - 1])
        && /[\uDC00-\uDFFF]/.test(text[caret.offset])) {
        return { ok: false, error: 'Code point resolves inside a UTF-16 surrogate pair' }
      }
    }
    try {
      const prefix = document.createRange()
      prefix.selectNodeContents(code)
      prefix.setEnd(caret.node, caret.offset)
      const offset = prefix.toString().length
      if (offset > textLength) return { ok: false, error: 'Code point exceeds the source text length' }
      return { ok: true, value: offset }
    } catch {
      return { ok: false, error: 'Code point range could not be constructed' }
    }
  }
  return { ok: false, error: 'Code point is outside the code block DOM' }
}

const initialCodeBlockWrap = Facet.define<CodeBlockWrapValue, CodeBlockWrapValue>({
  combine: values => values[values.length - 1],
})

export const setCodeBlockWrapEffect = StateEffect.define<CodeBlockWrapValue>()
export const reportCodeBlockFailureEffect = StateEffect.define<string>()

export const codeBlockWrapState = StateField.define<CodeBlockWrapValue>({
  create: state => state.facet(initialCodeBlockWrap),
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setCodeBlockWrapEffect)) return effect.value
    return value
  },
})

function valueFromProfile(profile: RenderingProfile): CodeBlockWrapValue {
  return { generation: profile.generation, enabled: profile.codeBlockWrap }
}

function failureForDom(view: EditorView, value: CodeBlockWrapValue): string | null {
  const sourceLines = [...view.dom.querySelectorAll<HTMLElement>('.cm-codeblock-line')]
  const widgets = [...view.dom.querySelectorAll<HTMLElement>('.cm-shiki-codeblock')]
  if (sourceLines.length + widgets.length === 0) return null
  if (value.enabled) {
    for (const element of [...sourceLines, ...widgets]) {
      if (element.scrollWidth > element.clientWidth + 1) return 'Code block wrapping exceeds its content width'
    }
    for (const element of sourceLines) {
      if (getComputedStyle(element).whiteSpace !== 'break-spaces') return 'Code block source line did not apply wrapping'
    }
    for (const code of view.dom.querySelectorAll<HTMLElement>('.cm-shiki-codeblock code, .cm-render-error-source')) {
      if (getComputedStyle(code).whiteSpace !== 'break-spaces') return 'Code block widget did not apply wrapping'
    }
  } else if (view.scrollDOM.scrollWidth > view.scrollDOM.clientWidth + 1) {
    return 'Code block overflow escaped into the editor'
  }
  return null
}

function wrappingPlugin(reportFailure: (reason: string) => void) {
  return ViewPlugin.fromClass(class {
    private value: CodeBlockWrapValue
    private readonly reported = new Set<string>()

    constructor(private readonly view: EditorView) {
      this.value = view.state.field(codeBlockWrapState)
      this.measure()
    }

    update(update: ViewUpdate): void {
      for (const transaction of update.transactions) {
        for (const effect of transaction.effects) {
          if (effect.is(reportCodeBlockFailureEffect)) this.report(effect.value)
        }
      }
      const next = update.state.field(codeBlockWrapState)
      const configurationChanged = next.generation !== this.value.generation || next.enabled !== this.value.enabled
      if (configurationChanged) {
        this.value = next
      }
      if (update.docChanged || update.geometryChanged || update.viewportChanged || configurationChanged) this.measure()
    }

    private report(reason: string): void {
      const key = `${this.value.generation}:${reason}`
      if (this.reported.has(key)) return
      this.reported.add(key)
      reportFailure(reason)
    }

    private measure(): void {
      this.view.requestMeasure({
        read: view => failureForDom(view, this.value),
        write: reason => { if (reason) this.report(reason) },
      })
    }
  })
}

export function codeBlockWrappingExtensions(
  profile: RenderingProfile,
  reportFailure: (reason: string) => void,
): Extension {
  return [
    initialCodeBlockWrap.of(valueFromProfile(profile)),
    codeBlockWrapState,
    EditorView.editorAttributes.compute([codeBlockWrapState], state => {
      const value = state.field(codeBlockWrapState)
      return {
        class: value.enabled ? 'cm-codeblock-wrap-enabled' : 'cm-codeblock-wrap-disabled',
        'data-code-block-wrap-generation': String(value.generation),
      }
    }),
    wrappingPlugin(reportFailure),
  ]
}

export function reconfigureCodeBlockWrapping(profile: RenderingProfile): StateEffect<CodeBlockWrapValue> {
  return setCodeBlockWrapEffect.of(valueFromProfile(profile))
}
