import type { EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode']

export interface VisibleNodeRange {
  readonly from: number
  readonly to: number
}

function markdownUnescape(value: string): string {
  let result = ''
  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    const nextCode = index + 1 < value.length ? value.charCodeAt(index + 1) : -1
    const escapedPunctuation = (nextCode >= 33 && nextCode <= 47)
      || (nextCode >= 58 && nextCode <= 64)
      || (nextCode >= 91 && nextCode <= 96)
      || (nextCode >= 123 && nextCode <= 126)
    if (char === '\\' && escapedPunctuation) {
      result += value[index + 1]
      index++
    } else {
      result += char
    }
  }
  return result
}

export function linkDestination(state: EditorState, node: SyntaxNode): string | null {
  const url = node.getChild('URL')
  if (!url) return null
  let value = state.doc.sliceString(url.from, url.to)
  if (value.startsWith('<') && value.endsWith('>')) value = value.slice(1, -1)
  return markdownUnescape(value)
}

export function linkLabel(state: EditorState, node: SyntaxNode): string {
  const marks = node.getChildren('LinkMark')
  if (marks.length < 2) return ''
  return markdownUnescape(state.doc.sliceString(marks[0].to, marks[1].from))
}

export function linkLabelRange(node: SyntaxNode): VisibleNodeRange | null {
  const marks = node.getChildren('LinkMark')
  if (marks.length < 2) return null
  return { from: marks[0].to, to: marks[1].from }
}

export function wikilinkTarget(state: EditorState, node: SyntaxNode): string | null {
  const target = node.getChild('WikilinkTarget')
  return target ? state.doc.sliceString(target.from, target.to) : null
}

export function wikilinkAlias(state: EditorState, node: SyntaxNode): string | null {
  const alias = node.getChild('WikilinkAlias')
  return alias ? state.doc.sliceString(alias.from, alias.to) : null
}

export function wikilinkDisplayRange(node: SyntaxNode): VisibleNodeRange | null {
  const visible = node.getChild('WikilinkAlias') ?? node.getChild('WikilinkTarget')
  return visible ? { from: visible.from, to: visible.to } : null
}
