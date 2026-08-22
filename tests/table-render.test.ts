import { syntaxTree } from '@codemirror/language'
import { describe, expect, it, vi } from 'vitest'
import { decorationOptionsOf } from '../webview/editor/decoration-options'
import { irDecorationField, setEditorFocusedEffect } from '../webview/editor/ir-state-field'
import { extractTableCells, serializeTableData, TableWidget, type TableInline } from '../webview/editor/table-widget'
import { applyMetrics } from '../webview/appearance'
import { applyTableDomNode, type TableDomAdapter } from '../webview/editor/widget-adapters'
import {
  recordMeasuredHeight,
  tableMeasuredHeightCacheKey,
} from '../webview/widget-height-cache'
import { createFallbackProfile } from '../src/appearance-profile'
import { makeState } from './helpers'

function classes(state: ReturnType<typeof makeState>): string[] {
  const result: string[] = []
  const iterator = state.field(irDecorationField).decorations.iter()
  while (iterator.value) {
    const decorationOptions = decorationOptionsOf(iterator.value)
    if (decorationOptions.class) result.push(decorationOptions.class)
    expect(decorationOptions.widget).toBeUndefined()
    iterator.next()
  }
  return result
}

function kinds(parts: readonly TableInline[]): string[] {
  return parts.flatMap(part => {
    if ('children' in part) return [part.kind, ...kinds(part.children)]
    return [part.kind]
  })
}

