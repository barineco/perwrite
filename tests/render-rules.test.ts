import { describe, it, expect } from 'vitest'
import {
  checkboxMarkerNode,
  renderRules,
  ruleFor,
  cursorPassThroughOf,
  displayFormOf,
  type DisplayForm,
} from '../webview/editor/render-rules'
import { buildIrPresentation, irDecorationField, isActiveForRule, setEditorFocusedEffect } from '../webview/editor/ir-state-field'
import { decorationOptionsOf } from '../webview/editor/decoration-options'
import { makeState, atomicRangesOf, isAtomicallyCovered } from './helpers'
import { syntaxTree } from '@codemirror/language'

// 宣言テーブルの各行について、表示形とカーソル通過可否が対応する装飾と atomic 範囲へ
// 導出されることを確かめる。

describe('宣言テーブルの整合', () => {
  it('観測済みの全ノード種別を行に持つ', () => {
    const names = renderRules.map(r => r.node)
    const expected = [
      'Emphasis', 'StrongEmphasis', 'Strikethrough', 'InlineCode', 'Link', 'Wikilink',
      'ATXHeading1', 'ATXHeading2', 'ATXHeading3', 'ATXHeading4', 'ATXHeading5', 'ATXHeading6',
      'HorizontalRule', 'QuoteMark', 'FencedCode', 'BlockMath', 'InlineMath', 'Image',
      checkboxMarkerNode, 'ListMark', 'Table',
    ]
    expect(names).toEqual(expected)
  })

  it('ノード種別に重複がない', () => {
    const names = renderRules.map(r => r.node)
    expect(new Set(names).size).toBe(names.length)
  })

  it('ruleFor が各行を引き、導出関数が列値を返す', () => {
    for (const rule of renderRules) {
      const found = ruleFor(rule.node)
      expect(found).toBe(rule)
      expect(cursorPassThroughOf(rule)).toBe(rule.cursorPassThrough)
      expect(displayFormOf(rule)).toBe(rule.display)
    }
  })

  it('InlineCode はカーソル通過可であり、他のインライン mark は通過不可', () => {
    expect(ruleFor('InlineCode')?.cursorPassThrough).toBe(true)
    for (const node of ['Emphasis', 'StrongEmphasis', 'Strikethrough']) {
      expect(ruleFor(node)?.cursorPassThrough).toBe(false)
    }
  })

  it('activeUnit が node と line の判定を分ける', () => {
    const state = makeState('prefix *value* suffix').update({ selection: { anchor: 1 } }).state
    const nodeRule = ruleFor('FencedCode')!
    const lineRule = ruleFor('QuoteMark')!
    expect(isActiveForRule(state, true, 7, 14, nodeRule)).toBe(false)
    expect(isActiveForRule(state, true, 7, 14, lineRule)).toBe(true)
    expect(isActiveForRule(state, false, 7, 14, lineRule)).toBe(false)
  })
})

// 各ノード種別の代表文書。node は syntax tree に現れるノード名、pos はその内部の一点。
interface Case {
  node: string
  doc: string
  form: DisplayForm
  // 非アクティブ表示の decoration が存在する内部位置 ( 通過可否の観測点 )
  innerPos: number
}

