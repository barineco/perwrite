import type {
  ComparisonFailure,
  ComparisonResult,
  EditorConfiguration,
  HostDocumentObservation,
  EditFailure,
  EditOutcome,
  VerifiedEditObservation,
  EditRequest,
  GitRevision,
  EditDeliveryTarget,
  HostMessage,
  ResolvedComparisonSide,
  ResolvedGitComparison,
  ResolvedGitRevision,
  ResolvedReadonlyDocument,
  Result,
  TextChange,
  WebviewMessage,
} from './protocol'
import { contentHash } from './protocol'
import {
  MERMAID_SETTING_SCHEMA,
  PERWRITE_SETTING_SCHEMA,
  type PerwriteSettingName,
  type ResolvedAppearanceSettings,
  type EditorFontSettings,
} from './settings-resolver'
import type { AppearanceHostSources } from './appearance-profile'
import { isEditDeliveryTarget, validateEditRequest, validateTextChanges } from './protocol'

export interface DecodeFailure {
  readonly kind: 'invalid-message'
  readonly path: string
  readonly reason: string
}

export type DecodeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DecodeFailure }

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = new Set([...required, ...optional])
  return Object.keys(value).every(key => keys.has(key)) && required.every(key => key in value)
}

function failure(path: string, reason: string): DecodeResult<never> {
  return { ok: false, error: { kind: 'invalid-message', path, reason } }
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function enumValue<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T)
}

function decodeResult<T>(value: unknown, decodeValue: (value: unknown, path: string) => DecodeResult<T>, path: string): DecodeResult<Result<T>> {
  if (!isRecord(value) || !exactKeys(value, ['ok'], ['value', 'error']) || typeof value.ok !== 'boolean') return failure(path, 'result must contain only boolean ok')
  if (value.ok) {
    if (!Object.prototype.hasOwnProperty.call(value, 'value') || Object.keys(value).length !== 2) return failure(path, 'successful result must contain value')
    const decoded = decodeValue(value.value, `${path}.value`)
    return decoded.ok ? { ok: true, value: { ok: true, value: decoded.value } } : decoded
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'error') || Object.keys(value).length !== 2 || typeof value.error !== 'string' || value.error.length === 0) {
    return failure(path, 'failed result must contain a non-empty error')
  }
  return { ok: true, value: { ok: false, error: value.error } }
}

function decodeEditorFont(value: unknown, path: string): DecodeResult<EditorFontSettings> {
  if (!isRecord(value) || !exactKeys(value, ['family', 'size']) || !nonEmptyString(value.family) || typeof value.size !== 'number' || !Number.isFinite(value.size) || value.size <= 0) {
    return failure(path, 'editor font is invalid')
  }
  return { ok: true, value: { family: value.family, size: value.size } }
}

function decodeAppearanceSettings(value: unknown, path: string): DecodeResult<ResolvedAppearanceSettings> {
  if (!isRecord(value) || !exactKeys(value, ['perwrite', 'editorFont']) || !isRecord(value.perwrite)) return failure(path, 'appearance settings are invalid')
  const perwrite = value.perwrite
  const perwriteKeys = Object.keys(PERWRITE_SETTING_SCHEMA) as PerwriteSettingName[]
  if (!exactKeys(perwrite, perwriteKeys) || perwriteKeys.some(key => typeof perwrite[key] !== 'number' || !Number.isFinite(perwrite[key]))) {
    return failure(`${path}.perwrite`, 'perwrite settings are invalid')
  }
  const editorFont = decodeEditorFont(value.editorFont, `${path}.editorFont`)
  return editorFont.ok ? { ok: true, value: { perwrite: perwrite as ResolvedAppearanceSettings['perwrite'], editorFont: editorFont.value } } : editorFont
}

