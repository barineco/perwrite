import type { Decoration } from '@codemirror/view'

// CodeMirror 公開の Decoration.spec 属性を自前型へ射影する接点。
export type DecorationOptions = {
  readonly class?: string
  readonly widget?: unknown
  readonly block?: boolean
}

export function decorationOptionsOf(decoration: Decoration): DecorationOptions {
  return decoration.spec as DecorationOptions
}
