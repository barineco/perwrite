import type {
  ComparisonFailure,
  ComparisonResult,
  EditorConfiguration,
  GitRevision,
  ResolvedGitComparison,
  ResolvedReadonlyDocument,
} from '../src/protocol'

export type DisplaySession = 'editing' | 'readonly' | 'comparison'
export type SessionLifecycle = 'active' | 'disposed'

export type ComparisonPresentation =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'pending'
      readonly requestId: number
      readonly sessionIdentity: string
      readonly sessionGeneration: number
      readonly original: GitRevision
      readonly modified: GitRevision
    }
  | {
      readonly kind: 'ready'
      readonly requestId: number | null
      readonly sessionIdentity: string
      readonly sessionGeneration: number
      readonly result: ResolvedGitComparison
    }
  | {
      readonly kind: 'failed'
      readonly requestId: number | null
      readonly sessionIdentity: string
      readonly sessionGeneration: number
      readonly original: GitRevision | null
      readonly modified: GitRevision | null
      readonly failure: ComparisonFailure
    }

export interface WebviewSelection {
  readonly from: number
  readonly to: number
}

export interface WebviewState {
  readonly sessionIdentity: string
  readonly sessionGeneration: number
  readonly lifecycle: SessionLifecycle
  readonly displaySession: DisplaySession
  readonly appearance: unknown | null
  readonly configuration: EditorConfiguration | null
  readonly comparison: ComparisonPresentation
  readonly nextComparisonRequest: number
  readonly selection: readonly WebviewSelection[]
  readonly historyGeneration: number
  readonly readonlyDocument: ResolvedReadonlyDocument | null
}

export type WebviewEvent =
  | { readonly type: 'set-display-session'; readonly displaySession: DisplaySession }
  | { readonly type: 'dispose' }
  | { readonly type: 'begin-comparison'; readonly requestId: number; readonly original: GitRevision; readonly modified: GitRevision }
  | { readonly type: 'initialize-comparison'; readonly sessionIdentity: string; readonly result: ComparisonResult<ResolvedGitComparison> }
  | { readonly type: 'comparison-result'; readonly requestId: number; readonly result: ComparisonResult<ResolvedGitComparison> }
  | { readonly type: 'set-selection'; readonly selection: readonly WebviewSelection[] }
  | { readonly type: 'apply-snapshot'; readonly content: string; readonly selection: readonly WebviewSelection[] }

export type WebviewEffect =
  | { readonly type: 'request-comparison'; readonly requestId: number; readonly original: GitRevision; readonly modified: GitRevision }
  | { readonly type: 'drop-invalid-event'; readonly reason: string }

export interface WebviewTransition {
  readonly state: WebviewState
  readonly effects: readonly WebviewEffect[]
}

export function createWebviewState(sessionIdentity: string, displaySession: DisplaySession = 'editing', sessionGeneration = 0): WebviewState {
  return {
    sessionIdentity,
    sessionGeneration,
    lifecycle: 'active',
    displaySession,
    appearance: null,
    configuration: null,
    comparison: { kind: 'idle' },
    nextComparisonRequest: 0,
    selection: [],
    historyGeneration: 0,
    readonlyDocument: null,
  }
}

export function initializeWebviewSession(
  state: WebviewState,
  sessionIdentity: string,
  displaySession: DisplaySession,
): WebviewState {
  return {
    ...state,
    sessionIdentity: state.sessionGeneration === 0 ? sessionIdentity : state.sessionIdentity,
    sessionGeneration: state.sessionGeneration + 1,
    lifecycle: 'active',
    displaySession,
    comparison: { kind: 'idle' },
    readonlyDocument: null,
  }
}

function drop(state: WebviewState, reason: string): WebviewTransition {
  return { state, effects: [{ type: 'drop-invalid-event', reason }] }
}