const cases: readonly Case[] = [
  { node: 'Emphasis', doc: 'a *hi* b', form: 'mark', innerPos: 4 },
  { node: 'StrongEmphasis', doc: 'a **hi** b', form: 'mark', innerPos: 5 },
  { node: 'Strikethrough', doc: 'a ~~hi~~ b', form: 'mark', innerPos: 5 },
  { node: 'InlineCode', doc: 'a `hi` b', form: 'mark', innerPos: 4 },
  { node: 'Link', doc: 'a [hi](url) b', form: 'hide', innerPos: 8 },
  { node: 'Wikilink', doc: '[[target]]', form: 'hide', innerPos: 1 },
  { node: 'ATXHeading1', doc: '# h', form: 'hide', innerPos: 1 },
  { node: 'ATXHeading2', doc: '## h', form: 'hide', innerPos: 1 },
  { node: 'ATXHeading3', doc: '### h', form: 'hide', innerPos: 1 },
  { node: 'ATXHeading4', doc: '#### h', form: 'hide', innerPos: 1 },
  { node: 'ATXHeading5', doc: '##### h', form: 'hide', innerPos: 1 },
  { node: 'ATXHeading6', doc: '###### h', form: 'hide', innerPos: 1 },
  { node: 'HorizontalRule', doc: 'x\n\n---\n\ny', form: 'hide', innerPos: 4 },
  { node: 'QuoteMark', doc: '> q', form: 'hide', innerPos: 1 },
  { node: 'FencedCode', doc: '```js\ncode\n```', form: 'widget', innerPos: 8 },
  { node: 'BlockMath', doc: '$$\na\n$$', form: 'widget', innerPos: 4 },
  { node: 'InlineMath', doc: 'a $x$ b', form: 'widget', innerPos: 3 },
  { node: 'Image', doc: '![a](s)', form: 'widget', innerPos: 3 },
  { node: checkboxMarkerNode, doc: '- [ ] t', form: 'widget', innerPos: 3 },
  { node: 'ListMark', doc: '- item', form: 'widget', innerPos: 1 },
  { node: 'Table', doc: '| a | b |\n|---|---|\n| 1 | 2 |', form: 'widget', innerPos: 4 },
]

const richClass: Readonly<Record<string, string>> = {
  Emphasis: 'cm-em', StrongEmphasis: 'cm-strong', Strikethrough: 'cm-strikethrough',
  InlineCode: 'cm-inline-code', Link: 'cm-link', Wikilink: 'cm-wikilink',
  ATXHeading1: 'cm-heading-1', ATXHeading2: 'cm-heading-2', ATXHeading3: 'cm-heading-3',
  ATXHeading4: 'cm-heading-4', ATXHeading5: 'cm-heading-5', ATXHeading6: 'cm-heading-6',
  HorizontalRule: 'cm-hr-source', QuoteMark: 'cm-blockquote', FencedCode: 'cm-codeblock-line',
  BlockMath: 'cm-mathblock-line', InlineMath: 'cm-math-source', Image: 'cm-image-source',
  [checkboxMarkerNode]: 'cm-task-source', ListMark: 'cm-list-source', Table: 'cm-table-line',
}

function signature(state: ReturnType<typeof makeState>) {
  const result: Array<{ from: number; to: number; className: string | null; widget: boolean }> = []
  const iterator = buildIrPresentation(state).decorations.iter()
  while (iterator.value) {
    const decorationOptions = decorationOptionsOf(iterator.value)
    result.push({
      from: iterator.from, to: iterator.to,
      className: decorationOptions.class ?? null,
      widget: decorationOptions.widget !== undefined,
    })
    iterator.next()
  }
  return result
}

