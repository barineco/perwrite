import type { WidgetType } from '@codemirror/view'
import type { RenderingProfile } from '../../src/protocol'
import { ShikiCodeBlockWidget } from '../nodes/code-block-node'
import { MermaidWidget } from '../nodes/mermaid-node'

export interface FencedCodeInput {
  readonly lang: string
  readonly code: string
  readonly codeFrom: number
  readonly sourceFrom: number
  readonly sourceTo: number
  readonly getProfile: () => RenderingProfile
}

export type FencedCodeResolver = (input: FencedCodeInput) => WidgetType

export function resolveMermaidFencedCode(input: FencedCodeInput): WidgetType {
  const profile = input.getProfile()
  return new MermaidWidget(input.code, {
    mermaidLayout: profile.mermaidLayout,
    mermaidMaxEdges: profile.mermaidMaxEdges,
    mermaidPanStep: profile.mermaidPanStep,
    mermaidZoomStep: profile.mermaidZoomStep,
  }, input.sourceFrom, input.sourceTo)
}

export function resolveDefaultFencedCode(input: FencedCodeInput): WidgetType {
  return new ShikiCodeBlockWidget(input.code, input.lang, input.codeFrom)
}

// 言語識別子から fenced ブロック描画への割当。新言語はここに 1 エントリを足す。
export const fencedCodeResolverByLang: ReadonlyMap<string, FencedCodeResolver> = new Map([
  ['mermaid', resolveMermaidFencedCode],
])

export function resolveFencedCodeWidget(input: FencedCodeInput): WidgetType {
  const resolver = fencedCodeResolverByLang.get(input.lang) ?? resolveDefaultFencedCode
  return resolver(input)
}
