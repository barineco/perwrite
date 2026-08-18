import type { EditFailure, EditOutcome, HostMessage, Result, VerifiedEditObservation } from './protocol'

export function editApplicationResult(applied: boolean): Result<null> {
  return applied ? { ok: true, value: null } : { ok: false, error: 'VS Code rejected the document edit' }
}

export function editApplicationFailure(error: unknown): Result<null> {
  return { ok: false, error: `Document edit failed: ${error instanceof Error ? error.message : String(error)}` }
}

export function typedEditApplicationFailure(
  request: Pick<EditFailure, 'editId' | 'target' | 'sessionGeneration' | 'baseDocumentVersion'>,
  kind: EditFailure['kind'],
  error: unknown,
): EditOutcome {
  return { ok: false, error: { ...request, kind, reason: error instanceof Error ? error.message : String(error) } }
}

export function typedVerifiedEditObservation(observation: VerifiedEditObservation): EditOutcome {
  return { ok: true, value: observation }
}

export async function applyEditWithResult<T>(apply: (edit: T) => PromiseLike<boolean>, edit: T): Promise<Result<null>> {
  try { return editApplicationResult(await apply(edit)) } catch (error) { return editApplicationFailure(error) }
}

export function editResultMessage(result: EditOutcome): HostMessage {
  return { type: 'edit-result', result }
}

export function verifiedEditObservationMessage(observation: VerifiedEditObservation): HostMessage {
  return editResultMessage({ ok: true, value: observation })
}
