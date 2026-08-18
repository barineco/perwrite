export type DisplayForm = 'mark' | 'hide' | 'widget'

export type ActiveUnit = 'node' | 'line'

export interface RenderRule {
  readonly node: string
  readonly display: DisplayForm
  readonly activeUnit: ActiveUnit
  readonly cursorPassThrough: boolean
}

export const checkboxMarkerNode = 'TaskMarker'

export const renderRules: readonly RenderRule[] = [
  { node: 'Emphasis', display: 'mark', activeUnit: 'line', cursorPassThrough: false },
  { node: 'StrongEmphasis', display: 'mark', activeUnit: 'line', cursorPassThrough: false },
  { node: 'Strikethrough', display: 'mark', activeUnit: 'line', cursorPassThrough: false },
  { node: 'InlineCode', display: 'mark', activeUnit: 'line', cursorPassThrough: true },
  { node: 'Link', display: 'hide', activeUnit: 'line', cursorPassThrough: false },
  { node: 'Wikilink', display: 'hide', activeUnit: 'line', cursorPassThrough: false },
  { node: 'ATXHeading1', display: 'hide', activeUnit: 'line', cursorPassThrough: false },
  { node: 'ATXHeading2', display: 'hide', activeUnit: 'line', cursorPassThrough: false },
  { node: 'ATXHeading3', display: 'hide', activeUnit: 'line', cursorPassThrough: false },
  { node: 'ATXHeading4', display: 'hide', activeUnit: 'line', cursorPassThrough: false },
  { node: 'ATXHeading5', display: 'hide', activeUnit: 'line', cursorPassThrough: false },
  { node: 'ATXHeading6', display: 'hide', activeUnit: 'line', cursorPassThrough: false },
  { node: 'HorizontalRule', display: 'hide', activeUnit: 'line', cursorPassThrough: false },
  { node: 'QuoteMark', display: 'hide', activeUnit: 'line', cursorPassThrough: false },
  { node: 'FencedCode', display: 'widget', activeUnit: 'node', cursorPassThrough: true },
  { node: 'BlockMath', display: 'widget', activeUnit: 'node', cursorPassThrough: true },
  { node: 'InlineMath', display: 'widget', activeUnit: 'line', cursorPassThrough: false },
  { node: 'Image', display: 'widget', activeUnit: 'line', cursorPassThrough: false },
  { node: checkboxMarkerNode, display: 'widget', activeUnit: 'line', cursorPassThrough: false },
  { node: 'ListMark', display: 'widget', activeUnit: 'line', cursorPassThrough: false },
  { node: 'Table', display: 'widget', activeUnit: 'node', cursorPassThrough: true },
]

const ruleByNode: ReadonlyMap<string, RenderRule> = new Map(
  renderRules.map(rule => [rule.node, rule]),
)

export function ruleFor(node: string): RenderRule | undefined {
  return ruleByNode.get(node)
}

export function cursorPassThroughOf(rule: RenderRule): boolean {
  return rule.cursorPassThrough
}

export function displayFormOf(rule: RenderRule): DisplayForm {
  return rule.display
}
