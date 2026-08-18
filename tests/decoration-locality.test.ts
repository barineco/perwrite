import { describe, expect, it } from 'vitest'
import { getLastDecorationDiagnostic, irDecorationField } from '../webview/editor/ir-state-field'
import { makeState } from './helpers'

describe('局所 Decoration 導出診断', () => {
  it('局所編集の visited range を文書全体から分離し、遠隔 widget key を保存する', () => {
    const remote = '\n\n#### Remote\nremote content\n\n![image](remote.png)'
    const source = `# Title\n\nlocal paragraph\n${remote}`
    const base = makeState(source, 'render')
    base.field(irDecorationField)
    const before = getLastDecorationDiagnostic()
    const localFrom = source.indexOf('local paragraph')
    const next = base.update({ changes: { from: localFrom, to: localFrom + 5, insert: 'LOCAL' } }).state
    next.field(irDecorationField)
    const after = getLastDecorationDiagnostic()
    expect(before.visitedRanges.length).toBeGreaterThan(0)
    expect(after.visitedRanges.length).toBeGreaterThan(0)
    expect(after.visitedRanges.some(range => range.from === 0 && range.to === source.length)).toBe(false)
    expect(after.rebuiltWidgetKeys.length + after.preservedWidgetKeys.length).toBeGreaterThan(0)
  })
})
