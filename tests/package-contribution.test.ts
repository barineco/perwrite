import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('package contribution と API proposal', () => {
  it('scm/historyItem/context 貢献があるとき contribSourceControlHistoryItemMenu を宣言する', () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      enabledApiProposals?: string[]
      contributes?: { menus?: Record<string, unknown[]> }
    }
    const historyMenus = manifest.contributes?.menus?.['scm/historyItem/context'] ?? []
    expect(historyMenus.length).toBeGreaterThan(0)
    expect(manifest.enabledApiProposals ?? []).toContain('contribSourceControlHistoryItemMenu')
    expect(manifest.enabledApiProposals ?? []).toContain('customEditorDiffs')
  })
})
