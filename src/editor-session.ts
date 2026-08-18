import {
  type HostDocumentObservation,
  type EditFailure,
  type EditId,
  type EditRequest,
  type EditDeliveryTarget,
  type VerifiedEditObservation,
  validateEditRequest,
  contentHash,
} from './protocol'

export interface EditorSessionState {
  readonly snapshot: HostDocumentObservation
  readonly lifecycle: 'active' | 'disposed'
  readonly pending: ReadonlyMap<EditId, EditRequest>
}

export type EditorSessionEvent =
  | { readonly type: 'request-edit'; readonly request: EditRequest }
  | { readonly type: 'verified-observation'; readonly observation: VerifiedEditObservation }
  | { readonly type: 'failure'; readonly failure: EditFailure }
  | { readonly type: 'host-document-observation'; readonly observation: HostDocumentObservation }
  | { readonly type: 'dispose' }

export type EditorSessionEffect =
  | { readonly type: 'apply-edit'; readonly request: EditRequest }
  | { readonly type: 'send-success'; readonly observation: VerifiedEditObservation }
  | { readonly type: 'send-failure'; readonly failure: EditFailure }
  | { readonly type: 'accepted-host-document-observation'; readonly observation: HostDocumentObservation }

export interface EditorSessionTransition { readonly state: EditorSessionState; readonly effects: readonly EditorSessionEffect[] }

export function createEditorSession(target: EditDeliveryTarget, sessionGeneration: number, content: string, documentVersion: number, contentHashValue: string): EditorSessionState {
  return { snapshot: { target, sessionGeneration, content, documentVersion, contentHash: contentHashValue }, lifecycle: 'active', pending: new Map() }
}

function sameTarget(left: EditDeliveryTarget, right: EditDeliveryTarget): boolean {
  return left.kind === right.kind && left.documentId === right.documentId && (left.kind === 'editing' || (right.kind === 'comparison' && left.side === right.side))
}
function sameRequest(left: EditRequest, right: Pick<EditRequest, 'editId' | 'target' | 'sessionGeneration' | 'baseDocumentVersion'>): boolean {
  return left.editId === right.editId && sameTarget(left.target, right.target) && left.sessionGeneration === right.sessionGeneration && left.baseDocumentVersion === right.baseDocumentVersion
}
function withPending(state: EditorSessionState, pending: ReadonlyMap<EditId, EditRequest>): EditorSessionState { return { ...state, pending } }
function contentAfterRequest(content: string, request: EditRequest): string {
  let cursor = 0
  let result = ''
  for (const change of request.changes) {
    result += content.slice(cursor, change.from) + change.insert
    cursor = change.to
  }
  return result + content.slice(cursor)
}
function conflictFailure(state: EditorSessionState, request: EditRequest): EditFailure {
  return { editId: request.editId, target: request.target, sessionGeneration: request.sessionGeneration, baseDocumentVersion: request.baseDocumentVersion, kind: 'base-version-conflict', reason: `Base version ${request.baseDocumentVersion} does not match current version ${state.snapshot.documentVersion}`, currentDocumentVersion: state.snapshot.documentVersion, snapshot: state.snapshot }
}
function acceptObservation(state: EditorSessionState, observation: HostDocumentObservation): EditorSessionTransition {
  if (!sameTarget(observation.target, state.snapshot.target) || observation.sessionGeneration !== state.snapshot.sessionGeneration || observation.contentHash !== contentHash(observation.content) || observation.documentVersion <= state.snapshot.documentVersion) return { state, effects: [] }
  const pending = new Map(state.pending)
  for (const [editId, request] of pending) if (sameTarget(request.target, observation.target) && request.sessionGeneration === observation.sessionGeneration && observation.content === contentAfterRequest(state.snapshot.content, request)) pending.delete(editId)
  return { state: { ...state, snapshot: observation, pending }, effects: [{ type: 'accepted-host-document-observation', observation }] }
}

