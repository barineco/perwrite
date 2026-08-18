import type {
  ComparisonFailure,
  ComparisonResult,
  ComparisonSide,
  GitComparison,
  GitRevision,
  Result,
  RevisionSnapshot,
} from './protocol'
import { contentHash } from './protocol'

export interface GitUri { readonly fsPath: string; readonly scheme?: string; readonly query?: string }
export interface GitRepository { readonly rootUri: GitUri; getCommit(ref: string): Promise<unknown>; show(ref: string, path: string): Promise<string> }
export interface GitCommit { readonly hash: string; readonly parents: readonly string[] }
export interface GitApi { getRepository(uri: GitUri): GitRepository | null }
export interface GitExtension { readonly isActive: boolean; activate(): Promise<GitExtensionExports>; readonly exports: GitExtensionExports }
export interface GitExtensionExports { getAPI(version: 1): GitApi }
export interface GitExtensionProvider { getExtension(id: string): GitExtension | undefined }

const GIT_EXTENSION_ID = 'vscode.git'
const WORKING_TREE_URI_SCHEMES = new Set(['file', 'vscode-remote'])
export const gitExtensionMissingError = 'Git extension is not available'
export const outsideRepositoryError = 'Document is not in a Git repository'
export const untrackedError = 'Document has no version in the selected revision'

export function gitShowError(revision: GitRevision, error: unknown): string { return `Failed to read ${revisionLabel(revision)} content: ${error instanceof Error ? error.message : String(error)}` }
export function revisionLabel(revision: GitRevision): string { switch (revision.kind) { case 'working-tree': return 'Working Tree'; case 'index': return 'Index'; case 'commit': return revision.ref } }
export function editableSideFor(original: GitRevision, modified: GitRevision): ComparisonSide | null { return original.kind === 'working-tree' ? 'original' : modified.kind === 'working-tree' ? 'modified' : null }
export function createGitComparison(original: GitRevision, modified: GitRevision): GitComparison { return { original, modified, editableSide: editableSideFor(original, modified) } }
export interface ResolvedGitUri { readonly revision: GitRevision; readonly actualFsPath: string }
interface GitUriQuery { readonly path: string; readonly ref: string }
function failure(kind: ComparisonFailure['kind'], side: ComparisonSide | null, target: string, detail: string): ComparisonResult<never> { return { ok: false, error: { kind, side, target, detail } } }