export function transitionWebviewState(state: WebviewState, event: WebviewEvent): WebviewTransition {
  if (event.type === 'dispose') return { state: { ...state, lifecycle: 'disposed', sessionGeneration: state.sessionGeneration + 1 }, effects: [] }
  if (state.lifecycle === 'disposed') return drop(state, 'session is disposed')

  if (event.type === 'set-display-session') return event.displaySession === state.displaySession
    ? { state, effects: [] }
    : { state: { ...state, displaySession: event.displaySession, sessionGeneration: state.sessionGeneration + 1 }, effects: [] }

  if (event.type === 'begin-comparison') {
    const sessionChanged = state.displaySession !== 'comparison'
    const sessionGeneration = state.sessionGeneration + (sessionChanged ? 1 : 0)
    const pending: ComparisonPresentation = {
      kind: 'pending', requestId: event.requestId, sessionIdentity: state.sessionIdentity,
      sessionGeneration, original: event.original, modified: event.modified,
    }
    return {
      state: {
        ...state,
        displaySession: 'comparison',
        sessionGeneration,
        comparison: pending,
        nextComparisonRequest: Math.max(state.nextComparisonRequest, event.requestId),
      },
      effects: [{ type: 'request-comparison', requestId: event.requestId, original: event.original, modified: event.modified }],
    }
  }

  if (event.type === 'initialize-comparison') {
    if (state.displaySession !== 'editing' || state.comparison.kind !== 'idle') {
      return drop(state, 'comparison initialization does not match the current session')
    }
    const sessionGeneration = state.sessionGeneration + 1
    const sessionIdentity = event.sessionIdentity
    if (event.result.ok) {
      return {
        state: {
          ...state,
          sessionIdentity,
          displaySession: 'comparison',
          sessionGeneration,
          comparison: {
            kind: 'ready', requestId: null, sessionIdentity,
            sessionGeneration, result: event.result.value,
          },
        },
        effects: [],
      }
    }
    return {
      state: {
        ...state,
        sessionIdentity,
        displaySession: 'comparison',
        sessionGeneration,
        comparison: {
          kind: 'failed', requestId: null, sessionIdentity,
          sessionGeneration, original: null, modified: null,
          failure: event.result.error,
        },
      },
      effects: [],
    }
  }

  if (event.type === 'comparison-result') {
    const pending = state.comparison
    if (pending.kind !== 'pending' || pending.requestId !== event.requestId || pending.sessionIdentity !== state.sessionIdentity || pending.sessionGeneration !== state.sessionGeneration) {
      return drop(state, 'comparison result identity does not match the pending request')
    }
    if (event.result.ok) {
      return {
        state: {
          ...state,
          comparison: {
            kind: 'ready', requestId: event.requestId, sessionIdentity: state.sessionIdentity,
            sessionGeneration: state.sessionGeneration, result: event.result.value,
          },
        },
        effects: [],
      }
    }
    return {
      state: {
        ...state,
        comparison: {
          kind: 'failed', requestId: event.requestId, sessionIdentity: state.sessionIdentity,
          sessionGeneration: state.sessionGeneration, original: pending.original, modified: pending.modified,
          failure: event.result.error,
        },
      },
      effects: [],
    }
  }

  if (event.type === 'set-selection') return { state: { ...state, selection: event.selection }, effects: [] }

  if (event.type === 'apply-snapshot') {
    const max = event.content.length
    const selection = event.selection.map(range => ({ from: Math.min(range.from, max), to: Math.min(range.to, max) }))
    return { state: { ...state, selection, historyGeneration: state.historyGeneration + 1 }, effects: [] }
  }

  return { state, effects: [] }
}

export function beginComparison(state: WebviewState, requestId: number, original: GitRevision, modified: GitRevision): WebviewTransition {
  return transitionWebviewState(state, { type: 'begin-comparison', requestId, original, modified })
}

export function settleComparison(state: WebviewState, requestId: number, result: ComparisonResult<ResolvedGitComparison>): WebviewTransition {
  return transitionWebviewState(state, { type: 'comparison-result', requestId, result })
}
