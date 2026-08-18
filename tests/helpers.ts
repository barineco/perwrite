import { EditorState } from '@codemirror/state'
import { RangeSet } from '@codemirror/state'
import { Decoration } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { mathExtension } from '../webview/editor/markdown-math-extension'
import { wikilinkExtension } from '../webview/editor/markdown-wikilink-extension'
import { frontmatterExtension } from '../webview/editor/markdown-frontmatter-extension'
import { editorFocused, irDecorationField } from '../webview/editor/ir-state-field'
import { initialViewMode, viewModeField, type ViewMode } from '../webview/editor/view-mode'
import { compositionActiveField } from '../webview/editor/composition-state'
import { irTransactionFilter } from '../webview/editor/ir-transaction-filter'
import { history } from '@codemirror/commands'

// 製品と同じ markdown 拡張構成で編集状態を構築する。装飾フィールドとその依存を含み、
// DOM を要さない状態レベルの検査に用いる。初期モードは既定 render 、引数で切り替える。
export function makeState(doc: string, mode: ViewMode = 'render'): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      markdown({
        base: markdownLanguage,
        extensions: [GFM, ...mathExtension, ...wikilinkExtension, ...frontmatterExtension],
      }),
      history(),
      editorFocused,
      initialViewMode.of(mode),
      viewModeField,
      compositionActiveField,
      irDecorationField,
      irTransactionFilter,
    ],
  })
}

// 提示面が産出した進入禁止範囲を返す。
export function atomicRangesOf(state: EditorState): RangeSet<Decoration> {
  return state.field(irDecorationField).atomicRanges
}

// 位置が進入禁止範囲の内部 ( 端を除く ) に覆われるかを返す。
export function isAtomicallyCovered(atomic: RangeSet<Decoration>, pos: number): boolean {
  let covered = false
  atomic.between(pos, pos, (from, to) => {
    if (pos > from && pos < to) {
      covered = true
      return false
    }
  })
  return covered
}
