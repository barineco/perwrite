import type * as vscode from 'vscode'
import type { AppearanceHostSources } from './appearance-profile'

export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E }

export type DocumentVersion = number
export type ComparisonSide = 'original' | 'modified'

export interface TextChange {
  readonly from: number
  readonly to: number
  readonly insert: string
}

export type TextChangeValidation = {
  readonly ok: true
} | {
  readonly ok: false
  readonly reason: string
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value)
}

function isSurrogateBoundary(content: string, offset: number): boolean {
  if (offset <= 0 || offset >= content.length) return true
  const previous = content.charCodeAt(offset - 1)
  const next = content.charCodeAt(offset)
  return !(previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
}

/** Selection is an even sequence of CodeMirror range anchor/head UTF-16 offsets. */
export function validateSelection(selection: readonly number[], documentLength: number): TextChangeValidation {
  if (!Array.isArray(selection) || selection.length % 2 !== 0) return { ok: false, reason: 'selection must contain anchor/head pairs' }
  if (selection.some(offset => !isInteger(offset) || offset < 0 || offset > documentLength)) return { ok: false, reason: 'selection offset is outside the document' }
  return { ok: true }
}

export function validateTextChanges(
  changes: readonly TextChange[],
  documentLength?: number,
  documentContent?: string,
): TextChangeValidation {
  if (!Array.isArray(changes)) return { ok: false, reason: 'changes must be an array' }
  let previousTo = 0
  for (const change of changes) {
    if (typeof change !== 'object' || change === null || !isInteger(change.from) || !isInteger(change.to) || typeof change.insert !== 'string') {
      return { ok: false, reason: 'each change must contain integer from/to and string insert' }
    }
    if (change.from < 0 || change.to < change.from) return { ok: false, reason: 'change range is invalid' }
    if (change.from < previousTo) return { ok: false, reason: 'changes overlap or are out of order' }
    if (documentLength !== undefined && change.to > documentLength) return { ok: false, reason: 'change range exceeds document length' }
    if (documentContent !== undefined && (!isSurrogateBoundary(documentContent, change.from) || !isSurrogateBoundary(documentContent, change.to))) {
      return { ok: false, reason: 'change range splits a surrogate pair' }
    }
    previousTo = change.to
  }
  return { ok: true }
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export function canonicalJsonByteLength(value: unknown): number {
  return utf8ByteLength(JSON.stringify(value))
}

function shaRotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount))
}

export function contentHash(content: string): string {
  const bytes = [...new TextEncoder().encode(content)]
  const bitLength = bytes.length * 8
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  for (let index = 7; index >= 0; index--) bytes.push(Math.floor(bitLength / 2 ** (index * 8)) & 0xff)
  const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  const constants = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = Array<number>(64).fill(0)
    for (let index = 0; index < 16; index++) words[index] = (bytes[offset + index * 4] << 24) | (bytes[offset + index * 4 + 1] << 16) | (bytes[offset + index * 4 + 2] << 8) | bytes[offset + index * 4 + 3]
    for (let index = 16; index < 64; index++) {
      const a = words[index - 15]; const b = words[index - 2]
      words[index] = (words[index - 16] + (shaRotateRight(a, 7) ^ shaRotateRight(a, 18) ^ (a >>> 3)) + words[index - 7] + (shaRotateRight(b, 17) ^ shaRotateRight(b, 19) ^ (b >>> 10))) | 0
    }
    let [a, b, c, d, e, f, g, h] = hash
    for (let index = 0; index < 64; index++) {
      const s1 = shaRotateRight(e, 6) ^ shaRotateRight(e, 11) ^ shaRotateRight(e, 25)
      const choose = (e & f) ^ (~e & g)
      const temporary1 = (h + s1 + choose + constants[index] + words[index]) | 0
      const s0 = shaRotateRight(a, 2) ^ shaRotateRight(a, 13) ^ shaRotateRight(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temporary2 = (s0 + majority) | 0
      h = g; g = f; f = e; e = (d + temporary1) | 0; d = c; c = b; b = a; a = (temporary1 + temporary2) | 0
    }
    hash[0] = (hash[0] + a) | 0; hash[1] = (hash[1] + b) | 0; hash[2] = (hash[2] + c) | 0; hash[3] = (hash[3] + d) | 0; hash[4] = (hash[4] + e) | 0; hash[5] = (hash[5] + f) | 0; hash[6] = (hash[6] + g) | 0; hash[7] = (hash[7] + h) | 0
  }
  return hash.map(value => (value >>> 0).toString(16).padStart(8, '0')).join('')
}

export interface TokenThemeData {
  readonly name: string
  readonly type: string
  readonly tokenColors: readonly unknown[]
  readonly semanticTokenColors: Readonly<Record<string, unknown>>
  readonly semanticHighlighting?: boolean
}

export interface ResolveActiveTokenThemeInput {
  readonly generation: number
}

export interface ResolveActiveTokenThemeOutput {
  readonly generation: number
  readonly result: Result<TokenThemeData>
}

