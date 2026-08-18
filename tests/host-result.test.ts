import { describe, expect, it, vi } from 'vitest'
import type { EditOutcome, HostMessage } from '../src/protocol'
import { handleHostResult } from '../webview/host-result'
import { editResultMessage } from '../src/edit-result'

const failure: Extract<EditOutcome, { ok: false }> = {
  ok: false,
  error: { editId: 'edit-7', target: { kind: 'editing', documentId: 'file:///doc.md' }, sessionGeneration: 0, baseDocumentVersion: 7, kind: 'apply-rejected', reason: 'VS Code rejected the document edit' },
}

describe('document edit failure propagation', () => {
  it('typed failure を webview failure adapter へ配送する', () => {
    const message: HostMessage = { type: 'edit-result', result: failure }
    const sink = vi.fn()
    handleHostResult(message, sink)
    expect(sink).toHaveBeenCalledWith({ title: 'Edit edit-7 failed', detail: 'apply-rejected: VS Code rejected the document edit' })
  })

  it('typed outcome だけを edit-result message として構築する', () => {
    expect(editResultMessage(failure)).toEqual({ type: 'edit-result', result: failure })
  })
})
