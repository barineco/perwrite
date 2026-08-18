import { describe, expect, it, vi } from 'vitest'
import { createFallbackProfile } from '../src/appearance-profile'
import { resolutionFailureDisplay } from '../webview/appearance'

vi.mock('vscode', () => ({ workspace: {}, extensions: { all: [] } }))

const fallback = createFallbackProfile('dark')

describe('appearance failure propagation', () => {
  it('derives visible failure content from a resolution failure', () => {
    expect(resolutionFailureDisplay({
      ok: false, error: 'Theme file could not be parsed', fallback,
    })).toEqual({
      title: 'Appearance rendering unavailable', detail: 'Theme file could not be parsed',
    })
  })

  it('surfaces a token-color notice separately from rendering failure', () => {
    expect(resolutionFailureDisplay({
      ok: true, profile: fallback, notice: 'Syntax theme colors unavailable: active theme read failed',
    })).toEqual({
      title: 'Syntax colors use built-in palette',
      detail: 'Syntax theme colors unavailable: active theme read failed',
    })
  })

  it('derives no failure content from a clean success', () => {
    expect(resolutionFailureDisplay({ ok: true, profile: fallback })).toBeNull()
  })
})