function decodeTokenTheme(value: unknown, path: string): DecodeResult<{ readonly name: string; readonly type: string; readonly tokenColors: readonly unknown[]; readonly semanticTokenColors: Readonly<Record<string, unknown>>; readonly semanticHighlighting?: boolean }> {
  if (!isRecord(value) || !exactKeys(value, ['name', 'type', 'tokenColors', 'semanticTokenColors'], ['semanticHighlighting']) || !nonEmptyString(value.name) || typeof value.type !== 'string' || !Array.isArray(value.tokenColors) || !isRecord(value.semanticTokenColors) || (value.semanticHighlighting !== undefined && typeof value.semanticHighlighting !== 'boolean')) {
    return failure(path, 'token theme is invalid')
  }
  return { ok: true, value: value as never }
}

export function decodeAppearanceSources(value: unknown, path = 'appearance'): DecodeResult<AppearanceHostSources> {
  if (!isRecord(value) || !exactKeys(value, ['version', 'settings', 'fallbackFont', 'tokenTheme']) || !integer(value.version) || value.version < 0 || !isRecord(value.fallbackFont)) return failure(path, 'appearance sources are invalid')
  if (!exactKeys(value.fallbackFont, [], ['family', 'size']) || (value.fallbackFont.family !== undefined && typeof value.fallbackFont.family !== 'string') || (value.fallbackFont.size !== undefined && (typeof value.fallbackFont.size !== 'number' || !Number.isFinite(value.fallbackFont.size)))) return failure(`${path}.fallbackFont`, 'fallback font is invalid')
  const settings = decodeResult(value.settings, decodeAppearanceSettings, `${path}.settings`)
  if (!settings.ok) return settings
  const tokenTheme = decodeResult(value.tokenTheme, decodeTokenTheme, `${path}.tokenTheme`)
  if (!tokenTheme.ok) return tokenTheme
  return { ok: true, value: { version: value.version, settings: settings.value, fallbackFont: value.fallbackFont, tokenTheme: tokenTheme.value } }
}

export function decodeEditorConfiguration(value: unknown, path = 'configuration'): DecodeResult<EditorConfiguration> {
  if (!isRecord(value) || !exactKeys(value, ['defaultViewMode', 'rendering', 'configurationFailure']) || !enumValue(value.defaultViewMode, ['raw', 'rich', 'render'] as const) || (value.configurationFailure !== null && typeof value.configurationFailure !== 'string') || !isRecord(value.rendering) || !exactKeys(value.rendering, ['generation', 'codeBlockWrap', 'mermaidLayout', 'mermaidMaxEdges', 'mermaidPanStep', 'mermaidZoomStep', 'texRendering']) || !integer(value.rendering.generation) || value.rendering.generation < 0 || typeof value.rendering.codeBlockWrap !== 'boolean' || !enumValue(value.rendering.mermaidLayout, ['elk', 'dagre'] as const) || !integer(value.rendering.mermaidMaxEdges) || value.rendering.mermaidMaxEdges < MERMAID_SETTING_SCHEMA.maxEdges.minimum || value.rendering.mermaidMaxEdges > MERMAID_SETTING_SCHEMA.maxEdges.maximum || typeof value.rendering.mermaidPanStep !== 'number' || !Number.isFinite(value.rendering.mermaidPanStep) || value.rendering.mermaidPanStep < MERMAID_SETTING_SCHEMA.panStep.minimum || value.rendering.mermaidPanStep > MERMAID_SETTING_SCHEMA.panStep.maximum || typeof value.rendering.mermaidZoomStep !== 'number' || !Number.isFinite(value.rendering.mermaidZoomStep) || value.rendering.mermaidZoomStep < MERMAID_SETTING_SCHEMA.zoomStep.minimum || value.rendering.mermaidZoomStep > MERMAID_SETTING_SCHEMA.zoomStep.maximum || typeof value.rendering.texRendering !== 'boolean') return failure(path, 'editor configuration is invalid')
  return { ok: true, value: { defaultViewMode: value.defaultViewMode, configurationFailure: value.configurationFailure, rendering: { generation: value.rendering.generation, codeBlockWrap: value.rendering.codeBlockWrap, mermaidLayout: value.rendering.mermaidLayout, mermaidMaxEdges: value.rendering.mermaidMaxEdges, mermaidPanStep: value.rendering.mermaidPanStep, mermaidZoomStep: value.rendering.mermaidZoomStep, texRendering: value.rendering.texRendering } } }
}