export function transitionEditorSession(state: EditorSessionState, event: EditorSessionEvent): EditorSessionTransition {
  if (event.type === 'dispose') return { state: { ...state, lifecycle: 'disposed' }, effects: [] }
  if (state.lifecycle === 'disposed') return { state, effects: [] }
  if (event.type === 'request-edit') {
    const { request } = event
    if (!sameTarget(request.target, state.snapshot.target) || request.sessionGeneration !== state.snapshot.sessionGeneration) return { state, effects: [{ type: 'send-failure', failure: { editId: request.editId, target: request.target, sessionGeneration: request.sessionGeneration, baseDocumentVersion: request.baseDocumentVersion, kind: 'document-mismatch', reason: 'Edit request target or session generation does not match the active observation' } }] }
    const validation = validateEditRequest(request, state.snapshot.content.length, state.snapshot.content)
    if (!validation.ok) return { state, effects: [{ type: 'send-failure', failure: { editId: request.editId, target: request.target, sessionGeneration: request.sessionGeneration, baseDocumentVersion: request.baseDocumentVersion, kind: 'invalid-change', reason: validation.reason } }] }
    if (request.baseDocumentVersion !== state.snapshot.documentVersion || state.pending.size > 0) return { state, effects: [{ type: 'send-failure', failure: conflictFailure(state, request) }, { type: 'accepted-host-document-observation', observation: state.snapshot }] }
    const pending = new Map(state.pending); pending.set(request.editId, request)
    return { state: withPending(state, pending), effects: [{ type: 'apply-edit', request }] }
  }
  if (event.type === 'verified-observation') {
    const { observation } = event; const request = state.pending.get(observation.request.editId)
    if (!request || !sameRequest(request, observation.request) || !sameTarget(observation.before.target, request.target) || observation.before.sessionGeneration !== request.sessionGeneration || observation.before.documentVersion !== request.baseDocumentVersion || !sameTarget(observation.after.target, request.target) || observation.after.sessionGeneration !== request.sessionGeneration) return { state, effects: [{ type: 'send-failure', failure: { editId: observation.request.editId, target: observation.request.target, sessionGeneration: observation.request.sessionGeneration, baseDocumentVersion: observation.request.baseDocumentVersion, kind: 'observation-mismatch', reason: 'Verified edit observation does not match a pending request' } }] }
    const pending = new Map(state.pending); pending.delete(request.editId)
    return { state: { ...withPending(state, pending), snapshot: observation.after }, effects: [{ type: 'send-success', observation }] }
  }
  if (event.type === 'failure') {
    const request = state.pending.get(event.failure.editId)
    if (!request || !sameRequest(request, event.failure)) return { state, effects: [] }
    const pending = new Map(state.pending); pending.delete(request.editId)
    const cleared = withPending(state, pending)
    const failureEffect: EditorSessionEffect = { type: 'send-failure', failure: event.failure }
    if (!event.failure.snapshot) return { state: cleared, effects: [failureEffect] }
    const accepted = acceptObservation(cleared, event.failure.snapshot)
    return { state: accepted.state, effects: [failureEffect, ...accepted.effects] }
  }
  if (event.type === 'host-document-observation') return acceptObservation(state, event.observation)
  return { state, effects: [] }
}
export function requestEdit(state: EditorSessionState, request: EditRequest): EditorSessionTransition { return transitionEditorSession(state, { type: 'request-edit', request }) }
export function recordVerifiedEditObservation(state: EditorSessionState, observation: VerifiedEditObservation): EditorSessionTransition { return transitionEditorSession(state, { type: 'verified-observation', observation }) }
export function recordFailure(state: EditorSessionState, failure: EditFailure): EditorSessionTransition { return transitionEditorSession(state, { type: 'failure', failure }) }
export function recordHostDocumentObservation(state: EditorSessionState, observation: HostDocumentObservation): EditorSessionTransition { return transitionEditorSession(state, { type: 'host-document-observation', observation }) }
