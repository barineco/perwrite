import * as vscode from 'vscode'
import {
  contentHash,
  type HostDocumentObservation,
  type EditFailure,
  type EditRequest,
  type EditVerificationResult,
  type TextChange,
  validateEditRequest,
  validateTextChanges,
} from './protocol'

export interface WorkspaceEditWitness {
  readonly request: EditRequest
  readonly before: HostDocumentObservation
  readonly expectedContent: string
  readonly expectedContentHash: string
  readonly ranges: readonly { readonly from: number; readonly to: number }[]
  readonly inserts: readonly string[]
  readonly workspaceEdit: vscode.WorkspaceEdit
}

function sameTarget(left: EditRequest['target'], right: EditRequest['target']): boolean {
  return left.kind === right.kind && left.documentId === right.documentId &&
    (left.kind === 'editing' || (right.kind === 'comparison' && left.side === right.side))
}

export function observeDocument(document: vscode.TextDocument, target: EditRequest['target'], sessionGeneration: number): HostDocumentObservation {
  const content = document.getText()
  return { target, sessionGeneration, documentVersion: document.version, content, contentHash: contentHash(content) }
}

function expectedContent(content: string, changes: readonly TextChange[]): string {
  let cursor = 0
  let result = ''
  for (const change of changes) {
    result += content.slice(cursor, change.from) + change.insert
    cursor = change.to
  }
  return result + content.slice(cursor)
}

export function workspaceEditForChanges(
  document: vscode.TextDocument,
  request: EditRequest,
  before: HostDocumentObservation,
): { readonly ok: true; readonly value: WorkspaceEditWitness } | { readonly ok: false; readonly error: string } {
  const validation = validateTextChanges(request.changes, before.content.length, before.content)
  if (!validation.ok) return { ok: false, error: validation.reason }
  const workspaceEdit = new vscode.WorkspaceEdit()
  const ranges: { from: number; to: number }[] = []
  const inserts: string[] = []
  for (const change of [...request.changes].sort((left, right) => right.from - left.from)) {
    workspaceEdit.replace(document.uri, new vscode.Range(document.positionAt(change.from), document.positionAt(change.to)), change.insert)
    ranges.push({ from: change.from, to: change.to })
    inserts.push(change.insert)
  }
  const expected = expectedContent(before.content, request.changes)
  return { ok: true, value: {
    request, before, expectedContent: expected, expectedContentHash: contentHash(expected),
    ranges: ranges.reverse(), inserts: inserts.reverse(), workspaceEdit,
  } }
}

export function editFailure(request: EditRequest, kind: EditFailure['kind'], reason: string, document?: vscode.TextDocument): EditFailure {
  return {
    editId: request.editId, target: request.target, sessionGeneration: request.sessionGeneration,
    baseDocumentVersion: request.baseDocumentVersion, kind, reason,
    ...(document ? { currentDocumentVersion: document.version } : {}),
  }
}

export async function applyWorkspaceEditWithObservation(
  document: vscode.TextDocument,
  request: EditRequest,
): Promise<EditVerificationResult> {
  const before = observeDocument(document, request.target, request.sessionGeneration)
  const validation = validateEditRequest(request, before.content.length, before.content)
  if (!validation.ok) return { ok: false, error: editFailure(request, 'invalid-change', validation.reason, document) }
  if (!sameTarget(request.target, before.target) || request.sessionGeneration !== before.sessionGeneration || request.baseDocumentVersion !== before.documentVersion) {
    return { ok: false, error: { ...editFailure(request, 'base-version-conflict', 'Edit request does not match the current document snapshot', document), snapshot: before } }
  }
  const prepared = workspaceEditForChanges(document, request, before)
  if (!prepared.ok) return { ok: false, error: editFailure(request, 'invalid-change', prepared.error, document) }
  try {
    if (!await vscode.workspace.applyEdit(prepared.value.workspaceEdit)) {
      return { ok: false, error: editFailure(request, 'apply-rejected', 'VS Code rejected the document edit', document) }
    }
    const current = await resolveDocument(document)
    if (!current || current.uri.toString() !== document.uri.toString()) {
      return { ok: false, error: editFailure(request, 'document-mismatch', 'The edited document identity could not be observed', current ?? document) }
    }
    const after = observeDocument(current, request.target, request.sessionGeneration)
    if (!sameTarget(after.target, request.target) || after.sessionGeneration !== request.sessionGeneration) {
      return { ok: false, error: editFailure(request, 'document-mismatch', 'The observed document target or generation differs from the request', current) }
    }
    if (after.content !== prepared.value.expectedContent || after.contentHash !== prepared.value.expectedContentHash) {
      return { ok: false, error: { ...editFailure(request, 'observation-mismatch', 'The observed post-edit snapshot differs from the workspace edit witness', current), snapshot: after } }
    }
    return { ok: true, value: { request, before, after } }
  } catch (error) {
    return { ok: false, error: editFailure(request, 'apply-rejected', error instanceof Error ? error.message : String(error), document) }
  }
}

async function resolveDocument(document: vscode.TextDocument): Promise<vscode.TextDocument | null> {
  const existing = vscode.workspace.textDocuments.find(candidate => candidate.uri.toString() === document.uri.toString())
  if (existing) return existing
  try { return await vscode.workspace.openTextDocument(document.uri) } catch { return null }
}