export function decodeGitRevision(value: unknown, path = 'revision'): DecodeResult<GitRevision> {
  if (!isRecord(value) || typeof value.kind !== 'string') return failure(path, 'revision kind is required')
  if (value.kind === 'working-tree' || value.kind === 'index') return exactKeys(value, ['kind']) ? { ok: true, value: { kind: value.kind } } : failure(path, 'revision keys are invalid')
  if (value.kind === 'commit' && exactKeys(value, ['kind', 'ref']) && nonEmptyString(value.ref)) return { ok: true, value: { kind: 'commit', ref: value.ref } }
  return failure(path, 'revision is invalid')
}

function decodeResolvedRevision(value: unknown, path: string): DecodeResult<ResolvedGitRevision> {
  if (!isRecord(value) || typeof value.kind !== 'string') return failure(path, 'resolved revision kind is required')
  if (value.kind === 'working-tree' || value.kind === 'index') return exactKeys(value, ['kind']) ? { ok: true, value: { kind: value.kind } } : failure(path, 'resolved revision keys are invalid')
  if (value.kind === 'commit' && exactKeys(value, ['kind', 'fullHash']) && typeof value.fullHash === 'string' && /^[0-9a-f]{40}$/.test(value.fullHash)) return { ok: true, value: { kind: 'commit', fullHash: value.fullHash } }
  return failure(path, 'resolved revision is invalid')
}

export function decodeRevisionSnapshot(value: unknown, path = 'snapshot'): DecodeResult<import('./protocol').RevisionSnapshot> {
  if (!isRecord(value) || !exactKeys(value, ['physicalUri', 'revisionIdentity', 'content', 'contentHash', 'provenance']) || !nonEmptyString(value.physicalUri) || typeof value.content !== 'string' || typeof value.contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(value.contentHash) || value.contentHash !== contentHash(value.content) || !isRecord(value.provenance)) return failure(path, 'revision snapshot is invalid')
  const identity = decodeResolvedRevision(value.revisionIdentity, `${path}.revisionIdentity`)
  if (!identity.ok) return identity
  const provenance = value.provenance
  if (provenance.kind === 'working-tree' || provenance.kind === 'index') {
    if (!exactKeys(provenance, ['kind', 'documentVersion']) || !integer(provenance.documentVersion) || provenance.documentVersion < 0 || identity.value.kind !== provenance.kind) return failure(`${path}.provenance`, 'revision snapshot provenance is invalid')
    return { ok: true, value: { physicalUri: value.physicalUri, revisionIdentity: identity.value, content: value.content, contentHash: value.contentHash, provenance: { kind: provenance.kind, documentVersion: provenance.documentVersion } } }
  }
  if (provenance.kind !== 'commit' || !exactKeys(provenance, ['kind', 'documentVersion', 'requestedRef']) || !integer(provenance.documentVersion) || provenance.documentVersion < 0 || !nonEmptyString(provenance.requestedRef) || identity.value.kind !== 'commit') return failure(`${path}.provenance`, 'revision snapshot provenance is invalid')
  return { ok: true, value: { physicalUri: value.physicalUri, revisionIdentity: identity.value, content: value.content, contentHash: value.contentHash, provenance: { kind: 'commit', documentVersion: provenance.documentVersion, requestedRef: provenance.requestedRef } } }
}

function decodeComparisonSide(value: unknown, path: string): DecodeResult<ResolvedComparisonSide> {
  if (!isRecord(value) || !exactKeys(value, ['snapshot', 'label', 'documentId', 'baseResourceUri']) || !nonEmptyString(value.label) || !nonEmptyString(value.documentId) || !nonEmptyString(value.baseResourceUri)) return failure(path, 'comparison side is invalid')
  const snapshot = decodeRevisionSnapshot(value.snapshot, `${path}.snapshot`)
  return snapshot.ok ? { ok: true, value: { snapshot: snapshot.value, label: value.label, documentId: value.documentId, baseResourceUri: value.baseResourceUri } } : snapshot
}

