import { syntaxTree } from '@codemirror/language'
import { isolateHistory } from '@codemirror/commands'
import type { EditorState, SelectionRange, TransactionSpec } from '@codemirror/state'
import type { Command } from '@codemirror/view'

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode']

interface ItemGroup {
  readonly items: readonly SyntaxNode[]
  readonly list: SyntaxNode
}

interface LineChange {
  readonly from: number
  readonly to?: number
  readonly insert: string
}

function nodeKey(node: SyntaxNode): string {
  return `${node.name}:${node.from}:${node.to}`
}

function listItemAt(state: EditorState, range: SelectionRange): SyntaxNode[] | null {
  const tree = syntaxTree(state)
  if (range.empty) {
    let node: SyntaxNode | null = tree.resolveInner(range.head, -1)
    while (node && node.name !== 'ListItem') node = node.parent
    return node ? [node] : null
  }

  const intersecting: SyntaxNode[] = []
  tree.iterate({
    from: range.from,
    to: range.to,
    enter(ref) {
      if (ref.name === 'ListItem' && ref.from < range.to && ref.to > range.from) {
        intersecting.push(ref.node)
      }
    },
  })
  if (intersecting.length === 0) return null

  const selected = new Set(intersecting.map(nodeKey))
  return intersecting.filter((item) => {
    let ancestor = item.parent
    while (ancestor) {
      if (ancestor.name === 'ListItem' && selected.has(nodeKey(ancestor))) return false
      ancestor = ancestor.parent
    }
    return true
  })
}

function normalizeGroup(state: EditorState, range: SelectionRange): ItemGroup | null {
  const items = listItemAt(state, range)
  if (!items || items.length === 0) return null
  const list = items[0].parent
  if (!list || (list.name !== 'BulletList' && list.name !== 'OrderedList')) return null
  if (items.some(item => !item.parent || nodeKey(item.parent) !== nodeKey(list))) return null

  const siblings = list.getChildren('ListItem')
  const indexes = items.map(item => siblings.findIndex(sibling => nodeKey(sibling) === nodeKey(item)))
  if (indexes.some(index => index < 0)) return null
  indexes.sort((a, b) => a - b)
  for (let index = 1; index < indexes.length; index++) {
    if (indexes[index] !== indexes[index - 1] + 1) return null
  }
  return { items: indexes.map(index => siblings[index]), list }
}

function listMark(item: SyntaxNode): SyntaxNode | null {
  return item.getChild('ListMark')
}

function visualColumn(text: string, end: number): number {
  let column = 0
  for (let index = 0; index < end; index++) {
    column = text[index] === '\t' ? column + (4 - column % 4) : column + 1
  }
  return column
}

function levelWidth(state: EditorState, item: SyntaxNode): number | null {
  const mark = listMark(item)
  if (!mark) return null
  const line = state.doc.lineAt(mark.from)
  const markFrom = mark.from - line.from
  const markTo = mark.to - line.from
  const whitespace = /^[ \t]*/.exec(line.text.slice(markTo))?.[0] ?? ''
  const width = visualColumn(line.text, markTo + whitespace.length)
    - visualColumn(line.text, markFrom)
  return width > 0 ? width : null
}

function parentListItem(list: SyntaxNode): SyntaxNode | null {
  let node = list.parent
  while (node) {
    if (node.name === 'ListItem') return node
    node = node.parent
  }
  return null
}

function quotePrefixEnd(text: string, maximumDepth: number): number {
  let position = 0
  let depth = 0
  while (depth < maximumDepth) {
    let cursor = position
    let spaces = 0
    while (spaces < 3 && text[cursor] === ' ') {
      cursor++
      spaces++
    }
    if (text[cursor] !== '>') break
    cursor++
    if (text[cursor] === ' ' || text[cursor] === '\t') cursor++
    position = cursor
    depth++
  }
  return position
}

function quoteDepthBefore(state: EditorState, position: number): number {
  const line = state.doc.lineAt(position)
  const prefix = line.text.slice(0, position - line.from)
  let cursor = 0
  let depth = 0
  while (cursor < prefix.length) {
    let spaces = 0
    while (spaces < 3 && prefix[cursor] === ' ') {
      cursor++
      spaces++
    }
    if (prefix[cursor] !== '>') break
    cursor++
    if (prefix[cursor] === ' ' || prefix[cursor] === '\t') cursor++
    depth++
  }
  return depth
}

function touchedLines(state: EditorState, group: ItemGroup): readonly { from: number; text: string }[] {
  const from = group.items[0].from
  const to = group.items[group.items.length - 1].to
  const first = state.doc.lineAt(from)
  const last = state.doc.lineAt(Math.max(from, to - 1))
  const lines: { from: number; text: string }[] = []
  for (let number = first.number; number <= last.number; number++) {
    const line = state.doc.line(number)
    lines.push({ from: line.from, text: line.text })
  }
  return lines
}

function changesForGroup(
  state: EditorState,
  group: ItemGroup,
  direction: 'indent' | 'outdent',
): readonly LineChange[] | null {
  const siblings = group.list.getChildren('ListItem')
  const firstIndex = siblings.findIndex(item => nodeKey(item) === nodeKey(group.items[0]))
  let width: number | null
  if (direction === 'indent') {
    if (firstIndex <= 0) return null
    width = levelWidth(state, siblings[firstIndex - 1])
  } else {
    const parent = parentListItem(group.list)
    if (!parent) return null
    width = levelWidth(state, parent)
  }
  if (width === null) return null

  const rootMark = listMark(group.items[0])
  if (!rootMark) return null
  const quoteDepth = quoteDepthBefore(state, rootMark.from)
  const changes: LineChange[] = []
  for (const line of touchedLines(state, group)) {
    const prefixEnd = quotePrefixEnd(line.text, quoteDepth)
    const from = line.from + prefixEnd
    if (direction === 'indent') {
      changes.push({ from, insert: ' '.repeat(width) })
    } else {
      if (line.text.slice(prefixEnd, prefixEnd + width) !== ' '.repeat(width)) return null
      changes.push({ from, to: from + width, insert: '' })
    }
  }
  return changes
}

export function listHierarchyTransaction(
  state: EditorState,
  direction: 'indent' | 'outdent',
): TransactionSpec | null {
  if (state.readOnly) return null
  const groups: ItemGroup[] = []
  for (const range of state.selection.ranges) {
    const group = normalizeGroup(state, range)
    if (!group) return null
    groups.push(group)
  }

  const changes: LineChange[] = []
  for (const group of groups) {
    const groupChanges = changesForGroup(state, group, direction)
    if (!groupChanges) return null
    changes.push(...groupChanges)
  }

  const ordered = [...changes].sort((left, right) => left.from - right.from)
  for (let index = 1; index < ordered.length; index++) {
    const previousTo = ordered[index - 1].to ?? ordered[index - 1].from
    if (ordered[index].from <= previousTo) return null
  }
  return {
    changes: ordered,
    userEvent: direction === 'indent' ? 'input.indent' : 'delete.dedent',
    annotations: isolateHistory.of('full'),
  }
}

function hierarchyCommand(direction: 'indent' | 'outdent'): Command {
  return ({ state, dispatch }) => {
    const spec = listHierarchyTransaction(state, direction)
    if (!spec) return false
    dispatch(state.update(spec))
    return true
  }
}

export const indentListHierarchy = hierarchyCommand('indent')
export const outdentListHierarchy = hierarchyCommand('outdent')
