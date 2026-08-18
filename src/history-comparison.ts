import type { Result } from './protocol'

export interface ScmHistoryItem {
  readonly id: string
  readonly parentIds: readonly string[]
}

function isHistoryItem(value: unknown): value is ScmHistoryItem {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.id === 'string' && Array.isArray(candidate.parentIds) &&
    candidate.parentIds.every(parent => typeof parent === 'string')
}

export interface CommitComparisonRefs {
  readonly originalRef: string
  readonly modifiedRef: string
}

export interface TimelineCommitItem {
  readonly ref: string
  readonly contextValue: 'git:file:commit'
}

export interface TimelineResourceUri {
  readonly scheme: string
  readonly fsPath: string
  readonly path: string
}

export type CommitComparisonInput =
  | { readonly kind: 'scm-history'; readonly refs: CommitComparisonRefs }
  | { readonly kind: 'timeline'; readonly ref: string; readonly resourceUri: TimelineResourceUri }

function isTimelineCommitItem(value: unknown): value is TimelineCommitItem {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.ref === 'string' && candidate.ref.length > 0 &&
    candidate.contextValue === 'git:file:commit'
}

function isTimelineResourceUri(value: unknown): value is TimelineResourceUri {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.scheme === 'string' && typeof candidate.fsPath === 'string' &&
    candidate.fsPath.length > 0 && typeof candidate.path === 'string'
}

function collectHistoryItems(values: readonly unknown[]): ScmHistoryItem[] {
  const items: ScmHistoryItem[] = []
  for (const value of values) {
    if (Array.isArray(value)) items.push(...collectHistoryItems(value))
    else if (isHistoryItem(value)) items.push(value)
  }
  return [...new Map(items.map(item => [item.id, item])).values()]
}

export function resolveHistoryComparison(values: readonly unknown[]): Result<CommitComparisonRefs> {
  const items = collectHistoryItems(values)
  if (items.length >= 2) {
    return { ok: true, value: { originalRef: items[1].id, modifiedRef: items[0].id } }
  }
  const item = items[0]
  const parent = item?.parentIds[0]
  if (item && parent) return { ok: true, value: { originalRef: parent, modifiedRef: item.id } }
  return { ok: false, error: 'Select a commit with a parent or select two commits in Source Control history.' }
}

export function resolveCommitComparisonInput(values: readonly unknown[]): Result<CommitComparisonInput> {
  const timelineItem = values[0]
  const resourceUri = values[1]
  if (isTimelineCommitItem(timelineItem)) {
    if (!isTimelineResourceUri(resourceUri)) {
      return { ok: false, error: 'The Timeline commit does not identify a document.' }
    }
    return {
      ok: true,
      value: { kind: 'timeline', ref: timelineItem.ref, resourceUri },
    }
  }
  const refs = resolveHistoryComparison(values)
  return refs.ok ? { ok: true, value: { kind: 'scm-history', refs: refs.value } } : refs
}

export function resolveTimelineComparisonRefs(
  identity: { readonly hash: string; readonly parentHash: string | null },
): Result<CommitComparisonRefs> {
  if (identity.parentHash === null) {
    return { ok: false, error: 'The selected commit has no parent to compare.' }
  }
  return {
    ok: true,
    value: { originalRef: identity.parentHash, modifiedRef: identity.hash },
  }
}