function decodeComparisonFailure(value: unknown, path: string): DecodeResult<ComparisonFailure> {
  const kinds = ['git-extension-missing', 'outside-repository', 'invalid-uri', 'different-document', 'revision-missing', 'commit-invalid', 'git-api-failure', 'document-missing', 'comparison-unresolved'] as const
  if (!isRecord(value) || !exactKeys(value, ['kind', 'side', 'target', 'detail']) || !enumValue(value.kind, kinds) || (value.side !== null && value.side !== 'original' && value.side !== 'modified') || !nonEmptyString(value.target) || !nonEmptyString(value.detail)) return failure(path, 'comparison failure is invalid')
  return { ok: true, value: { kind: value.kind, side: value.side, target: value.target, detail: value.detail } }
}

function decodeComparison(value: unknown, path: string): DecodeResult<ResolvedGitComparison> {
  if (!isRecord(value) || !exactKeys(value, ['identity', 'original', 'modified', 'editableSide']) || !nonEmptyString(value.identity) || (value.editableSide !== null && value.editableSide !== 'original' && value.editableSide !== 'modified')) return failure(path, 'comparison is invalid')
  const original = decodeComparisonSide(value.original, `${path}.original`)
  if (!original.ok) return original
  const modified = decodeComparisonSide(value.modified, `${path}.modified`)
  if (!modified.ok) return modified
  return { ok: true, value: { identity: value.identity, original: original.value, modified: modified.value, editableSide: value.editableSide } }
}

function decodeComparisonResult(value: unknown, path: string): DecodeResult<ComparisonResult<ResolvedGitComparison>> {
  if (!isRecord(value) || !exactKeys(value, ['ok'], ['value', 'error']) || typeof value.ok !== 'boolean') return failure(path, 'comparison result is invalid')
  if (value.ok) {
    if (!exactKeys(value, ['ok', 'value'])) return failure(path, 'successful comparison result is invalid')
    const comparison = decodeComparison(value.value, `${path}.value`)
    return comparison.ok ? { ok: true, value: { ok: true, value: comparison.value } } : comparison
  }
  if (!exactKeys(value, ['ok', 'error'])) return failure(path, 'failed comparison result is invalid')
  const error = decodeComparisonFailure(value.error, `${path}.error`)
  return error.ok ? { ok: true, value: { ok: false, error: error.value } } : error
}

function decodeReadonly(value: unknown, path: string): DecodeResult<ResolvedReadonlyDocument> {
  if (!isRecord(value) || !exactKeys(value, ['snapshot', 'target', 'reason', 'documentId', 'baseResourceUri']) || !nonEmptyString(value.target) || !nonEmptyString(value.reason) || !nonEmptyString(value.documentId) || !nonEmptyString(value.baseResourceUri)) return failure(path, 'readonly document is invalid')
  const snapshot = decodeRevisionSnapshot(value.snapshot, `${path}.snapshot`)
  return snapshot.ok ? { ok: true, value: { snapshot: snapshot.value, target: value.target, reason: value.reason, documentId: value.documentId, baseResourceUri: value.baseResourceUri } } : snapshot
}

export function decodeTextChanges(value: unknown, path = 'changes'): DecodeResult<readonly TextChange[]> {
  if (!Array.isArray(value)) return failure(path, 'expected an array')
  const changes: TextChange[] = []
  for (let index = 0; index < value.length; index++) {
    const item = value[index]
    if (!isRecord(item) || !exactKeys(item, ['from', 'to', 'insert']) || !integer(item.from) || !integer(item.to) || typeof item.insert !== 'string') return failure(`${path}[${index}]`, 'expected { from, to, insert }')
    changes.push({ from: item.from, to: item.to, insert: item.insert })
  }
  const validation = validateTextChanges(changes)
  return validation.ok ? { ok: true, value: changes } : failure(path, validation.reason)
}