describe('GFM Table の Lezer 構文木による描画', () => {
  it('rich と render は非アクティブ Table を同じ TableWidget として導出する', () => {
    const tableSource = ['| A | B |', '|---|---|', '| 1 | 2 |'].join('\n')
    const source = `${tableSource}\n\noutside`
    const widgetNames = (state: ReturnType<typeof makeState>) => {
      const names: string[] = []
      const iterator = state.field(irDecorationField).decorations.iter()
      while (iterator.value) {
        const widget = decorationOptionsOf(iterator.value).widget as { constructor?: { name?: string } } | undefined
        if (widget?.constructor?.name) names.push(widget.constructor.name)
        iterator.next()
      }
      return names
    }

    const rich = makeState(source, 'rich')
    const render = makeState(source, 'render')
    expect(widgetNames(rich)).toContain('TableWidget')
    expect(widgetNames(render)).toContain('TableWidget')
    expect(rich.doc.toString()).toBe(source)
    expect(render.doc.toString()).toBe(source)
  })

  it('rich と render の Table 内 selection は block 全体の Markdown 原文を開示する', () => {
    const tableSource = ['| A | B |', '|---|---|', '| 1 | 2 |'].join('\n')
    const source = `${tableSource}\n\noutside`
    for (const mode of ['rich', 'render'] as const) {
      const base = makeState(source, mode)
      const opened = base.update({
        effects: setEditorFocusedEffect.of(true), selection: { anchor: tableSource.indexOf('1') },
      }).state
      const widgets = opened.field(irDecorationField).decorations.iter()
      const names: string[] = []
      while (widgets.value) {
        const widget = decorationOptionsOf(widgets.value).widget as { constructor?: { name?: string } } | undefined
        if (widget?.constructor?.name) names.push(widget.constructor.name)
        widgets.next()
      }
      expect(names).not.toContain('TableWidget')
      expect(opened.doc.toString()).toBe(source)
      expect(opened.selection.main).toMatchObject({ from: tableSource.indexOf('1'), to: tableSource.indexOf('1') })
    }
  })

  it('行・セルとエスケープ付きパイプを構文木から導出する', () => {
    const source = [
      '| A | B |',
      '|---|---|',
      '| escaped \\| pipe | value |',
    ].join('\n')
    const state = makeState(source)
    const table = syntaxTree(state).topNode.getChild('Table')

    expect(table).not.toBeNull()
    const data = extractTableCells(state, table!)
    expect(data.rows.map(row => row.cells.length)).toEqual([2, 2])
    expect(data.rows.map(row => row.header)).toEqual([true, false])
    expect(data.rows[1].cells[0].inline).toEqual([
      { kind: 'text', text: 'escaped ' },
      { kind: 'text', text: '|' },
      { kind: 'text', text: ' pipe' },
    ])
  })

  it('セル内 inline 表示を製品と同じ構文木から導出する', () => {
    const source = [
      '| Emphasis | Code | Link | Wiki | Math | Image |',
      '|---|---|---|---|---|---|',
      '| *em* | `code` | [label](page.md) | [[Page]] | $x^2$ | ![alt](img.png) |',
    ].join('\n')
    const state = makeState(source)
    state.field(irDecorationField)
    const table = syntaxTree(state).topNode.getChild('Table')
    const row = extractTableCells(state, table!).rows[1]

    expect(row.cells.map(cell => kinds(cell.inline))).toEqual([
      ['emphasis', 'text'], ['code'], ['link', 'text'], ['wikilink'], ['math'], ['image'],
    ])
    expect(row.cells[2].inline).toEqual([
      { kind: 'link', children: [{ kind: 'text', text: 'label' }], url: 'page.md' },
    ])
    expect(row.cells[3].inline).toEqual([
      { kind: 'wikilink', label: 'Page', target: 'Page' },
    ])

    const dom = serializeTableData(extractTableCells(state, table!))
    expect(dom.tag).toBe('table')
    const bodyCells = dom.children?.[1].children ?? []
    expect(bodyCells.map(cell => cell.tag)).toEqual(['td', 'td', 'td', 'td', 'td', 'td'])
    expect(bodyCells[2].children?.[0]).toMatchObject({
      tag: 'a', attributes: { href: 'page.md', class: 'cm-link' },
    })
    expect(bodyCells[4].children?.[0]).toMatchObject({ tag: 'span', mathSource: 'x^2' })
    expect(bodyCells[5].children?.[0]).toMatchObject({
      tag: 'img', attributes: { alt: 'alt', src: 'img.png' },
    })

    type FakeNode = { tag: string; textContent: string; attributes: Record<string, string>; children: FakeNode[]; style: Record<string, string> }
    const element = (tag: string): FakeNode => ({ tag, textContent: '', attributes: {}, children: [], style: {} })
    const adapter: TableDomAdapter = {
      createTextNode(text) { return { ...element('#text'), textContent: text } as unknown as Node },
      createElement(tag) {
        const node = element(tag)
        return Object.assign(node, {
          setAttribute(name: string, value: string) { node.attributes[name] = value },
          appendChild(child: Node) { node.children.push(child as unknown as FakeNode); return child },
        }) as unknown as HTMLElement
      },
      createMathNode(source) { return { ...element('#math'), textContent: source } as unknown as Node },
      createImageNode(source, alt, documentGeneration) {
        return Object.assign(element('img'), {
          textContent: `${source}:${alt}:${documentGeneration}`,
          attributes: { src: `prepared:${source}`, alt },
        }) as unknown as Node
      },
    }
    const applied = applyTableDomNode(dom, adapter) as unknown as FakeNode
    const appliedCells = applied.children[1].children
    expect(applied.tag).toBe('table')
    expect(appliedCells[2].children[0].attributes.href).toBe('page.md')
    expect(appliedCells[4].children[0].children[0]).toMatchObject({ tag: '#math', textContent: 'x^2' })
    expect(appliedCells[5].children[0].attributes.src).toBe('prepared:img.png')
    const widgetDom = new TableWidget(extractTableCells(state, table!), 3, adapter).toDOM() as unknown as FakeNode
    expect(widgetDom.tag).toBe('div')
    expect(widgetDom.children[0].tag).toBe('table')
    expect(widgetDom.children[0].children[1].children[5].children[0].textContent).toBe('img.png:alt:3')
  })

  it('同一 tableData の各 instance は幅と appearance version に対応する測定高を返す', () => {
    type FakeElement = {
      className: string
      clientWidth: number
      parentElement: FakeElement | null
      isConnected: boolean
      children: Node[]
      appendChild(child: Node): Node
      getBoundingClientRect(): DOMRect
      setAttribute(): void
    }
    const tableData = {
      from: 0,
      to: 29,
      rows: [{ header: true, cells: [] }, { header: false, cells: [] }],
    }
    const profileFor = (version: number) => createFallbackProfile('dark', {}, version)
    const applyProfile = (version: number) => {
      const profile = profileFor(version)
      applyMetrics(profile.metrics, profile.version)
      return profile
    }
    const createFixture = (widths: readonly number[], heights: readonly number[]) => {
      const callbacks: ResizeObserverCallback[] = []
      class FixtureResizeObserver {
        constructor(callback: ResizeObserverCallback) { callbacks.push(callback) }
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      }
      vi.stubGlobal('ResizeObserver', FixtureResizeObserver)
      const element = (width = 0, height = 0): FakeElement => {
        const node: FakeElement = {
          className: '', clientWidth: width, parentElement: null, isConnected: true, children: [],
          appendChild(child) { node.children.push(child); return child },
          getBoundingClientRect: () => ({ height } as DOMRect),
          setAttribute() {},
        }
        return node
      }
      let wrapperIndex = 0
      const adapter: TableDomAdapter = {
        createTextNode(text) { return text as unknown as Node },
        createElement(tag) {
          return tag === 'div'
            ? element(widths[wrapperIndex], heights[wrapperIndex++]) as unknown as HTMLElement
            : element() as unknown as HTMLElement
        },
        createMathNode(source) { return source as unknown as Node },
        createImageNode(source) { return source as unknown as Node },
      }
      const wide = new TableWidget(tableData, 0, adapter)
      const narrow = new TableWidget(tableData, 0, adapter)
      wide.toDOM()
      narrow.toDOM()
      return { callbacks, wide, narrow }
    }

    for (const [version, callbackOrder] of [[101, [0, 1]], [102, [1, 0]]] as const) {
      const profile = applyProfile(version)
      const { callbacks, wide, narrow } = createFixture([808, 316], [120, 76])
      const expectedFallback = 2 * profile.metrics.tableRowHeightPx + 2 * profile.metrics.tableWidgetBlockPaddingPx
      expect(callbacks).toHaveLength(2)
      expect(wide.estimatedHeight).toBe(expectedFallback)
      expect(narrow.estimatedHeight).toBe(expectedFallback)

      callbacks[callbackOrder[0]]([], {} as ResizeObserver)
      if (callbackOrder[0] === 0) {
        expect(wide.estimatedHeight).toBe(120)
        expect(narrow.estimatedHeight).toBe(expectedFallback)
      } else {
        expect(wide.estimatedHeight).toBe(expectedFallback)
        expect(narrow.estimatedHeight).toBe(76)
      }
      callbacks[callbackOrder[1]]([], {} as ResizeObserver)
      expect(wide.estimatedHeight).toBe(120)
      expect(narrow.estimatedHeight).toBe(76)
      expect(tableMeasuredHeightCacheKey(tableData, 808)).toMatchObject({
        appearanceVersion: version, widthBucket: { kind: 'WidthDependent', bucket: 12 },
      })
      expect(tableMeasuredHeightCacheKey(tableData, 316)).toMatchObject({
        appearanceVersion: version, widthBucket: { kind: 'WidthDependent', bucket: 4 },
      })

      const nextProfile = applyProfile(version + 1)
      const wideKey = tableMeasuredHeightCacheKey(tableData, 808)
      const narrowKey = tableMeasuredHeightCacheKey(tableData, 316)
      expect(wideKey).toMatchObject({
        appearanceVersion: version + 1, widthBucket: { kind: 'WidthDependent', bucket: 12 },
      })
      expect(narrowKey).toMatchObject({
        appearanceVersion: version + 1, widthBucket: { kind: 'WidthDependent', bucket: 4 },
      })
      expect(recordMeasuredHeight({ cacheKey: wideKey, measuredHeightPx: 130 })).toEqual({ ok: true, value: { cacheKey: wideKey } })
      expect(recordMeasuredHeight({ cacheKey: narrowKey, measuredHeightPx: 82 })).toEqual({ ok: true, value: { cacheKey: narrowKey } })
      expect(wide.estimatedHeight).toBe(130)
      expect(narrow.estimatedHeight).toBe(82)
      expect(nextProfile.version).toBe(version + 1)
      vi.unstubAllGlobals()
    }
  })
})
