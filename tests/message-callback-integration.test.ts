import { ChangeSet } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import type { WebviewMessage } from '../src/protocol'
import { EditDeliveryScheduler, type EditDeliveryClock } from '../webview/editor/edit-delivery'
import { decodeWebviewMessage } from '../src/message-validation'

function controlledClock() {
  let callback: (() => void) | null = null
  const clock: EditDeliveryClock = {
    setTimeout(next) { callback = next; return next },
    clearTimeout() { callback = null },
  }
  return { clock, flush() { const next = callback; callback = null; next?.() } }
}

describe('EditDeliveryScheduler から callback decoder への接続', () => {
  it('malformed callback は decoder failure になる', () => {
    const decoded = decodeWebviewMessage({
      type: 'edit', editId: 'edit', target: { kind: 'editing', documentId: 'file:///doc.md' },
      sessionGeneration: 0, baseDocumentVersion: 1, changes: [], extra: true,
    })
    expect(decoded.ok).toBe(false)
  })

  it('scheduler が生成した共通 protocol edit を decoder が同じ identity として受理する', () => {
    const control = controlledClock()
    let outbound: WebviewMessage | null = null
    const scheduler = new EditDeliveryScheduler((pending, editId) => {
      outbound = {
        type: 'edit', editId, target: pending.target, sessionGeneration: pending.sessionGeneration,
        baseDocumentVersion: pending.baseDocumentVersion,
        changes: [{ from: 0, to: 0, insert: 'x' }],
      }
    }, () => 'session:0:1', 300, control.clock)

    scheduler.schedule(
      { kind: 'editing', documentId: 'file:///doc.md' }, 0, 1, '', ChangeSet.of({ from: 0, insert: 'x' }, 0),
    )
    control.flush()

    const decoded = decodeWebviewMessage(outbound)
    expect(decoded).toEqual({ ok: true, value: {
      type: 'edit', editId: 'session:0:1', target: { kind: 'editing', documentId: 'file:///doc.md' },
      sessionGeneration: 0, baseDocumentVersion: 1, changes: [{ from: 0, to: 0, insert: 'x' }],
    } })
  })
})
