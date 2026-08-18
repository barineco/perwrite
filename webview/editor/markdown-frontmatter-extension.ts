import { type MarkdownConfig, type BlockContext, type Line, type Element } from '@lezer/markdown'

const FrontmatterConfig: MarkdownConfig = {
  defineNodes: [
    { name: 'Frontmatter', block: true },
    { name: 'FrontmatterMark' },
  ],
  parseBlock: [{
    name: 'Frontmatter',
    parse(cx: BlockContext, line: Line): boolean {
      if (cx.lineStart !== 0) return false
      if (line.text.trimEnd() !== '---') return false

      const openFrom = cx.lineStart
      const openTo = openFrom + line.text.length
      const children: Element[] = [cx.elt('FrontmatterMark', openFrom, openTo)]

      while (cx.nextLine()) {
        if (line.text.trimEnd() === '---') {
          const closeFrom = cx.lineStart
          const closeTo = closeFrom + line.text.length
          children.push(cx.elt('FrontmatterMark', closeFrom, closeTo))
          cx.addElement(cx.elt('Frontmatter', openFrom, closeTo, children))
          cx.nextLine()
          return true
        }
      }
      // An unclosed delimiter is parsed as ordinary content.
      return false
    },
    before: 'HorizontalRule',
  }],
}

export const frontmatterExtension = [FrontmatterConfig]
