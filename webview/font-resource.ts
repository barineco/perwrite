import type { Result } from '../src/protocol'

export interface PreparedFontResources {
  readonly generation: number
}

interface FontResourceState {
  readonly generation: number
  readonly promise: Promise<Result<PreparedFontResources>>
}

let currentState: FontResourceState = {
  generation: 0,
  promise: Promise.resolve({ ok: true, value: { generation: 0 } }),
}

function failure(reason: string): Result<PreparedFontResources> {
  return { ok: false, error: reason }
}

export function getFontResourceGeneration(): number {
  return currentState.generation
}

export function beginFontResourcePreparation(): number {
  const generation = currentState.generation + 1
  const promise = typeof document === 'undefined' || !document.fonts
    ? Promise.resolve({ ok: true as const, value: { generation } })
    : Promise.resolve(document.fonts.ready)
      .then(() => ({ ok: true as const, value: { generation } }))
      .catch(error => failure(`Font resource preparation failed: ${error instanceof Error ? error.message : String(error)}`))
  currentState = { generation, promise }
  return generation
}

export async function prepareFontResources(generation: number): Promise<Result<PreparedFontResources>> {
  const state = currentState
  if (state.generation !== generation) return failure(`Font resource generation ${generation} is not current`)
  const result = await state.promise
  if (currentState.generation !== generation) return failure(`Font resource generation ${generation} is not current`)
  return result
}