export function decodeEditRequest(value: unknown, path = 'message'): DecodeResult<EditRequest> {
  if (!isRecord(value) || !exactKeys(value, ['type', 'editId', 'target', 'sessionGeneration', 'baseDocumentVersion', 'changes'])) return failure(path, 'edit request keys are invalid')
  if (!nonEmptyString(value.editId) || !isEditDeliveryTarget(value.target) || !integer(value.sessionGeneration) || value.sessionGeneration < 0 || !integer(value.baseDocumentVersion) || value.baseDocumentVersion < 0) return failure(path, 'edit request identity or version is invalid')
  const decoded = decodeTextChanges(value.changes)
  if (!decoded.ok) return decoded
  const request: EditRequest = { editId: value.editId, target: value.target, sessionGeneration: value.sessionGeneration, baseDocumentVersion: value.baseDocumentVersion, changes: decoded.value }
  const validation = validateEditRequest(request)
  return validation.ok ? { ok: true, value: request } : failure(path, validation.reason)
}

function sameTarget(left: EditDeliveryTarget, right: EditDeliveryTarget): boolean {
  return left.kind === right.kind && left.documentId === right.documentId &&
    (left.kind === 'editing' || (right.kind === 'comparison' && left.side === right.side))
}

export function decodeHostDocumentObservation(value: unknown, path = 'observation'): DecodeResult<HostDocumentObservation> {
  if (!isRecord(value) || !exactKeys(value, ['target', 'sessionGeneration', 'documentVersion', 'content', 'contentHash']) || !isEditDeliveryTarget(value.target) || !integer(value.sessionGeneration) || value.sessionGeneration < 0 || !integer(value.documentVersion) || value.documentVersion < 0 || typeof value.content !== 'string' || typeof value.contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(value.contentHash) || value.contentHash !== contentHash(value.content)) return failure(path, 'invalid host document observation')
  return { ok: true, value: { target: value.target, sessionGeneration: value.sessionGeneration, documentVersion: value.documentVersion, content: value.content, contentHash: value.contentHash } }
}

export function decodeVerifiedEditObservation(value: unknown, path: string): DecodeResult<VerifiedEditObservation> {
  if (!isRecord(value) || !exactKeys(value, ['request', 'before', 'after'])) return failure(path, 'invalid verified edit observation')
  const request = decodeEditRequest({ type: 'edit', ...value.request as object }, `${path}.request`)
  if (!request.ok) return request
  const before = decodeHostDocumentObservation(value.before, `${path}.before`)
  if (!before.ok) return before
  const after = decodeHostDocumentObservation(value.after, `${path}.after`)
  if (!after.ok) return after
  if (!sameTarget(before.value.target, request.value.target) || before.value.sessionGeneration !== request.value.sessionGeneration || before.value.documentVersion !== request.value.baseDocumentVersion || !sameTarget(after.value.target, request.value.target) || after.value.sessionGeneration !== request.value.sessionGeneration) return failure(path, 'verified observation identity is invalid')
  return { ok: true, value: { request: request.value, before: before.value, after: after.value } }
}

