import { type MarkdownConfig, type InlineContext, type BlockContext, type Line, type Element } from '@lezer/markdown'

const InlineMathConfig: MarkdownConfig = {
  defineNodes: [
    { name: 'InlineMath' },
    { name: 'InlineMathMark' },
  ],
  parseInline: [{
    name: 'InlineMath',
    parse(cx: InlineContext, next: number, pos: number): number {
      if (next !== 36) return -1

      const double = cx.char(pos + 1) === 36
      const delimLen = double ? 2 : 1

      const marks: Element[] = [cx.elt('InlineMathMark', pos, pos + delimLen)]

      for (let i = pos + delimLen; i < cx.end; i++) {
        const ch = cx.char(i)
        if (ch === 92 /* \ */) { i++; continue }
        if (ch === 10) break
        if (ch === 36) {
          if (double) {
            if (cx.char(i + 1) !== 36) continue
            marks.push(cx.elt('InlineMathMark', i, i + 2))
            return cx.addElement(cx.elt('InlineMath', pos, i + 2, marks))
          } else {
            if (cx.char(i + 1) === 36) continue // skip $$ inside $...$
            marks.push(cx.elt('InlineMathMark', i, i + 1))
            return cx.addElement(cx.elt('InlineMath', pos, i + 1, marks))
          }
        }
      }
      return -1
    },
    after: 'Emphasis',
  }],
}

const BlockMathConfig: MarkdownConfig = {
  defineNodes: [
    { name: 'BlockMath', block: true },
    { name: 'BlockMathMark' },
  ],
  parseBlock: [{
    name: 'BlockMath',
    parse(cx: BlockContext, line: Line): boolean {
      const lineText = line.text
      if (!lineText.trimStart().startsWith('$$')) return false
      const indent = lineText.length - lineText.trimStart().length
      const openFrom = cx.lineStart + indent
      const openTo = openFrom + 2

      if (lineText.trimStart().slice(2).includes('$$')) return false

      const openMark = cx.elt('BlockMathMark', openFrom, openTo)
      const children: Element[] = [openMark]
      const from = cx.lineStart

      while (cx.nextLine()) {
        const closeLine = line.text
        if (closeLine.trimStart().startsWith('$$')) {
          const closeIndent = closeLine.length - closeLine.trimStart().length
          const closeFrom = cx.lineStart + closeIndent
          const closeTo = closeFrom + 2
          children.push(cx.elt('BlockMathMark', closeFrom, closeTo))
          cx.addElement(cx.elt('BlockMath', from, closeTo, children))
          cx.nextLine()
          return true
        }
      }

      // An unclosed delimiter consumes the remaining document as math content.
      cx.addElement(cx.elt('BlockMath', from, cx.lineStart, children))
      return true
    },
    before: 'FencedCode',
  }],
}

export const mathExtension = [InlineMathConfig, BlockMathConfig]