export function resolveGitDocumentUri(uri: GitUri, side: ComparisonSide): ComparisonResult<ResolvedGitUri> {
  if (uri.scheme === undefined || WORKING_TREE_URI_SCHEMES.has(uri.scheme)) return uri.fsPath ? { ok: true, value: { revision: { kind: 'working-tree' }, actualFsPath: uri.fsPath } } : failure('invalid-uri', side, 'working-tree', 'Document path is empty')
  if (uri.scheme !== 'git') return failure('comparison-unresolved', side, uri.scheme, `Unsupported document scheme: ${uri.scheme}`)
  let query: unknown
  try { query = JSON.parse(uri.query ?? '') } catch (error) { return failure('invalid-uri', side, 'git', error instanceof Error ? error.message : String(error)) }
  if (!isGitUriQuery(query)) return failure('invalid-uri', side, 'git', 'Git URI query must contain string path and ref fields')
  return { ok: true, value: { revision: query.ref === '' || query.ref === '~' ? { kind: 'index' } : { kind: 'commit', ref: query.ref }, actualFsPath: query.path } }
}
function isGitUriQuery(value: unknown): value is GitUriQuery { return typeof value === 'object' && value !== null && typeof (value as GitUriQuery).path === 'string' && (value as GitUriQuery).path.length > 0 && typeof (value as GitUriQuery).ref === 'string' }
export function decodeGitCommit(value: unknown): Result<GitCommit> {
  if (typeof value !== 'object' || value === null) return { ok: false, error: 'Git commit must be an object' }
  const candidate = value as Record<string, unknown>
  if (typeof candidate.hash !== 'string' || candidate.hash.length === 0) return { ok: false, error: 'Git commit hash must be a non-empty string' }
  if (!Array.isArray(candidate.parents) || !candidate.parents.every(parent => typeof parent === 'string' && parent.length > 0)) return { ok: false, error: 'Git commit parents must be an array of non-empty strings' }
  return { ok: true, value: { hash: candidate.hash, parents: candidate.parents } }
}
export function editorInitializationRevision(uri: GitUri): ComparisonResult<{ readonly kind: 'standard' } | { readonly kind: 'commit'; readonly ref: string; readonly actualFsPath: string }> {
  const resolved = resolveGitDocumentUri(uri, 'modified')
  if (!resolved.ok) return resolved
  return resolved.value.revision.kind === 'commit' ? { ok: true, value: { kind: 'commit', ref: resolved.value.revision.ref, actualFsPath: resolved.value.actualFsPath } } : { ok: true, value: { kind: 'standard' } }
}
export interface ResolvedUriComparison { readonly comparison: GitComparison; readonly actualFsPath: string }
export function resolveUriComparison(original: GitUri, modified: GitUri): ComparisonResult<ResolvedUriComparison> {
  const left = resolveGitDocumentUri(original, 'original'); if (!left.ok) return left
  const right = resolveGitDocumentUri(modified, 'modified'); if (!right.ok) return right
  if (left.value.actualFsPath !== right.value.actualFsPath) return failure('different-document', null, right.value.actualFsPath, 'Comparison sides refer to different documents')
  if (sameRevision(left.value.revision, right.value.revision)) return failure('comparison-unresolved', null, revisionLabel(left.value.revision), 'Comparison sides use the same revision')
  return { ok: true, value: { comparison: createGitComparison(left.value.revision, right.value.revision), actualFsPath: left.value.actualFsPath } }
}
function sameRevision(left: GitRevision, right: GitRevision): boolean { return left.kind === right.kind && (left.kind !== 'commit' || (right.kind === 'commit' && left.ref === right.ref)) }
export function relativePathInRepository(rootFsPath: string, documentFsPath: string): string | null { const root = rootFsPath.endsWith('/') ? rootFsPath : rootFsPath + '/'; return documentFsPath === rootFsPath ? '' : documentFsPath.startsWith(root) ? documentFsPath.slice(root.length) : null }
export async function resolveGitApi(provider: GitExtensionProvider): Promise<Result<GitApi>> { try { const extension = provider.getExtension(GIT_EXTENSION_ID); if (!extension) return { ok: false, error: gitExtensionMissingError }; return { ok: true, value: (extension.isActive ? extension.exports : await extension.activate()).getAPI(1) } } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) } } }

