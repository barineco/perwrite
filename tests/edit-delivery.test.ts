import { describe, expect, it } from 'vitest'
import { ChangeSet } from '@codemirror/state'
import { changeSetToTextChanges } from '../webview/editor/edit-changes'
import { EditDeliveryScheduler, type EditDeliveryClock, type PendingEditDelivery } from '../webview/editor/edit-delivery'

function fakeClock(): EditDeliveryClock & { fire(): void } {
  let next = 0
  const callbacks = new Map<number, () => void>()
  return {
    setTimeout(callback) { const id = next++; callbacks.set(id, callback); return id },
    clearTimeout(handle) { callbacks.delete(handle as number) },
    fire() { const current = [...callbacks.values()]; callbacks.clear(); current.forEach(callback => callback()) },
  }
}

const target = { kind: 'editing' as const, documentId: 'file:///doc.md' }
const hash = (content: string) => content.padEnd(64, 'a').slice(0, 64)
const observation = (editId: string, baseDocumentVersion: number, documentVersion: number) => ({
  request: { editId, target, sessionGeneration: 4, baseDocumentVersion, changes: [] },
  before: { target, sessionGeneration: 4, documentVersion: baseDocumentVersion, content: '', contentHash: hash('before') },
  after: { target, sessionGeneration: 4, documentVersion, content: '', contentHash: hash('after') },
})

describe('検証済み観測待ち編集の継続配送', () => {
  it('queued request の基底版を observation.after.documentVersion から取得する', () => {
    const clock = fakeClock()
    const sent: Array<{ pending: PendingEditDelivery; editId: string }> = []
    const scheduler = new EditDeliveryScheduler((pending, editId) => sent.push({ pending, editId }), () => `edit-${sent.length + 1}`, 300, clock)
    scheduler.schedule(target, 4, 7, '', ChangeSet.of({ from: 0, insert: 'a' }, 0)); clock.fire()
    scheduler.schedule(target, 4, 7, 'a', ChangeSet.of({ from: 1, insert: 'b' }, 1)); clock.fire()
    expect(scheduler.recordObservation(observation('edit-1', 7, 8))).toEqual({ ok: true, kind: 'sent' })
    expect(sent[1].pending.baseDocumentVersion).toBe(8)
    expect(changeSetToTextChanges(sent[1].pending.changes)).toEqual([{ from: 1, to: 1, insert: 'b' }])
    expect(scheduler.recordObservation(observation('edit-2', 8, 9))).toEqual({ ok: true, kind: 'idle' })
  })

  it('一致しない request identity の observation を拒否する', () => {
    const clock = fakeClock()
    const scheduler = new EditDeliveryScheduler(() => {}, () => 'edit-1', 300, clock)
    scheduler.schedule(target, 4, 1, '', ChangeSet.of({ from: 0, insert: 'a' }, 0)); clock.fire()
    const before = scheduler.state
    expect(scheduler.recordObservation(observation('old', 1, 2)).ok).toBe(false)
    expect(scheduler.recordObservation({ ...observation('edit-1', 1, 2), request: { ...observation('edit-1', 1, 2).request, sessionGeneration: 3 } }).ok).toBe(false)
    expect(scheduler.state).toBe(before)
  })

  it('failure 後に queued edit を明示的な recovery として保持する', () => {
    const clock = fakeClock()
    const scheduler = new EditDeliveryScheduler(() => {}, () => 'edit-1', 300, clock)
    scheduler.schedule(target, 4, 1, '', ChangeSet.of({ from: 0, insert: 'a' }, 0)); clock.fire()
    scheduler.schedule(target, 4, 1, 'a', ChangeSet.of({ from: 1, insert: 'b' }, 1)); clock.fire()
    const snapshot = { target, sessionGeneration: 4, documentVersion: 2, content: 'a', contentHash: hash('snapshot') }
    scheduler.recordFailure({ editId: 'edit-1', target, sessionGeneration: 4, baseDocumentVersion: 1, kind: 'base-version-conflict', reason: 'conflict', snapshot })
    expect(scheduler.state.kind).toBe('recovery')
    expect(scheduler.discardRecovery().ok).toBe(true)
  })
})
