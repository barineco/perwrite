import { type MarkdownConfig, type InlineContext, type Element } from '@lezer/markdown'

const WikilinkConfig: MarkdownConfig = {
  defineNodes: [
    { name: 'Wikilink' },
    { name: 'WikilinkMark' },
    { name: 'WikilinkTarget' },
    { name: 'WikilinkAlias' },
  ],
  parseInline: [{
    name: 'Wikilink',
    parse(cx: InlineContext, next: number, pos: number): number {
      if (next !== 91 || cx.char(pos + 1) !== 91) return -1
      if (pos > cx.offset && cx.char(pos - 1) === 33) return -1

      const children: Element[] = [cx.elt('WikilinkMark', pos, pos + 2)]
      let separator = -1

      for (let i = pos + 2; i < cx.end - 1; i++) {
        if (cx.char(i) === 10) break
        if (cx.char(i) === 124 && separator < 0) separator = i
        if (cx.char(i) === 93 && cx.char(i + 1) === 93) {
          const targetEnd = separator < 0 ? i : separator
          children.push(cx.elt('WikilinkTarget', pos + 2, targetEnd))
          if (separator >= 0) children.push(cx.elt('WikilinkAlias', separator + 1, i))
          children.push(cx.elt('WikilinkMark', i, i + 2))
          return cx.addElement(cx.elt('Wikilink', pos, i + 2, children))
        }
      }
      return -1
    },
    before: 'Link',
  }],
}

const WikiEmbedConfig: MarkdownConfig = {
  defineNodes: [
    { name: 'WikiEmbed' },
    { name: 'WikiEmbedMark' },
  ],
  parseInline: [{
    name: 'WikiEmbed',
    parse(cx: InlineContext, next: number, pos: number): number {
      if (next !== 33 || cx.char(pos + 1) !== 91 || cx.char(pos + 2) !== 91) return -1

      const marks: Element[] = [cx.elt('WikiEmbedMark', pos, pos + 3)]

      for (let i = pos + 3; i < cx.end - 1; i++) {
        if (cx.char(i) === 10) break
        if (cx.char(i) === 93 && cx.char(i + 1) === 93) {
          marks.push(cx.elt('WikiEmbedMark', i, i + 2))
          return cx.addElement(cx.elt('WikiEmbed', pos, i + 2, marks))
        }
      }
      return -1
    },
    before: 'Wikilink',
  }],
}

export const wikilinkExtension = [WikilinkConfig, WikiEmbedConfig]
