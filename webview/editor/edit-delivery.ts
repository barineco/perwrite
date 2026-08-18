import { ChangeSet, Text } from '@codemirror/state'
import type { HostDocumentObservation, EditDeliveryTarget, EditFailure, VerifiedEditObservation } from '../../src/protocol'

export type { EditDeliveryTarget } from '../../src/protocol'

export interface PendingEditDelivery {
  readonly target: EditDeliveryTarget
  readonly sessionGeneration: number
  readonly baseDocumentVersion: number
  readonly baseContent: string
  readonly changes: ChangeSet
}

export interface InFlightEditDelivery extends PendingEditDelivery {
  readonly editId: string
  readonly afterContent: string
}

interface QueuedDelivery {
  readonly target: EditDeliveryTarget
  readonly sessionGeneration: number
  readonly baseContent: string
  readonly changes: ChangeSet
  readonly debounceComplete: boolean
  readonly observedDocumentVersion?: number
}

export interface QueuedEditRecovery {
  readonly target: EditDeliveryTarget
  readonly sessionGeneration: number
  readonly changes: ChangeSet
  readonly failure: EditFailure
  readonly snapshot?: HostDocumentObservation
  readonly baseContent: string
  readonly afterInFlightContent: string
}

export type EditDeliveryState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'inFlight'; readonly inFlight: InFlightEditDelivery }
  | { readonly kind: 'queuedAfterFlight'; readonly inFlight: InFlightEditDelivery; readonly queued: QueuedDelivery }
  | { readonly kind: 'recovery'; readonly recovery: QueuedEditRecovery }