describe('rich と render の全構文導出', () => {
  for (const example of cases) {
    it(`${example.node} の原文 style と render 開示を同じ範囲から導出する`, () => {
      const isTable = example.node === 'Table'
      const rich = makeState(example.doc, 'rich')
      let nodeRange: { from: number; to: number } | null = null
      syntaxTree(rich).iterate({
        enter(node) {
          if (!nodeRange && node.name === example.node) nodeRange = { from: node.from, to: node.to }
        },
      })
      expect(nodeRange, example.node).not.toBeNull()
      const range = nodeRange!
      expect(rich.doc.toString()).toBe(example.doc)
      const richSignature = signature(rich)
      if (isTable) {
        expect(richSignature.some(item => item.widget)).toBe(true)
        expect(richSignature.some(item => item.className?.includes('cm-table-'))).toBe(false)
      } else {
        expect(richSignature.some(item => item.className?.includes(richClass[example.node]))).toBe(true)
        if (!['ATXHeading', 'HorizontalRule', 'QuoteMark', 'FencedCode', 'BlockMath']
          .some(prefix => example.node.startsWith(prefix))) {
          expect(richSignature).toContainEqual(expect.objectContaining({
            from: range.from, to: range.to, className: richClass[example.node], widget: false,
          }))
        }
        expect(richSignature.every(item => !item.widget)).toBe(true)
      }
      expect(atomicRangesOf(rich).size).toBe(0)

      const selectedRich = makeState(example.doc, 'rich').update({
        effects: setEditorFocusedEffect.of(true),
        selection: { anchor: example.innerPos },
      }).state
      const selectedRender = makeState(example.doc, 'render').update({
        effects: setEditorFocusedEffect.of(true),
        selection: { anchor: example.innerPos },
      }).state
      for (const selected of [selectedRich, selectedRender]) {
        expect(selected.doc.toString()).toBe(example.doc)
        const selectedSignature = signature(selected)
        if (isTable) {
          expect(selectedSignature.every(item => !item.widget)).toBe(true)
          expect(atomicRangesOf(selected).size).toBe(0)
        } else {
          expect(selectedSignature.some(item => item.className?.includes(richClass[example.node]))).toBe(true)
          expect(selectedSignature.every(item => !item.widget)).toBe(true)
          expect(atomicRangesOf(selected).size).toBe(0)
        }
      }
    })
  }
})

