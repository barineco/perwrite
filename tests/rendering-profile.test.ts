import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { decorationOptionsOf } from '../webview/editor/decoration-options'
import { buildIrPresentation, editorFocused, irDecorationField } from '../webview/editor/ir-state-field'
import { initialViewMode, viewModeField, type ViewMode } from '../webview/editor/view-mode'
import {
  completeMarkdownTreeField, initialCompleteMarkdownTree, markdownLezerParser,
  reconfigureRendering, renderingProfileField, renderingProfileExtensions,
} from '../webview/editor/rendering-profile'
import { MermaidWidget } from '../webview/nodes/mermaid-node'
import type { RenderingProfile } from '../src/protocol'
import { renderKaTeX } from '../webview/renderers/katex-renderer'

const enabled: RenderingProfile = {
  generation: 0, codeBlockWrap: true, mermaidLayout: 'elk', mermaidMaxEdges: 1024,
  mermaidPanStep: 80, mermaidZoomStep: 1.5, texRendering: true,
}
const disabled: RenderingProfile = { ...enabled, texRendering: false }

const mermaidConfiguration = {
  mermaidLayout: enabled.mermaidLayout,
  mermaidMaxEdges: enabled.mermaidMaxEdges,
  mermaidPanStep: enabled.mermaidPanStep,
  mermaidZoomStep: enabled.mermaidZoomStep,
}

function state(doc: string, mode: ViewMode, rendering = enabled): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      renderingProfileExtensions(rendering),
      initialCompleteMarkdownTree.of(markdownLezerParser(rendering).parse(doc)),
      completeMarkdownTreeField,
      editorFocused,
      initialViewMode.of(mode), viewModeField, irDecorationField,
    ],
  })
}

function nodes(value: EditorState): string[] {
  const result: string[] = []
  const tree = ensureSyntaxTree(value, value.doc.length, 5000) ?? syntaxTree(value)
  tree.iterate({ enter(node) { result.push(node.name) } })
  return result
}

function decorationKinds(value: EditorState) {
  const result: Array<{ className: string | null; widget: string | null }> = []
  const iterator = buildIrPresentation(value).decorations.iter()
  while (iterator.value) {
    const decorationOptions = decorationOptionsOf(iterator.value)
    const widget = decorationOptions.widget as { constructor?: { name?: string } } | undefined
    result.push({
      className: decorationOptions.class ?? null,
      widget: widget?.constructor?.name ?? null,
    })
    iterator.next()
  }
  return result
}

describe('TeX parser と表示プロファイル', () => {
  const source = 'plain $x^2$ text\n\n$$\ny^2\n$$'

  it('有効時は raw・rich・render が同じ構文木を別の表示へ導出する', () => {
    const raw = state(source, 'raw')
    const rich = state(source, 'rich')
    const render = state(source, 'render')
    for (const value of [raw, rich, render]) {
      expect(nodes(value)).toContain('InlineMath')
      expect(nodes(value)).toContain('BlockMath')
      expect(value.doc.toString()).toBe(source)
    }
    expect(decorationKinds(raw)).toEqual([])
    expect(decorationKinds(rich)).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'cm-math-source', widget: null }),
      expect.objectContaining({ className: expect.stringContaining('cm-mathblock'), widget: null }),
    ]))
    expect(decorationKinds(render).map(item => item.widget)).toEqual(expect.arrayContaining([
      'KaTeXInlineWidget', 'KaTeXBlockWidget',
    ]))
  })

  it('無効時は三モードとも TeX ノードと KaTeX widget を構築せず原文を保存する', () => {
    for (const mode of ['raw', 'rich', 'render'] as const) {
      const value = state(source, mode, disabled)
      expect(nodes(value)).not.toContain('InlineMath')
      expect(nodes(value)).not.toContain('BlockMath')
      expect(decorationKinds(value).every(item => !item.widget?.startsWith('KaTeX'))).toBe(true)
      expect(value.doc.toString()).toBe(source)
    }
  })

  it('KaTeX が解釈できない inline・block 数式を置換せず通常テキストとして保存する', () => {
    const templateExpression = '${CAN_FORK_CONTEXT?`When using the ${AGENT_TOOL_NAME} tool`:`Use ${AGENT_TOOL_NAME}`}'
    const invalidBlock = '$$\n\\badcommand{\n$$'
    const sourceWithFailures = `${templateExpression}\n\n${invalidBlock}`
    const value = state(sourceWithFailures, 'render')

    expect(nodes(value)).toContain('InlineMath')
    expect(nodes(value)).toContain('BlockMath')
    expect(decorationKinds(value).every(item => !item.widget?.startsWith('KaTeX'))).toBe(true)
    expect(value.doc.toString()).toBe(sourceWithFailures)
  })

  it('切替順序に依存せず文書・selection・mode を保存する', () => {
    const base = state(source, 'render').update({
      selection: { anchor: 7 },
    }).state
    const off = base.update({ effects: reconfigureRendering(disabled) }).state
    const on = off.update({ effects: reconfigureRendering(enabled) }).state
    const direct = base.update({ effects: reconfigureRendering(enabled) }).state

    expect(nodes(off)).not.toContain('InlineMath')
    expect(nodes(on)).toContain('InlineMath')
    expect(decorationKinds(on)).toEqual(decorationKinds(direct))
    expect(on.doc.toString()).toBe(source)
    expect(on.selection.main.head).toBe(7)
    expect(on.field(viewModeField)).toBe('render')
    expect(on.field(renderingProfileField)).toEqual(enabled)
  })
})

describe('renderer の失敗型', () => {
  it('KaTeX の不正入力を理由を持つ Result に変換する', () => {
    const result = renderKaTeX({ source: '\\badcommand{', displayMode: false })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0)
  })
})

describe('Mermaid 配置方式', () => {
  it('配置方式を widget identity の入力に含める', () => {
    expect(new MermaidWidget('graph TD; A-->B', mermaidConfiguration).eq(new MermaidWidget('graph TD; A-->B', mermaidConfiguration))).toBe(true)
    expect(new MermaidWidget('graph TD; A-->B', mermaidConfiguration).eq(new MermaidWidget('graph TD; A-->B', { ...mermaidConfiguration, mermaidLayout: 'dagre' }))).toBe(false)
  })
})
