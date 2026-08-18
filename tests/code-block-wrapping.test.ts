import { describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import {
  codeBlockWrapState,
  codeBlockWrappingExtensions,
  reconfigureCodeBlockWrapping,
  resolveCodePoint,
} from '../webview/editor/code-block-wrapping'
import type { RenderingProfile } from '../src/protocol'

const enabled: RenderingProfile = {
  generation: 1, codeBlockWrap: true, mermaidLayout: 'elk', mermaidMaxEdges: 1024,
  mermaidPanStep: 80, mermaidZoomStep: 1.5, texRendering: true,
}

describe('code block wrapping state', () => {
  it('generation と有効値を文書 transaction なしで更新する', () => {
    const initial = EditorState.create({ doc: '```\nlong\n```', extensions: codeBlockWrappingExtensions(enabled, vi.fn()) })
    const nextProfile = { ...enabled, generation: 2, codeBlockWrap: false }
    const transaction = initial.update({ effects: reconfigureCodeBlockWrapping(nextProfile) })
    expect(transaction.docChanged).toBe(false)
    expect(transaction.state.doc.toString()).toBe(initial.doc.toString())
    expect(transaction.state.field(codeBlockWrapState)).toEqual({ generation: 2, enabled: false })
  })
})

describe('code DOM point resolution', () => {
  function codeDom(textContent: string) {
    const text = { nodeType: 3, textContent }
    let end = 0
    const code = {
      ownerDocument: {
        createRange: () => ({
          selectNodeContents() {},
          setEnd(_node: unknown, offset: number) { end = offset },
          toString: () => textContent.slice(0, end),
        }),
      },
      getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 20, width: 100, height: 20 }),
      contains: (node: unknown) => node === text,
    }
    return { code: code as unknown as HTMLElement, text: text as unknown as Node }
  }

  it('text node の UTF-16 offset を返す', () => {
    const { code, text } = codeDom('a😀b')
    const result = resolveCodePoint(code, 1, 1, 4, () => ({ node: text, offset: 3 }))
    expect(result).toEqual({ ok: true, value: 3 })
  })

  it('surrogate pair の途中と DOM 外を理由へ変換する', () => {
    const { code, text } = codeDom('a😀b')
    expect(resolveCodePoint(code, 1, 1, 4, () => ({ node: text, offset: 2 }))).toEqual({
      ok: false, error: 'Code point resolves inside a UTF-16 surrogate pair',
    })
    expect(resolveCodePoint(code, 1, 1, 4, () => null)).toEqual({
      ok: false, error: 'Code point is outside the code block DOM',
    })
  })
})