describe('表示形とカーソル通過可否の decoration・atomic への導出', () => {
  it('一行の display 変更が対象ノードの decoration 形だけを変える', () => {
    const state = makeState('*hi* and `code`')
    const base = buildIrPresentation(state).decorations
    const emphasis = ruleFor('Emphasis')!
    const mutated = buildIrPresentation(state, node => node === 'Emphasis'
      ? { ...emphasis, display: 'widget' }
      : ruleFor(node)).decorations

    const describeRanges = (set: typeof base, from: number, to: number) => {
      const values: Array<{ from: number; to: number; class?: string; widget: boolean }> = []
      set.between(from, to, (rangeFrom, rangeTo, decoration) => {
        const options = decorationOptionsOf(decoration)
        values.push({ from: rangeFrom, to: rangeTo, class: options.class, widget: Boolean(options.widget) })
      })
      return values
    }

    expect(describeRanges(base, 0, 4).some(value => value.class === 'cm-em')).toBe(true)
    expect(describeRanges(mutated, 0, 4)).toEqual([{ from: 0, to: 4, class: undefined, widget: true }])
    expect(describeRanges(mutated, 9, 15)).toEqual(describeRanges(base, 9, 15))
  })

  for (const mutation of [
    { node: 'Emphasis', from: 'mark', to: 'hide', doc: '*hi* and `code`', targetTo: 4 },
    { node: 'Link', from: 'hide', to: 'mark', doc: '[hi](url) and `code`', targetTo: 9 },
    { node: 'FencedCode', from: 'widget', to: 'hide', doc: '```js\nx\n```\n\n`code`', targetTo: 11 },
  ] as const) {
    it(`${mutation.node} の display を ${mutation.from} から ${mutation.to} へ変えても他ノードへ影響しない`, () => {
      const state = makeState(mutation.doc)
      const base = buildIrPresentation(state).decorations
      const original = ruleFor(mutation.node)!
      const mutated = buildIrPresentation(state, node => node === mutation.node
        ? { ...original, display: mutation.to }
        : ruleFor(node)).decorations
      const describeRanges = (set: typeof base, from: number, to: number) => {
        const values: Array<{ from: number; to: number; class?: string; widget: boolean }> = []
        set.between(from, to, (rangeFrom, rangeTo, decoration) => {
          const options = decorationOptionsOf(decoration)
          values.push({ from: rangeFrom, to: rangeTo, class: options.class, widget: Boolean(options.widget) })
        })
        return values
      }
      const otherFrom = mutation.doc.lastIndexOf('`code`')

      expect(original.display).toBe(mutation.from)
      expect(describeRanges(mutated, 0, mutation.targetTo)).not.toEqual(
        describeRanges(base, 0, mutation.targetTo),
      )
      const target = describeRanges(mutated, 0, mutation.targetTo)
      if (mutation.to === 'mark') {
        expect(target).toEqual([{
          from: 0, to: mutation.targetTo, class: `cm-${mutation.node.toLowerCase()}`, widget: false,
        }])
      } else if (mutation.to === 'hide') {
        expect(target).toEqual([{
          from: 0, to: mutation.targetTo, class: undefined, widget: false,
        }])
      } else {
        expect(target).toEqual([{
          from: 0, to: mutation.targetTo, class: undefined, widget: true,
        }])
      }
      expect(describeRanges(mutated, otherFrom, otherFrom + 6)).toEqual(
        describeRanges(base, otherFrom, otherFrom + 6),
      )
    })
  }

  it('各代表ケースが表示規則の表示形と一致する decoration を生む', () => {
    for (const c of cases) {
      const rule = ruleFor(c.node)
      expect(rule, c.node).toBeDefined()
      expect(rule!.display, c.node).toBe(c.form)

      const state = makeState(c.doc)
      const set = state.field(irDecorationField).decorations
      let hasHide = false
      let hasMark = false
      let hasWidget = false
      const iter = set.iter()
      while (iter.value) {
        const value = decorationOptionsOf(iter.value)
        expect(Object.prototype.hasOwnProperty.call(iter.value.spec, 'passThrough')).toBe(false)
        if (value.widget) hasWidget = true
        else if (value.class && !String(value.class).startsWith('cm-heading') && !String(value.class).startsWith('cm-blockquote') && !String(value.class).includes('-line')) hasMark = true
        else if (!value.class) hasHide = true
        iter.next()
      }
      if (c.form === 'mark') expect(hasMark, `${c.node} mark`).toBe(true)
      if (c.form === 'hide') expect(hasHide, `${c.node} hide`).toBe(true)
      if (c.form === 'widget') expect(hasWidget, `${c.node} widget`).toBe(true)
    }
  })

  it('カーソル通過可否が atomic range の被覆に対応する', () => {
    for (const c of cases) {
      const rule = ruleFor(c.node)!
      const state = makeState(c.doc)
      const atomic = atomicRangesOf(state)
      const covered = isAtomicallyCovered(atomic, c.innerPos)
      // 通過可なら内部は atomic に覆われず、通過不可なら覆われる。
      expect(covered, `${c.node} pass=${rule.cursorPassThrough} pos=${c.innerPos}`).toBe(!rule.cursorPassThrough)
    }
  })

  it('field の atomicRanges が同じ産出の decorations の部分集合として対応する', () => {
    for (const c of cases) {
      const state = makeState(c.doc)
      const decorationRanges: Array<{ from: number; to: number }> = []
      const decorationIter = state.field(irDecorationField).decorations.iter()
      while (decorationIter.value) {
        decorationRanges.push({ from: decorationIter.from, to: decorationIter.to })
        decorationIter.next()
      }
      const atomic = atomicRangesOf(state)
      const atomicIter = atomic.iter()
      let atomicCount = 0
      while (atomicIter.value) {
        atomicCount++
        expect(
          decorationRanges.some(range => range.from === atomicIter.from && range.to === atomicIter.to),
          `${c.node} atomic [${atomicIter.from},${atomicIter.to}) が decorations に対応しない`,
        ).toBe(true)
        atomicIter.next()
      }
      // 通過不可のケースは atomic 範囲が実在し、対応関係の検査に意味がある。
      if (!ruleFor(c.node)!.cursorPassThrough) expect(atomicCount, c.node).toBeGreaterThan(0)
    }
  })
})
