import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { GFM } from '@lezer/markdown'
import { mathExtension } from '../webview/editor/markdown-math-extension'
import { wikilinkExtension } from '../webview/editor/markdown-wikilink-extension'

describe('test 基盤の疎通', () => {
  it('markdown 拡張付きで EditorState を構築し syntax tree を得る', () => {
    const state = EditorState.create({
      doc: '# 見出し\n\n本文の `code` を含む段落',
      extensions: [
        markdown({
          base: markdownLanguage,
          extensions: [GFM, ...mathExtension, ...wikilinkExtension],
        }),
      ],
    })
    const names: string[] = []
    syntaxTree(state).iterate({ enter(n) { names.push(n.name) } })
    expect(names).toContain('ATXHeading1')
    expect(names).toContain('InlineCode')
  })
})
