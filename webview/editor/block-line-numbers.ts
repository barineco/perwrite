import { type Extension } from '@codemirror/state'
import { EditorView, gutter, GutterMarker } from '@codemirror/view'

class LineNoMarker extends GutterMarker {
  constructor(readonly num: number) { super() }
  toDOM(): Text { return document.createTextNode(String(this.num)) }
  eq(other: LineNoMarker): boolean { return this.num === other.num }
}

class BlockRangeMarker extends GutterMarker {
  constructor(
    readonly startLine: number,
    readonly endLine: number,
  ) { super() }

  eq(other: BlockRangeMarker): boolean {
    return this.startLine === other.startLine && this.endLine === other.endLine
  }

  toDOM(): HTMLElement {
    const marker = document.createElement('div')
    marker.className = 'cm-block-gutter-range'

    const start = document.createElement('span')
    start.className = 'cm-block-gutter-num'
    start.textContent = String(this.startLine)

    const line = document.createElement('span')
    line.className = 'cm-block-gutter-line'

    const end = document.createElement('span')
    end.className = 'cm-block-gutter-num'
    end.textContent = String(this.endLine)

    marker.append(start, line, end)
    return marker
  }
}

export function lineRangeForBlock(
  doc: { readonly length: number; lineAt(position: number): { readonly number: number } },
  from: number,
  to: number,
): { readonly startLine: number; readonly endLine: number } {
  const startLine = doc.lineAt(from).number
  const endPosition = to > from ? to - 1 : to
  const endLine = doc.lineAt(Math.min(endPosition, doc.length)).number
  return { startLine, endLine }
}

export const blockLineNumbers: Extension = [
  gutter({
    class: 'cm-block-lineNumbers',
    lineMarker(view, block) {
      return new LineNoMarker(view.state.doc.lineAt(block.from).number)
    },
    widgetMarker(view, _widget, block) {
      const { startLine, endLine } = lineRangeForBlock(
        view.state.doc, block.from, block.to,
      )
      return endLine === startLine
        ? new LineNoMarker(startLine)
        : new BlockRangeMarker(startLine, endLine)
    },
    lineMarkerChange(update) {
      return update.docChanged || update.viewportChanged
    },
    initialSpacer(view) {
      return new LineNoMarker(view.state.doc.lines)
    },
  }),

  EditorView.baseTheme({
    '.cm-block-lineNumbers .cm-gutterElement': {
      padding: '0 3px 0 5px',
      minWidth: '20px',
      textAlign: 'right',
      whiteSpace: 'nowrap',
      fontVariantNumeric: 'tabular-nums',
    },
  }),
]
