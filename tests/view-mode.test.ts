import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { mathExtension } from '../webview/editor/markdown-math-extension'
import { wikilinkExtension } from '../webview/editor/markdown-wikilink-extension'
import { frontmatterExtension } from '../webview/editor/markdown-frontmatter-extension'
import { decorationOptionsOf } from '../webview/editor/decoration-options'
import { buildIrPresentation, editorFocused, irDecorationField, setEditorFocusedEffect } from '../webview/editor/ir-state-field'
import { irTransactionFilter } from '../webview/editor/ir-transaction-filter'
import {
  cycleViewMode, currentProfile, initialViewMode, profileFor, setViewModeEffect,
  viewModeField, viewModeProfiles, type ViewMode,
} from '../webview/editor/view-mode'

function makeModeState(doc: string, mode: ViewMode): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      markdown({ base: markdownLanguage, extensions: [GFM, ...mathExtension, ...wikilinkExtension, ...frontmatterExtension] }),
      EditorState.allowMultipleSelections.of(true),
      editorFocused,
      initialViewMode.of(mode),
      viewModeField,
      irDecorationField,
      irTransactionFilter,
      EditorState.readOnly.from(viewModeField, value => !profileFor(value).editable),
    ],
  })
}

function decorationSignature(state: EditorState) {
  const result: Array<{ from: number; to: number; className: string | null; widget: boolean }> = []
  const iterator = buildIrPresentation(state).decorations.iter()
  while (iterator.value) {
    const decorationOptions = decorationOptionsOf(iterator.value)
    result.push({
      from: iterator.from,
      to: iterator.to,
      className: decorationOptions.class ?? null,
      widget: decorationOptions.widget !== undefined,
    })
    iterator.next()
  }
  return result
}

function atomicCount(state: EditorState): number {
  const iterator = state.field(irDecorationField).atomicRanges.iter()
  let count = 0
  while (iterator.value) { count++; iterator.next() }
  return count
}

describe('表示プロファイルの正規形', () => {
  it('raw・rich・render の三行を同じ順で宣言する', () => {
    expect(viewModeProfiles).toEqual([
      { mode: 'raw', presentation: 'raw', editable: true },
      { mode: 'rich', presentation: 'rich', editable: true },
      { mode: 'render', presentation: 'render', editable: true },
    ])
    for (const profile of viewModeProfiles) {
      expect(profileFor(profile.mode)).toBe(profile)
      expect(currentProfile(makeModeState('x', profile.mode))).toBe(profile)
    }
  })

  it('三モードがすべて文書変更を受理する', () => {
    for (const mode of ['raw', 'rich', 'render'] as const) {
      const state = makeModeState('hello', mode)
      expect(state.readOnly).toBe(false)
      expect(state.update({ changes: { from: 0, insert: 'X' } }).state.doc.toString()).toBe('Xhello')
    }
  })
})

describe('raw と rich', () => {
  it('raw は装飾と atomic 範囲を構築しない', () => {
    const state = makeModeState('# title\n\na *hi* `code` b', 'raw')
    expect(decorationSignature(state)).toEqual([])
    expect(atomicCount(state)).toBe(0)
  })

  it('rich は記法を含む原文を保存して非置換 style だけを構築する', () => {
    const doc = '# title\n\na *hi* **bold** [link](page.md) `code`'
    const state = makeModeState(doc, 'rich')
    const signature = decorationSignature(state)
    expect(state.doc.toString()).toBe(doc)
    expect(state.doc.lines).toBe(3)
    expect(signature.some(item => item.className?.includes('cm-heading'))).toBe(true)
    expect(signature.some(item => item.className === 'cm-em')).toBe(true)
    expect(signature.some(item => item.className === 'cm-strong')).toBe(true)
    expect(signature.some(item => item.className === 'cm-link')).toBe(true)
    expect(signature.some(item => item.className === 'cm-inline-code')).toBe(true)
    expect(signature.every(item => !item.widget)).toBe(true)
    expect(atomicCount(state)).toBe(0)
  })
})

describe('render の行開示と編集', () => {
  it('選択行を rich 表示へ切り替え、移動後に前の行を再描画する', () => {
    const doc = '# first\n\n## second'
    const base = makeModeState(doc, 'render').update({ effects: setEditorFocusedEffect.of(true) }).state
    const first = base.update({ selection: { anchor: 3 } }).state
    const firstSignature = decorationSignature(first)
    expect(firstSignature.some(item => item.className === 'cm-ir-active' && item.from === 0)).toBe(true)
    expect(firstSignature.some(item => item.from === 0 && item.to > 0 && item.className === null)).toBe(false)

    const second = first.update({ selection: { anchor: doc.indexOf('second') } }).state
    const secondSignature = decorationSignature(second)
    expect(secondSignature.some(item => item.className === 'cm-ir-active' && item.from === 9)).toBe(true)
    expect(secondSignature.some(item => item.from === 0 && item.to > 0 && item.className === null)).toBe(true)
    expect(second.doc.toString()).toBe(doc)
  })

  it('複数 selection と範囲 selection が交差する各行を開示する', () => {
    const doc = '# one\n\n## two\n\n### three'
    const state = makeModeState(doc, 'render').update({
      effects: setEditorFocusedEffect.of(true),
      selection: EditorSelection.create([
        EditorSelection.range(2, 2),
        EditorSelection.range(doc.indexOf('two'), doc.indexOf('three') + 2),
      ], 0),
    }).state
    const activeLines = decorationSignature(state)
      .filter(item => item.className === 'cm-ir-active')
      .map(item => item.from)
    expect(activeLines).toContain(0)
    expect(decorationSignature(state).filter(item => item.className === null)).toEqual([])

    const primaryOnly = makeModeState(doc, 'render').update({
      effects: setEditorFocusedEffect.of(true), selection: { anchor: 2 },
    }).state
    expect(decorationSignature(primaryOnly).filter(item => item.className === null)).toHaveLength(2)
  })

  it('開示した行の編集と再描画で文書と selection を保存する', () => {
    const base = makeModeState('## title\n\ntext', 'render').update({
      effects: setEditorFocusedEffect.of(true), selection: { anchor: 4 },
    }).state
    const edited = base.update({ changes: { from: 4, insert: 'X' } }).state
    expect(edited.doc.toString()).toBe('## tXitle\n\ntext')
    const moved = edited.update({ selection: { anchor: edited.doc.length } }).state
    expect(moved.doc.toString()).toBe(edited.doc.toString())
    expect(moved.selection.main.head).toBe(edited.doc.length)
  })
})

describe('巡回と保存', () => {
  it('raw → rich → render → raw の順で巡回する', () => {
    expect(cycleViewMode('raw')).toBe('rich')
    expect(cycleViewMode('rich')).toBe('render')
    expect(cycleViewMode('render')).toBe('raw')
  })

  it('巡回時に文書と selection を保存する', () => {
    let state = makeModeState('hello world', 'raw').update({ selection: { anchor: 3 } }).state
    for (const mode of ['rich', 'render', 'raw'] as const) {
      state = state.update({ effects: setViewModeEffect.of(mode) }).state
      expect(state.field(viewModeField)).toBe(mode)
      expect(state.doc.toString()).toBe('hello world')
      expect(state.selection.main.head).toBe(3)
    }
  })
})