export type GitRevision =
  | { readonly kind: 'working-tree' }
  | { readonly kind: 'index' }
  | { readonly kind: 'commit'; readonly ref: string }

export type ResolvedGitRevision =
  | { readonly kind: 'working-tree' }
  | { readonly kind: 'index' }
  | { readonly kind: 'commit'; readonly fullHash: string }

export type RevisionProvenance =
  | { readonly kind: 'working-tree'; readonly documentVersion: DocumentVersion }
  | { readonly kind: 'index'; readonly documentVersion: DocumentVersion }
  | { readonly kind: 'commit'; readonly documentVersion: DocumentVersion; readonly requestedRef: string }

export interface RevisionSnapshot {
  readonly physicalUri: string
  readonly revisionIdentity: ResolvedGitRevision
  readonly content: string
  readonly contentHash: string
  readonly provenance: RevisionProvenance
}

export interface RevealCommandInput {
  readonly uri: vscode.Uri
  readonly range: vscode.Range
  readonly revision?: GitRevision
}

export type RevealCommandResult =
  | { readonly status: 'sent'; readonly uri: vscode.Uri; readonly revision?: GitRevision; readonly from: number; readonly to: number }
  | { readonly status: 'invalid-arguments' | 'invalid-range' | 'revision-not-found' | 'internal-error' | 'editor-not-ready' | 'target-not-found' | 'ambiguous-target' | 'post-message-failed' }

export interface GitComparison {
  readonly original: GitRevision
  readonly modified: GitRevision
  readonly editableSide: ComparisonSide | null
}

export interface ResolvedComparisonSide {
  readonly snapshot: RevisionSnapshot
  readonly label: string
  readonly documentId: string
  readonly baseResourceUri: string
}

export interface ResolvedGitComparison {
  readonly identity: string
  readonly original: ResolvedComparisonSide
  readonly modified: ResolvedComparisonSide
  readonly editableSide: ComparisonSide | null
}

export interface ResolvedReadonlyDocument {
  readonly snapshot: RevisionSnapshot
  readonly target: string
  readonly reason: string
  readonly documentId: string
  readonly baseResourceUri: string
}

export type ComparisonFailureKind =
  | 'git-extension-missing' | 'outside-repository' | 'invalid-uri' | 'different-document'
  | 'revision-missing' | 'commit-invalid' | 'git-api-failure' | 'document-missing' | 'comparison-unresolved'

export interface ComparisonFailure {
  readonly kind: ComparisonFailureKind
  readonly side: ComparisonSide | null
  readonly target: string
  readonly detail: string
}

export type ComparisonResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ComparisonFailure }

export interface ComparisonRequest {
  readonly type: 'comparison-request'
  readonly requestId: number
  readonly original: GitRevision
  readonly modified: GitRevision
}

export type ViewMode = 'raw' | 'rich' | 'render'

export interface RenderingProfile {
  readonly generation: number
  readonly codeBlockWrap: boolean
  readonly mermaidLayout: 'elk' | 'dagre'
  readonly mermaidMaxEdges: number
  readonly mermaidPanStep: number
  readonly mermaidZoomStep: number
  readonly texRendering: boolean
}

export interface EditorConfiguration {
  readonly defaultViewMode: ViewMode
  readonly rendering: RenderingProfile
  readonly configurationFailure: string | null
}

export interface DraftEdit {
  readonly uri: string
  readonly generation: number
  readonly beforeHash: string
  readonly changes: readonly TextChange[]
  readonly selection: readonly number[]
}

export type HostMessage =
  | { type: 'init'; documentId: string; content: string; documentVersion?: DocumentVersion; appearance: AppearanceHostSources; baseResourceUri: string; configuration: Result<EditorConfiguration> }
  | { type: 'draft-snapshot'; uri: string; content: string; contentHash: string; selection: readonly number[]; generation: number; dirty: boolean; externalChange: string | null }
  | { type: 'appearance-change'; appearance: AppearanceHostSources }
  | { type: 'configuration-change'; configuration: Result<EditorConfiguration> }
  | { type: 'comparison-init'; result: ComparisonResult<ResolvedGitComparison>; appearance: AppearanceHostSources; configuration: Result<EditorConfiguration> }
  | { type: 'readonly-init'; document: ResolvedReadonlyDocument; appearance: AppearanceHostSources; configuration: Result<EditorConfiguration> }
  | { type: 'comparison-result'; requestId: number; result: ComparisonResult<ResolvedGitComparison> }
  | { type: 'reveal-target'; documentId: string; from: number; to: number; source: 'external' }

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'editor-ready'; documentIds: readonly string[] }
  | ({ type: 'draft-edit' } & DraftEdit)
  | { type: 'activate-link'; documentId: string; destination: string }
  | { type: 'save'; documentId: string }
  | ComparisonRequest

export function appearanceChangeMessage(appearance: AppearanceHostSources): HostMessage {
  return { type: 'appearance-change', appearance }
}

export function configurationChangeMessage(configuration: Result<EditorConfiguration>): HostMessage {
  return { type: 'configuration-change', configuration }
}