async function repositoryFor(provider: GitExtensionProvider, document: GitUri, revision: GitRevision, side: ComparisonSide | null): Promise<ComparisonResult<{ readonly repository: GitRepository; readonly relativePath: string }>> {
  const api = await resolveGitApi(provider)
  if (!api.ok) return failure(api.error === gitExtensionMissingError ? 'git-extension-missing' : 'git-api-failure', side, revisionLabel(revision), api.error)
  let repository: GitRepository | null
  try { repository = api.value.getRepository(document) } catch (error) { return failure('git-api-failure', side, revisionLabel(revision), error instanceof Error ? error.message : String(error)) }
  if (!repository) return failure('outside-repository', side, revisionLabel(revision), outsideRepositoryError)
  const relativePath = relativePathInRepository(repository.rootUri.fsPath, document.fsPath)
  return relativePath === null ? failure('outside-repository', side, revisionLabel(revision), outsideRepositoryError) : { ok: true, value: { repository, relativePath } }
}
function snapshot(physicalUri: string, revisionIdentity: RevisionSnapshot['revisionIdentity'], content: string, provenance: RevisionSnapshot['provenance']): RevisionSnapshot { return { physicalUri, revisionIdentity, content, contentHash: contentHash(content), provenance } }
async function showSnapshot(repository: GitRepository, relativePath: string, physicalUri: string, hash: string, requestedRef: string, side: ComparisonSide): Promise<ComparisonResult<RevisionSnapshot>> {
  try { const content = await repository.show(hash, relativePath); return content === undefined || content === null ? failure('document-missing', side, hash, untrackedError) : { ok: true, value: snapshot(physicalUri, { kind: 'commit', fullHash: hash }, content, { kind: 'commit', documentVersion: 0, requestedRef }) } } catch (error) { return failure('document-missing', side, hash, error instanceof Error ? error.message : String(error)) }
}
export async function readRevisionSnapshot(provider: GitExtensionProvider, document: GitUri, revision: GitRevision, side: ComparisonSide = 'original', workingTree?: { readonly content: string; readonly documentVersion: number }): Promise<ComparisonResult<RevisionSnapshot>> {
  if (revision.kind === 'working-tree') {
    if (workingTree) return { ok: true, value: snapshot(document.fsPath, { kind: 'working-tree' }, workingTree.content, { kind: 'working-tree', documentVersion: workingTree.documentVersion }) }
    return failure('comparison-unresolved', side, 'working-tree', 'Working Tree content is required')
  }
  const resolved = await repositoryFor(provider, document, revision, side); if (!resolved.ok) return resolved
  if (revision.kind === 'index') { try { const content = await resolved.value.repository.show('', resolved.value.relativePath); return content === undefined || content === null ? failure('document-missing', side, 'Index', untrackedError) : { ok: true, value: snapshot(document.fsPath, { kind: 'index' }, content, { kind: 'index', documentVersion: 0 }) } } catch (error) { return failure('document-missing', side, 'Index', error instanceof Error ? error.message : String(error)) } }
  let externalCommit: unknown
  try { externalCommit = await resolved.value.repository.getCommit(revision.ref) } catch (error) { return failure('git-api-failure', side, revision.ref, error instanceof Error ? error.message : String(error)) }
  if (externalCommit === undefined || externalCommit === null) return failure('revision-missing', side, revision.ref, 'Commit was not found')
  const commit = decodeGitCommit(externalCommit); if (!commit.ok) return failure('commit-invalid', side, revision.ref, commit.error)
  return showSnapshot(resolved.value.repository, resolved.value.relativePath, document.fsPath, commit.value.hash, revision.ref, side)
}
export type CommitInitializationSnapshots = { readonly target: RevisionSnapshot; readonly parent: RevisionSnapshot | null }
export async function readCommitInitializationSnapshots(provider: GitExtensionProvider, document: GitUri, requestedRef: string): Promise<ComparisonResult<CommitInitializationSnapshots>> {
  const revision: GitRevision = { kind: 'commit', ref: requestedRef }
  const resolved = await repositoryFor(provider, document, revision, null); if (!resolved.ok) return resolved
  let externalCommit: unknown
  try { externalCommit = await resolved.value.repository.getCommit(requestedRef) } catch (error) { return failure('git-api-failure', null, requestedRef, error instanceof Error ? error.message : String(error)) }
  if (externalCommit === undefined || externalCommit === null) return failure('revision-missing', null, requestedRef, 'Commit was not found')
  const commit = decodeGitCommit(externalCommit); if (!commit.ok) return failure('commit-invalid', null, requestedRef, commit.error)
  const target = await showSnapshot(resolved.value.repository, resolved.value.relativePath, document.fsPath, commit.value.hash, requestedRef, 'modified'); if (!target.ok) return target
  const parentHash = commit.value.parents[0]; if (!parentHash) return { ok: true, value: { target: target.value, parent: null } }
  const parent = await showSnapshot(resolved.value.repository, resolved.value.relativePath, document.fsPath, parentHash, parentHash, 'original'); if (!parent.ok) return parent
  return { ok: true, value: { target: target.value, parent: parent.value } }
}
