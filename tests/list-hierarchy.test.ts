import { syntaxTree } from '@codemirror/language'
import { redo, undo, history } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { GFM } from '@lezer/markdown'
import { describe, expect, it } from 'vitest'
import {
  indentListHierarchy,
  listHierarchyTransaction,
  outdentListHierarchy,
} from '../webview/editor/list-hierarchy'

function makeState(
  doc: string,
  selection: number | EditorSelection = 0,
  readOnly = false,
): EditorState {
  return EditorState.create({
    doc,
    selection: typeof selection === 'number' ? { anchor: selection } : selection,
    extensions: [
      markdown({ base: markdownLanguage, extensions: [GFM] }),
      history(),
      EditorState.allowMultipleSelections.of(true),
      EditorState.readOnly.of(readOnly),
    ],
  })
}

function run(
  command: typeof indentListHierarchy,
  state: EditorState,
): { readonly applied: boolean; readonly state: EditorState } {
  let next = state
  const applied = command({
    state,
    dispatch(transaction) { next = transaction.state },
  } as never)
  return { applied, state: next }
}

function parentListItemTexts(state: EditorState): string[] {
  const result: string[] = []
  syntaxTree(state).iterate({
    enter(ref) {
      if (ref.name !== 'ListItem') return
      let parent = ref.node.parent
      while (parent && parent.name !== 'ListItem') parent = parent.parent
      result.push(`${parent ? state.doc.sliceString(parent.from, parent.to).split('\n')[0] : 'ROOT'} -> ${state.doc.sliceString(ref.from, ref.to).split('\n')[0]}`)
    },
  })
  return result
}

describe('list subtree の階層変更', () => {
  it.each([
    {
      name: 'bullet',
      input: '- first\n- second\n  - child\n- third',
      anchor: 10,
      indented: '- first\n  - second\n    - child\n- third',
      shift: 2,
    },
    {
      name: 'ordered',
      input: '1. first\n2. second\n   1. child\n3. third',
      anchor: 12,
      indented: '1. first\n   2. second\n      1. child\n3. third',
      shift: 3,
    },
    {
      name: 'task',
      input: '- [ ] first\n- [x] second\n  - [ ] child\n- [ ] third',
      anchor: 17,
      indented: '- [ ] first\n  - [x] second\n    - [ ] child\n- [ ] third',
      shift: 2,
    },
    {
      name: 'tab-separated bullet',
      input: '-\tfirst\n-\tsecond',
      anchor: 11,
      indented: '-\tfirst\n    -\tsecond',
      shift: 4,
    },
    {
      name: 'tab-separated ordered',
      input: '1.\tfirst\n2.\tsecond',
      anchor: 13,
      indented: '1.\tfirst\n    2.\tsecond',
      shift: 4,
    },
  ])('$name item と子孫を Tab / Shift-Tab で往復する', ({ input, anchor, indented, shift }) => {
    const before = makeState(input, anchor)
    const moved = run(indentListHierarchy, before)
    expect(moved.applied).toBe(true)
    expect(moved.state.doc.toString()).toBe(indented)
    expect(moved.state.selection.main.head).toBe(anchor + shift)
    expect(parentListItemTexts(moved.state)[1]).toContain('first')

    const restored = run(outdentListHierarchy, moved.state)
    expect(restored.applied).toBe(true)
    expect(restored.state.doc.toString()).toBe(input)
    expect(restored.state.selection).toEqual(before.selection)
  })

  it('blockquote と二重引用の prefix を保存する', () => {
    const input = '> - first\n> - second\n>   - child\n> - third\n\n> > - one\n> > - two'
    const selection = EditorSelection.create([
      EditorSelection.cursor(input.indexOf('second')),
      EditorSelection.cursor(input.indexOf('two')),
    ])
    const moved = run(indentListHierarchy, makeState(input, selection))
    expect(moved.applied).toBe(true)
    expect(moved.state.doc.toString()).toBe(
      '> - first\n>   - second\n>     - child\n> - third\n\n> > - one\n> >   - two',
    )
    const restored = run(outdentListHierarchy, moved.state)
    expect(restored.state.doc.toString()).toBe(input)
    expect(restored.state.selection).toEqual(selection)
  })

  it('lazy continuation と空行を subtree と一緒に移動する', () => {
    const input = '- first\n- second\n  lazy continuation\n\n  final\n- third'
    const moved = run(indentListHierarchy, makeState(input, input.indexOf('second')))
    expect(moved.applied).toBe(true)
    expect(moved.state.doc.toString()).toBe(
      '- first\n  - second\n    lazy continuation\n  \n    final\n- third',
    )
    const restored = run(outdentListHierarchy, moved.state)
    expect(restored.applied).toBe(true)
    expect(restored.state.doc.toString()).toBe(input)
  })

  it('連続項目群を一つの変更として移動する', () => {
    const input = '- first\n- second\n  - child\n- third\n- fourth'
    const from = input.indexOf('second')
    const to = input.indexOf('fourth') - 2
    const moved = run(indentListHierarchy, makeState(
      input,
      EditorSelection.range(from, to),
    ))
    expect(moved.state.doc.toString()).toBe(
      '- first\n  - second\n    - child\n  - third\n- fourth',
    )
  })

  it('独立した複数 selection を一つの transaction で移動する', () => {
    const input = '- a\n- b\n\n1. one\n2. two'
    const selection = EditorSelection.create([
      EditorSelection.cursor(input.indexOf('b')),
      EditorSelection.cursor(input.indexOf('two')),
    ])
    const spec = listHierarchyTransaction(makeState(input, selection), 'indent')
    expect(spec).not.toBeNull()
    const moved = makeState(input, selection).update(spec!).state
    expect(moved.doc.toString()).toBe('- a\n  - b\n\n1. one\n   2. two')
    expect(moved.selection.ranges.map(range => range.head)).toEqual([
      input.indexOf('b') + 2,
      input.indexOf('two') + 5,
    ])
  })
})

