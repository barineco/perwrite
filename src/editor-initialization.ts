import type { ComparisonResult, ResolvedComparisonSide, ResolvedGitComparison, ResolvedReadonlyDocument, RevisionSnapshot } from './protocol'
import { editorInitializationRevision, revisionLabel, type GitUri, type CommitInitializationSnapshots } from './git-source'

export type EditorInitializationDecision =
  | { readonly kind: 'standard' }
  | { readonly kind: 'commit'; readonly ref: string; readonly actualFsPath: string }

export type ResolvedEditorInitialization =
  | { readonly kind: 'comparison'; readonly result: ComparisonResult<ResolvedGitComparison> }
  | { readonly kind: 'readonly'; readonly document: ResolvedReadonlyDocument }

export function decideEditorInitialization(uri: GitUri): ComparisonResult<EditorInitializationDecision> { return editorInitializationRevision(uri) }

function side(snapshot: RevisionSnapshot, baseResourceUri: string): ResolvedComparisonSide {
  const identity = snapshot.revisionIdentity.kind === 'commit' ? snapshot.revisionIdentity.fullHash : snapshot.revisionIdentity.kind
  return { snapshot, label: revisionLabel(snapshot.provenance.kind === 'commit' ? { kind: 'commit', ref: snapshot.provenance.requestedRef } : { kind: snapshot.provenance.kind }), documentId: `${snapshot.physicalUri}?revision=${encodeURIComponent(identity)}`, baseResourceUri }
}

export function buildCommitEditorInitialization(resolved: CommitInitializationSnapshots, baseResourceUri: string): ResolvedEditorInitialization {
  const target = side(resolved.target, baseResourceUri)
  if (!resolved.parent) return { kind: 'readonly', document: { snapshot: resolved.target, target: target.label, reason: 'This commit has no parent to compare', documentId: target.documentId, baseResourceUri } }
  const parent = side(resolved.parent, baseResourceUri)
  return { kind: 'comparison', result: { ok: true, value: { identity: `${resolved.target.physicalUri}:${parent.documentId}:${target.documentId}`, original: parent, modified: target, editableSide: null } } }
}
