import { syntaxTree } from '@codemirror/language'
import { describe, expect, it } from 'vitest'
import { decorationOptionsOf } from '../webview/editor/decoration-options'
import { irDecorationField, setEditorFocusedEffect } from '../webview/editor/ir-state-field'
import { extractTableCells, serializeTableData, TableWidget, type TableInline } from '../webview/editor/table-widget'
import { applyTableDomNode, type TableDomAdapter } from '../webview/editor/widget-adapters'
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
  it('rich は区切り行と全 cell の原文を保存して非置換 style を構築する', () => {
    const source = [
      '| Left | Right | Empty |',
      '|:---|---:|:---:|',
      '| escaped \\| pipe | *value* | |',
    ].join('\n')
    const rich = makeState(source, 'rich')
    const richClasses = classes(rich)

    expect(rich.doc.toString()).toBe(source)
    expect(rich.doc.lines).toBe(3)
    expect(richClasses.filter(value => value.includes('cm-table-line'))).toHaveLength(3)
    expect(richClasses).toContain('cm-table-source-cell')
    expect(richClasses).toContain('cm-table-source-delimiter')

    const changed = rich.update({
      changes: { from: source.length, insert: '\n| new | row | cell |' },
    }).state
    const table = syntaxTree(changed).topNode.getChild('Table')
    expect(extractTableCells(changed, table!).rows).toHaveLength(3)
  })

  it('render は Table 範囲を widget にし、block 開示中の編集後に同じ範囲を再描画する', () => {
    const tableSource = ['| A | B |', '|---|---|', '| 1 | 2 |'].join('\n')
    const source = `${tableSource}\n\noutside`
    const base = makeState(source, 'render')
    const widgetNames = (state: typeof base) => {
      const names: string[] = []
      const iterator = state.field(irDecorationField).decorations.iter()
      while (iterator.value) {
        const widget = decorationOptionsOf(iterator.value).widget as { constructor?: { name?: string } } | undefined
        if (widget?.constructor?.name) names.push(widget.constructor.name)
        iterator.next()
      }
      return names
    }

    expect(widgetNames(base)).toContain('TableWidget')
    const opened = base.update({
      effects: setEditorFocusedEffect.of(true), selection: { anchor: tableSource.indexOf('1') },
    }).state
    expect(widgetNames(opened)).not.toContain('TableWidget')
    expect(classes(opened).some(value => value.includes('cm-table-line'))).toBe(true)

    const edited = opened.update({
      changes: { from: tableSource.indexOf('2'), to: tableSource.indexOf('2') + 1, insert: 'changed' },
    }).state
    const moved = edited.update({ selection: { anchor: edited.doc.length } }).state
    expect(moved.doc.toString()).toContain('| 1 | changed |')
    expect(widgetNames(moved)).toContain('TableWidget')
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
})