function decodeEditFailure(value: unknown, path: string): DecodeResult<EditFailure> {
  const kinds = ['base-version-conflict', 'apply-rejected', 'document-mismatch', 'invalid-change', 'observation-mismatch', 'resync-failed'] as const
  if (!isRecord(value) || !exactKeys(value, ['editId', 'target', 'sessionGeneration', 'baseDocumentVersion', 'kind', 'reason'], ['currentDocumentVersion', 'snapshot']) || !nonEmptyString(value.editId) || !isEditDeliveryTarget(value.target) || !integer(value.sessionGeneration) || value.sessionGeneration < 0 || !integer(value.baseDocumentVersion) || value.baseDocumentVersion < 0 || !enumValue(value.kind, kinds) || !nonEmptyString(value.reason)) return failure(path, 'invalid edit failure')
  if (value.currentDocumentVersion !== undefined && (!integer(value.currentDocumentVersion) || value.currentDocumentVersion < 0)) return failure(`${path}.currentDocumentVersion`, 'invalid current document version')
  const snapshot = value.snapshot === undefined ? undefined : decodeHostDocumentObservation(value.snapshot, `${path}.snapshot`)
  if (snapshot && !snapshot.ok) return snapshot
  if (snapshot && (!sameTarget(snapshot.value.target, value.target) || snapshot.value.sessionGeneration !== value.sessionGeneration)) return failure(`${path}.snapshot`, 'failure snapshot identity is invalid')
  return { ok: true, value: { editId: value.editId, target: value.target, sessionGeneration: value.sessionGeneration, baseDocumentVersion: value.baseDocumentVersion, kind: value.kind, reason: value.reason, ...(value.currentDocumentVersion === undefined ? {} : { currentDocumentVersion: value.currentDocumentVersion }), ...(snapshot === undefined ? {} : { snapshot: snapshot.value }), } }
}

export function decodeEditOutcome(value: unknown, path = 'result'): DecodeResult<EditOutcome> {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return failure(path, 'result must contain ok')
  if (value.ok) {
    if (!exactKeys(value, ['ok', 'value'])) return failure(path, 'successful verified edit result is invalid')
    const observation = decodeVerifiedEditObservation(value.value, `${path}.value`)
    return observation.ok ? { ok: true, value: { ok: true, value: observation.value } } : observation
  }
  if (!exactKeys(value, ['ok', 'error'])) return failure(path, 'failed verified edit result is invalid')
  const error = decodeEditFailure(value.error, `${path}.error`)
  return error.ok ? { ok: true, value: { ok: false, error: error.value } } : error
}

export function decodeHostMessage(value: unknown): DecodeResult<HostMessage> {
  if (!isRecord(value) || typeof value.type !== 'string') return failure('message', 'message type is required')
  switch (value.type) {
    case 'host-document-observation': {
      if (!exactKeys(value, ['type', 'observation'])) return failure('message', 'host document observation keys are invalid')
      const observation = decodeHostDocumentObservation(value.observation)
      return observation.ok ? { ok: true, value: { type: 'host-document-observation', observation: observation.value } } : observation
    }
    case 'edit-result': {
      if (!exactKeys(value, ['type', 'result'])) return failure('message', 'edit-result keys are invalid')
      const result = decodeEditOutcome(value.result)
      return result.ok ? { ok: true, value: { type: 'edit-result', result: result.value } } : result
    }
    case 'appearance-change': {
      if (!exactKeys(value, ['type', 'appearance'])) return failure('message', 'appearance-change is invalid')
      const appearance = decodeAppearanceSources(value.appearance)
      return appearance.ok ? { ok: true, value: { type: 'appearance-change', appearance: appearance.value } } : appearance
    }
    case 'configuration-change': {
      if (!exactKeys(value, ['type', 'configuration'])) return failure('message', 'configuration-change is invalid')
      const configuration = decodeResult(value.configuration, decodeEditorConfiguration, 'configuration')
      return configuration.ok ? { ok: true, value: { type: 'configuration-change', configuration: configuration.value } } : configuration
    }
    case 'init': {
      if (!exactKeys(value, ['type', 'documentId', 'content', 'appearance', 'baseResourceUri', 'configuration'], ['documentVersion']) || !nonEmptyString(value.documentId) || typeof value.content !== 'string' || !nonEmptyString(value.baseResourceUri) || (value.documentVersion !== undefined && (!integer(value.documentVersion) || value.documentVersion < 0))) return failure('message', 'init is invalid')
      const appearance = decodeAppearanceSources(value.appearance)
      if (!appearance.ok) return appearance
      const configuration = decodeResult(value.configuration, decodeEditorConfiguration, 'configuration')
      return configuration.ok ? { ok: true, value: { type: 'init', documentId: value.documentId, content: value.content, documentVersion: value.documentVersion, appearance: appearance.value, baseResourceUri: value.baseResourceUri, configuration: configuration.value } } : configuration
    }
    case 'comparison-init': {
      if (!exactKeys(value, ['type', 'result', 'appearance', 'configuration'])) return failure('message', 'comparison-init is invalid')
      const comparison = decodeComparisonResult(value.result, 'result')
      if (!comparison.ok) return comparison
      const appearance = decodeAppearanceSources(value.appearance)
      if (!appearance.ok) return appearance
      const configuration = decodeResult(value.configuration, decodeEditorConfiguration, 'configuration')
      return configuration.ok ? { ok: true, value: { type: 'comparison-init', result: comparison.value, appearance: appearance.value, configuration: configuration.value } } : configuration
    }
    case 'readonly-init': {
      if (!exactKeys(value, ['type', 'document', 'appearance', 'configuration'])) return failure('message', 'readonly-init is invalid')
      const document = decodeReadonly(value.document, 'document')
      if (!document.ok) return document
      const appearance = decodeAppearanceSources(value.appearance)
      if (!appearance.ok) return appearance
      const configuration = decodeResult(value.configuration, decodeEditorConfiguration, 'configuration')
      return configuration.ok ? { ok: true, value: { type: 'readonly-init', document: document.value, appearance: appearance.value, configuration: configuration.value } } : configuration
    }
    case 'comparison-result': {
      if (!exactKeys(value, ['type', 'requestId', 'result']) || !integer(value.requestId) || value.requestId < 0) return failure('message', 'comparison-result is invalid')
      const result = decodeComparisonResult(value.result, 'result')
      return result.ok ? { ok: true, value: { type: 'comparison-result', requestId: value.requestId, result: result.value } } : result
    }
    case 'reveal-target':
      return exactKeys(value, ['type', 'documentId', 'from', 'to', 'source']) && nonEmptyString(value.documentId) && integer(value.from) && integer(value.to) && value.from >= 0 && value.to >= value.from && value.source === 'external' ? { ok: true, value: value as HostMessage } : failure('message', 'reveal-target is invalid')
    default:
      return failure('message', `unknown host message type: ${value.type}`)
  }
}

