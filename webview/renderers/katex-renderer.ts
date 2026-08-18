import katex from 'katex'
import type { Result } from '../../src/protocol'

export interface KaTeXRenderInput {
  readonly source: string
  readonly displayMode: boolean
}

export function renderKaTeX(input: KaTeXRenderInput): Result<string> {
  try {
    return {
      ok: true,
      value: katex.renderToString(input.source, {
        displayMode: input.displayMode,
        throwOnError: true,
      }),
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