describe('list hierarchy の原子性と履歴', () => {
  it.each([
    ['先頭項目の Tab', '- first\n- second', 2, indentListHierarchy],
    ['最上位項目の Shift-Tab', '- first\n- second', 10, outdentListHierarchy],
    ['通常段落', 'plain text', 3, indentListHierarchy],
  ] as const)('%s は文書と selection を変更しない', (_name, doc, anchor, command) => {
    const before = makeState(doc, anchor)
    const result = run(command, before)
    expect(result.applied).toBe(false)
    expect(result.state).toBe(before)
  })

  it('一件が移動先不在なら複数 selection 全件を変更しない', () => {
    const input = '- first\n- second\n\n- alpha\n- beta'
    const selection = EditorSelection.create([
      EditorSelection.cursor(input.indexOf('first')),
      EditorSelection.cursor(input.indexOf('beta')),
    ])
    const before = makeState(input, selection)
    const result = run(indentListHierarchy, before)
    expect(result.applied).toBe(false)
    expect(result.state).toBe(before)
  })

  it('重なる複数 selection は全件を変更しない', () => {
    const input = '- first\n- second\n  - child\n- third'
    const selection = EditorSelection.create([
      EditorSelection.cursor(input.indexOf('second')),
      EditorSelection.cursor(input.indexOf('child')),
    ])
    const before = makeState(input, selection)
    expect(run(indentListHierarchy, before).applied).toBe(false)
  })

  it('outdent に必要な空白が一行でも不足すれば全件を変更しない', () => {
    const input = '- parent\n  - child\n lazy continuation'
    const before = makeState(input, input.indexOf('child'))
    expect(run(outdentListHierarchy, before).applied).toBe(false)
  })

  it('read-only state を変更しない', () => {
    const before = makeState('- first\n- second', 10, true)
    expect(run(indentListHierarchy, before).applied).toBe(false)
  })

  it('Undo と Redo が文書と selection を往復する', () => {
    const input = '- first\n- second\n  - child\n- third'
    const before = makeState(input, input.indexOf('second'))
    const moved = run(indentListHierarchy, before).state
    const undone = run(undo as typeof indentListHierarchy, moved).state
    expect(undone.doc.toString()).toBe(input)
    expect(undone.selection).toEqual(before.selection)
    const redone = run(redo as typeof indentListHierarchy, undone).state
    expect(redone.doc.toString()).toBe(moved.doc.toString())
    expect(redone.selection).toEqual(moved.selection)
  })
})