export function decodeWebviewMessage(value: unknown): DecodeResult<WebviewMessage> {
  if (!isRecord(value) || typeof value.type !== 'string') return failure('message', 'message type is required')
  if (value.type === 'edit') {
    const decoded = decodeEditRequest(value)
    if (!decoded.ok) return decoded
    return { ok: true, value: { type: 'edit', ...decoded.value } }
  }
  switch (value.type) {
    case 'ready': return exactKeys(value, ['type']) ? { ok: true, value: { type: 'ready' } } : failure('message', 'ready is invalid')
    case 'editor-ready': return exactKeys(value, ['type', 'documentIds']) && Array.isArray(value.documentIds) && value.documentIds.length > 0 && value.documentIds.every(id => nonEmptyString(id)) ? { ok: true, value: { type: 'editor-ready', documentIds: value.documentIds } } : failure('message', 'editor-ready is invalid')
    case 'save': return exactKeys(value, ['type']) ? { ok: true, value: { type: 'save' } } : failure('message', 'save is invalid')
    case 'open-link': return exactKeys(value, ['type', 'url']) && nonEmptyString(value.url) ? { ok: true, value: { type: 'open-link', url: value.url } } : failure('message', 'open-link is invalid')
    case 'comparison-request': {
      if (!exactKeys(value, ['type', 'requestId', 'original', 'modified']) || !integer(value.requestId) || value.requestId < 0) return failure('message', 'comparison-request is invalid')
      const original = decodeGitRevision(value.original, 'original')
      if (!original.ok) return original
      const modified = decodeGitRevision(value.modified, 'modified')
      return modified.ok ? { ok: true, value: { type: 'comparison-request', requestId: value.requestId, original: original.value, modified: modified.value } } : modified
    }
    default: return failure('message', `unknown webview message type: ${value.type}`)
  }
}
