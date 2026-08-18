import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { isolateHistory } from '@codemirror/commands'
import { linkLabelRange, wikilinkDisplayRange } from './markdown-node-values'

export type DeletionDirection = 'backward' | 'forward'

interface SourceRange {
  readonly from: number
  readonly to: number
}

const blockNodes = new Set(['FencedCode', 'BlockMath', 'Table'])
const markedNodes: Readonly<Record<string, string>> = {
  Emphasis: 'EmphasisMark',
  StrongEmphasis: 'EmphasisMark',
  Strikethrough: 'StrikethroughMark',
}

function range(from: number, to: number): SourceRange | null {
  return from < to ? { from, to } : null
}

function followingSpaceEnd(state: EditorState, to: number): number {
  return state.doc.sliceString(to, to + 1) === ' ' ? to + 1 : to
}

function collectInteractionRanges(state: EditorState): {
  readonly blocks: SourceRange[]
  readonly markers: SourceRange[]
} {
  const blocks: SourceRange[] = []
  const markers: SourceRange[] = []

  syntaxTree(state).iterate({
    enter(ref) {
      const node = ref.node
      if (blockNodes.has(ref.name)) {
        blocks.push({ from: ref.from, to: ref.to })
        return
      }

      const markName = markedNodes[ref.name]
      if (markName) {
        for (const mark of node.getChildren(markName)) {
          const item = range(mark.from, mark.to)
          if (item) markers.push(item)
        }
        return
      }

      if (ref.name.startsWith('ATXHeading')) {
        const mark = node.getChild('HeaderMark')
        if (mark) {
          const item = range(mark.from, followingSpaceEnd(state, mark.to))
          if (item) markers.push(item)
        }
        return
      }

      if (ref.name === 'QuoteMark' || ref.name === 'ListMark') {
        const item = range(ref.from, followingSpaceEnd(state, ref.to))
        if (item) markers.push(item)
        return
      }

      if (ref.name === 'Link' || ref.name === 'Wikilink') {
        const visible = ref.name === 'Link' ? linkLabelRange(node) : wikilinkDisplayRange(node)
        if (visible) {
          const opening = range(ref.from, visible.from)
          const closing = range(visible.to, ref.to)
          if (opening) markers.push(opening)
          if (closing && (closing.from !== opening?.from || closing.to !== opening.to)) markers.push(closing)
        }
      }
    },
  })

  return { blocks, markers }
}

function sameRange(selection: { from: number; to: number }, source: SourceRange): boolean {
  return selection.from === source.from && selection.to === source.to
}

export function deletionTransaction(
  state: EditorState,
  direction: DeletionDirection,
): TransactionSpec | null {
  if (state.readOnly || state.selection.ranges.length !== 1) return null
  const selection = state.selection.main
  const { blocks, markers } = collectInteractionRanges(state)

  if (!selection.empty) {
    const selectedBlock = blocks.find(block => sameRange(selection, block))
    if (!selectedBlock) return null
    return {
      changes: { from: selectedBlock.from, to: selectedBlock.to },
      selection: EditorSelection.cursor(selectedBlock.from),
      userEvent: direction === 'backward' ? 'delete.backward' : 'delete.forward',
      annotations: isolateHistory.of('full'),
    }
  }

  const position = selection.head
  const adjacentBlock = blocks.find(block =>
    direction === 'backward' ? block.to === position : block.from === position)
  if (adjacentBlock) {
    return {
      selection: EditorSelection.range(adjacentBlock.from, adjacentBlock.to),
      scrollIntoView: true,
    }
  }

  const adjacentMarker = markers.find(marker =>
    direction === 'backward' ? marker.to === position : marker.from === position)
  if (!adjacentMarker) return null
  return {
    changes: { from: adjacentMarker.from, to: adjacentMarker.to },
    selection: EditorSelection.cursor(adjacentMarker.from),
    userEvent: direction === 'backward' ? 'delete.backward' : 'delete.forward',
    annotations: isolateHistory.of('full'),
  }
}

export function correctedPointerPosition(state: EditorState, position: number): number {
  const { markers } = collectInteractionRanges(state)
  const containing = markers
    .filter(item => position > item.from && position < item.to)
    .sort((a, b) => (a.to - a.from) - (b.to - b.from))[0]
  if (!containing) return position
  const distanceToStart = position - containing.from
  const distanceToEnd = containing.to - position
  return distanceToStart <= distanceToEnd ? containing.from : containing.to
}
