import type { Range } from '@codemirror/state'
import { Decoration } from '@codemirror/view'
import { checkboxMarkerNode, type RenderRule } from './render-rules'
import {
  deriveBlockMath,
  deriveCheckboxMarker,
  deriveFencedCode,
  deriveHeading,
  deriveHorizontalRule,
  deriveImage,
  deriveInlineMath,
  deriveLink,
  deriveListMark,
  deriveQuoteMark,
  deriveTable,
  deriveWikilink,
  inlineMarkDeriver,
  type DeriveContext,
  type NodeDeriver,
  type NodeInfo,
} from './ir-display-derivation'

export interface NodeRenderData {
  readonly deriveMaterials: (
    ctx: DeriveContext,
    node: NodeInfo,
    rule: RenderRule,
  ) => Partial<Record<RenderRule['display'], readonly Range<Decoration>[]>>
}

function materialsFor(display: RenderRule['display'], deriver: NodeDeriver): NodeRenderData {
  return {
    deriveMaterials(ctx, node, rule) {
      const ranges: Range<Decoration>[] = []
      deriver({ ...ctx, decorations: ranges }, node, rule)
      return { [display]: ranges }
    },
  }
}

// ノード名から表示導出器への割当。新構文はここに 1 行を足す。
export const nodeRenderData: ReadonlyMap<string, NodeRenderData> = new Map([
  ['Emphasis', materialsFor('mark', inlineMarkDeriver('cm-em', 'EmphasisMark'))],
  ['StrongEmphasis', materialsFor('mark', inlineMarkDeriver('cm-strong', 'EmphasisMark'))],
  ['Strikethrough', materialsFor('mark', inlineMarkDeriver('cm-strikethrough', 'StrikethroughMark'))],
  ['InlineCode', materialsFor('mark', inlineMarkDeriver('cm-inline-code', 'CodeMark'))],
  ['Link', materialsFor('hide', deriveLink)],
  ['Wikilink', materialsFor('hide', deriveWikilink)],
  ['ATXHeading1', materialsFor('hide', deriveHeading)],
  ['ATXHeading2', materialsFor('hide', deriveHeading)],
  ['ATXHeading3', materialsFor('hide', deriveHeading)],
  ['ATXHeading4', materialsFor('hide', deriveHeading)],
  ['ATXHeading5', materialsFor('hide', deriveHeading)],
  ['ATXHeading6', materialsFor('hide', deriveHeading)],
  ['HorizontalRule', materialsFor('hide', deriveHorizontalRule)],
  ['QuoteMark', materialsFor('hide', deriveQuoteMark)],
  ['FencedCode', materialsFor('widget', deriveFencedCode)],
  ['BlockMath', materialsFor('widget', deriveBlockMath)],
  ['InlineMath', materialsFor('widget', deriveInlineMath)],
  ['Image', materialsFor('widget', deriveImage)],
  [checkboxMarkerNode, materialsFor('widget', deriveCheckboxMarker)],
  ['ListMark', materialsFor('widget', deriveListMark)],
  ['Table', materialsFor('widget', deriveTable)],
])