export interface EditDeliveryClock {
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

export type DeliveryResult =
  | { readonly ok: true; readonly kind: 'accepted' | 'sent' | 'idle' | 'recovered' | 'discarded' }
  | { readonly ok: false; readonly kind: 'stale-result' | 'target-changed' | 'recovery-required'; readonly reason: string }

const browserClock: EditDeliveryClock = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export function sameTarget(left: EditDeliveryTarget, right: EditDeliveryTarget): boolean {
  return left.kind === right.kind && left.documentId === right.documentId &&
    (left.kind === 'editing' || (right.kind === 'comparison' && left.side === right.side))
}

export function queueEditDelivery(
  pending: PendingEditDelivery | null,
  target: EditDeliveryTarget,
  baseDocumentVersion: number,
  changes: ChangeSet,
  sessionGeneration = 0,
  baseContent = '',
): PendingEditDelivery {
  if (pending === null || !sameTarget(pending.target, target) || pending.sessionGeneration !== sessionGeneration) {
    return { target, sessionGeneration, baseDocumentVersion, baseContent, changes }
  }
  return { ...pending, changes: pending.changes.compose(changes) }
}

function observationMatches(inFlight: InFlightEditDelivery, observation: VerifiedEditObservation): boolean {
  const { request } = observation
  return inFlight.editId === request.editId && sameTarget(inFlight.target, request.target) &&
    inFlight.sessionGeneration === request.sessionGeneration &&
    inFlight.baseDocumentVersion === request.baseDocumentVersion
}

function failureMatches(inFlight: InFlightEditDelivery, failure: EditFailure): boolean {
  return inFlight.editId === failure.editId && sameTarget(inFlight.target, failure.target) &&
    inFlight.sessionGeneration === failure.sessionGeneration &&
    inFlight.baseDocumentVersion === failure.baseDocumentVersion
}

function singleChangedRange(before: string, after: string): { from: number; to: number; insert: string } {
  let prefix = 0
  const minimum = Math.min(before.length, after.length)
  while (prefix < minimum && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (suffix < minimum - prefix && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++
  return { from: prefix, to: before.length - suffix, insert: after.slice(prefix, after.length - suffix) }
}

function applyChanges(content: string, changes: ChangeSet): string {
  return changes.apply(Text.of(content.split('\n'))).toString()
}

function rangesOverlap(left: { from: number; to: number }, right: { from: number; to: number }): boolean {
  if (left.from === left.to) return left.from >= right.from && left.from <= right.to
  if (right.from === right.to) return right.from >= left.from && right.from <= left.to
  return left.from < right.to && right.from < left.to
}

export class EditDeliveryScheduler {
  private stateValue: EditDeliveryState = { kind: 'idle' }
  private draft: PendingEditDelivery | null = null
  private timer: unknown = null
  private lastCancelReason: string | null = null

  constructor(
    private readonly send: (pending: PendingEditDelivery, editId: string) => void,
    private readonly nextEditId: () => string,
    private readonly delayMs = 300,
    private readonly clock: EditDeliveryClock = browserClock,
  ) {}

  get state(): EditDeliveryState { return this.stateValue }
  get cancelReason(): string | null { return this.lastCancelReason }

  schedule(target: EditDeliveryTarget, sessionGeneration: number, baseDocumentVersion: number, baseContent: string, changes: ChangeSet): DeliveryResult {
    if (this.stateValue.kind === 'recovery') return { ok: false, kind: 'recovery-required', reason: 'Queued edit recovery requires an explicit retry or discard' }
    if (this.stateValue.kind === 'idle') {
      this.draft = queueEditDelivery(this.draft, target, baseDocumentVersion, changes, sessionGeneration, baseContent)
      this.restartTimer(() => this.sendDraft())
      return { ok: true, kind: 'accepted' }
    }

    const inFlight = this.stateValue.inFlight
    if (!sameTarget(inFlight.target, target) || inFlight.sessionGeneration !== sessionGeneration) {
      this.cancel('target or session generation changed')
      this.draft = { target, sessionGeneration, baseDocumentVersion, baseContent, changes }
      this.restartTimer(() => this.sendDraft())
      return { ok: false, kind: 'target-changed', reason: 'Previous delivery was cancelled for a new target' }
    }

    const queued = this.stateValue.kind === 'queuedAfterFlight'
      ? { ...this.stateValue.queued, changes: this.stateValue.queued.changes.compose(changes), debounceComplete: false }
      : { target, sessionGeneration, baseContent, changes, debounceComplete: false }
    this.stateValue = { kind: 'queuedAfterFlight', inFlight, queued }
    this.restartTimer(() => this.completeQueuedDebounce())
    return { ok: true, kind: 'accepted' }
  }

  recordObservation(observation: VerifiedEditObservation): DeliveryResult {
    if (this.stateValue.kind !== 'inFlight' && this.stateValue.kind !== 'queuedAfterFlight') return { ok: false, kind: 'stale-result', reason: 'No matching in-flight edit' }
    const { inFlight } = this.stateValue
    if (!observationMatches(inFlight, observation)) return { ok: false, kind: 'stale-result', reason: 'Observation identity does not match the in-flight edit' }
    if (this.stateValue.kind === 'inFlight') {
      this.stateValue = { kind: 'idle' }
      return { ok: true, kind: 'idle' }
    }
    const queued = { ...this.stateValue.queued, observedDocumentVersion: observation.after.documentVersion }
    this.stateValue = { kind: 'queuedAfterFlight', inFlight, queued }
    if (queued.debounceComplete) this.sendQueued()
    return { ok: true, kind: queued.debounceComplete ? 'sent' : 'accepted' }
  }

  recordFailure(failure: EditFailure): DeliveryResult {
    if (this.stateValue.kind !== 'inFlight' && this.stateValue.kind !== 'queuedAfterFlight') return { ok: false, kind: 'stale-result', reason: 'No matching in-flight edit' }
    const { inFlight } = this.stateValue
    if (!failureMatches(inFlight, failure)) return { ok: false, kind: 'stale-result', reason: 'Failure identity does not match the in-flight edit' }
    if (this.timer !== null) this.clock.clearTimeout(this.timer)
    this.timer = null
    if (this.stateValue.kind === 'inFlight') {
      this.stateValue = { kind: 'idle' }
      return { ok: true, kind: 'idle' }
    }
    this.stateValue = { kind: 'recovery', recovery: {
      target: inFlight.target, sessionGeneration: inFlight.sessionGeneration,
      changes: this.stateValue.queued.changes, failure, snapshot: failure.snapshot,
      baseContent: inFlight.baseContent, afterInFlightContent: inFlight.afterContent,
    } }
    return { ok: false, kind: 'recovery-required', reason: failure.reason }
  }

  retryRecovery(snapshot?: HostDocumentObservation): DeliveryResult {
    if (this.stateValue.kind !== 'recovery') return { ok: false, kind: 'recovery-required', reason: 'No queued edit recovery exists' }
    const recovery = this.stateValue.recovery
    const current = snapshot ?? recovery.snapshot
    if (!current || !sameTarget(current.target, recovery.target) || current.sessionGeneration !== recovery.sessionGeneration) {
      return { ok: false, kind: 'recovery-required', reason: 'A matching conflict snapshot is required' }
    }
    let changes: ChangeSet
    if (current.content === recovery.afterInFlightContent) {
      changes = recovery.changes
    } else if (current.content === recovery.baseContent) {
      const sentChanges = ChangeSet.of(singleChangedRange(recovery.baseContent, recovery.afterInFlightContent), recovery.baseContent.length)
      changes = sentChanges.compose(recovery.changes)
    } else {
      const externalRange = singleChangedRange(recovery.baseContent, current.content)
      const sentChanges = ChangeSet.of(singleChangedRange(recovery.baseContent, recovery.afterInFlightContent), recovery.baseContent.length)
      const combined = sentChanges.compose(recovery.changes)
      const userRange = singleChangedRange(recovery.baseContent, applyChanges(recovery.baseContent, combined))
      if (rangesOverlap(externalRange, userRange)) return { ok: false, kind: 'recovery-required', reason: 'External content overlaps the queued edit' }
      const externalChanges = ChangeSet.of(externalRange, recovery.baseContent.length)
      changes = combined.map(externalChanges)
    }
    this.stateValue = { kind: 'idle' }
    this.draft = { target: recovery.target, sessionGeneration: recovery.sessionGeneration, baseDocumentVersion: current.documentVersion, baseContent: current.content, changes }
    this.sendDraft()
    return { ok: true, kind: 'recovered' }
  }

  discardRecovery(reason = 'Discarded by user'): DeliveryResult {
    if (this.stateValue.kind !== 'recovery') return { ok: false, kind: 'recovery-required', reason: 'No queued edit recovery exists' }
    this.stateValue = { kind: 'idle' }
    this.lastCancelReason = reason
    return { ok: true, kind: 'discarded' }
  }

  cancel(reason = 'cancelled'): DeliveryResult {
    if (this.timer !== null) this.clock.clearTimeout(this.timer)
    this.timer = null
    this.draft = null
    this.stateValue = { kind: 'idle' }
    this.lastCancelReason = reason
    return { ok: true, kind: 'discarded' }
  }

  private restartTimer(callback: () => void): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer)
    this.timer = this.clock.setTimeout(callback, this.delayMs)
  }

  private sendDraft(): void {
    const pending = this.draft
    this.draft = null
    this.timer = null
    if (!pending) return
    const editId = this.nextEditId()
    const inFlight: InFlightEditDelivery = { ...pending, editId, afterContent: applyChanges(pending.baseContent, pending.changes) }
    this.stateValue = { kind: 'inFlight', inFlight }
    this.send(pending, editId)
  }

  private completeQueuedDebounce(): void {
    this.timer = null
    if (this.stateValue.kind !== 'queuedAfterFlight') return
    this.stateValue = { ...this.stateValue, queued: { ...this.stateValue.queued, debounceComplete: true } }
    if (this.stateValue.queued.observedDocumentVersion !== undefined) this.sendQueued()
  }

  private sendQueued(): void {
    if (this.stateValue.kind !== 'queuedAfterFlight' || this.stateValue.queued.observedDocumentVersion === undefined) return
    const queued = this.stateValue.queued
    const observedDocumentVersion = queued.observedDocumentVersion!
    this.draft = { target: queued.target, sessionGeneration: queued.sessionGeneration, baseDocumentVersion: observedDocumentVersion, baseContent: queued.baseContent, changes: queued.changes }
    this.stateValue = { kind: 'idle' }
    this.sendDraft()
  }
}
