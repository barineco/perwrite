import * as vscode from 'vscode'
import {
  appearanceChangeMessage,
  configurationChangeMessage,
  type ComparisonFailure,
  type ComparisonResult,
  type ComparisonSide,
  type GitRevision,
  type HostMessage,
  type ResolvedComparisonSide,
  type ResolvedGitComparison,
  type ResolvedReadonlyDocument,
  type RevealCommandInput,
  type RevealCommandResult,
  type ResolvedGitRevision,
  type RevisionSnapshot,
  type ResolveActiveTokenThemeOutput,
  type TokenThemeData,
  type WebviewMessage,
} from './protocol'
import type { AppearanceHostSources } from './appearance-profile'
import type { Result } from './protocol'
import { isEditorConfigurationChange, readAppearanceSettings, validateEditorConfiguration } from './settings-resolver'
import { observeDocument, applyWorkspaceEditWithObservation } from './editor-adapter'
import { contentHash } from './protocol'
import { DocumentEditQueue } from './document-edit-queue'
import { createEditorSession, recordHostDocumentObservation, recordFailure, recordVerifiedEditObservation, requestEdit, type EditorSessionState, type EditorSessionEffect } from './editor-session'
import { decodeWebviewMessage } from './message-validation'
import { createWebviewHtml } from '../webview/html-adapter'
import {
  buildCommitEditorInitialization,
  decideEditorInitialization,
} from './editor-initialization'
import {
  createGitComparison,
  readCommitInitializationSnapshots,
  readRevisionSnapshot,
  resolveUriComparison,
  revisionLabel,
  type GitExtensionProvider,
} from './git-source'

function documentVersionOf(document: vscode.TextDocument): number {
  return typeof document.version === 'number' ? document.version : 0
}

function isGitRevision(value: unknown): value is GitRevision {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<GitRevision>
  return candidate.kind === 'working-tree' || candidate.kind === 'index' ||
    (candidate.kind === 'commit' && typeof candidate.ref === 'string' && candidate.ref.length > 0)
}

function isRevealCommandInput(value: unknown): value is RevealCommandInput {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<RevealCommandInput>
  return candidate.uri instanceof vscode.Uri && candidate.range instanceof vscode.Range &&
    (candidate.revision === undefined || isGitRevision(candidate.revision))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every(key => allowed.has(key))
}

function isTokenThemeData(value: unknown): value is TokenThemeData {
  if (!isRecord(value) || !hasOnlyKeys(value, ['name', 'type', 'tokenColors', 'semanticTokenColors', 'semanticHighlighting'])) return false
  return typeof value.name === 'string' && typeof value.type === 'string' && Array.isArray(value.tokenColors) &&
    isRecord(value.semanticTokenColors) && (value.semanticHighlighting === undefined || typeof value.semanticHighlighting === 'boolean')
}

function isTokenThemeResult(value: unknown): value is Result<TokenThemeData> {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false
  if (value.ok) return hasOnlyKeys(value, ['ok', 'value']) && isTokenThemeData(value.value)
  return hasOnlyKeys(value, ['ok', 'error']) && typeof value.error === 'string'
}

function isResolveActiveTokenThemeOutput(value: unknown): value is ResolveActiveTokenThemeOutput {
  return isRecord(value) && typeof value.generation === 'number' && Number.isFinite(value.generation) &&
    hasOnlyKeys(value, ['generation', 'result']) && isTokenThemeResult(value.result)
}

function commandFailure(error: unknown): Result<TokenThemeData> {
  return { ok: false, error: `Token theme command failed: ${error instanceof Error ? error.message : String(error)}` }
}

function validateRange(range: vscode.Range): boolean {
  return range.start.line >= 0 && range.start.character >= 0 && range.end.line >= 0 && range.end.character >= 0 &&
    (range.start.line < range.end.line || (range.start.line === range.end.line && range.start.character <= range.end.character))
}

function sameResolvedRevision(left: ResolvedGitRevision, right: ResolvedGitRevision): boolean {
  return left.kind === 'commit' && right.kind === 'commit' ? left.fullHash === right.fullHash : left.kind === right.kind
}

function editableSideForSnapshots(original: RevisionSnapshot, modified: RevisionSnapshot): ComparisonSide | null {
  return original.provenance.kind === 'working-tree' ? 'original' : modified.provenance.kind === 'working-tree' ? 'modified' : null
}

function comparisonSideForDocumentChange(
  comparison: ResolvedGitComparison,
  changedDocumentUri: string,
): ComparisonSide | null {
  const editableSide = comparison.editableSide
  if (editableSide && comparison[editableSide].snapshot.physicalUri === changedDocumentUri) return editableSide
  if (editableSide) return null
  const matches = (['original', 'modified'] as const).filter(
    side => comparison[side].snapshot.physicalUri === changedDocumentUri,
  )
  return matches.length === 1 ? matches[0] : null
}

/** Mirrors TextDocument's UTF-16 line coordinates for immutable revision text. */
function offsetInContent(content: string, position: vscode.Position): number | null {
  const lines = content.split('\n')
  if (position.line >= lines.length) return null
  // TextDocument line text excludes the CR in CRLF, while offsets retain it.
  const line = lines[position.line].endsWith('\r') ? lines[position.line].slice(0, -1) : lines[position.line]
  if (position.character > line.length) return null
  let offset = 0
  for (let index = 0; index < position.line; index++) offset += lines[index].length + 1
  return offset + position.character
}

function offsetsForContent(content: string, range: vscode.Range): { readonly from: number; readonly to: number } | null {
  const from = offsetInContent(content, range.start)
  const to = offsetInContent(content, range.end)
  return from === null || to === null ? null : { from, to }
}

export const APPEARANCE_CONFIGURATION_IDS = [
  'editor.fontFamily', 'editor.fontSize',
  'perwrite.lineHeight', 'perwrite.editorWidth',
  'perwrite.heading1Scale', 'perwrite.heading2Scale', 'perwrite.heading3Scale',
  'perwrite.heading4Scale', 'perwrite.heading5Scale', 'perwrite.heading6Scale',
  'perwrite.heading1LineHeight', 'perwrite.heading2LineHeight', 'perwrite.heading3LineHeight',
  'perwrite.heading4LineHeight', 'perwrite.heading5LineHeight', 'perwrite.heading6LineHeight',
  'perwrite.contentPadding', 'perwrite.blockPadding', 'perwrite.gutterGap',
  'perwrite.mathBlockPadding',
  'perwrite.tableCellBlockPadding', 'perwrite.tableCellInlinePadding', 'perwrite.tableWidgetBlockPadding',
  'perwrite.mermaidBlockPadding',
] as const


export function isAppearanceConfigurationChange(affectsConfiguration: (id: string) => boolean): boolean {
  return APPEARANCE_CONFIGURATION_IDS.some(affectsConfiguration)
}

export interface AppearanceChangeSubscriptions<TDisposable> {
  readonly onThemeChange: (listener: () => void) => TDisposable
  readonly onConfigurationChange: (listener: (affectsConfiguration: (id: string) => boolean) => void) => TDisposable
}

export function subscribeAppearanceChanges<TDisposable>(
  subscriptions: AppearanceChangeSubscriptions<TDisposable>,
  sendAppearance: () => Promise<void>,
): readonly [TDisposable, TDisposable] {
  const theme = subscriptions.onThemeChange(() => { void sendAppearance() })
  const configuration = subscriptions.onConfigurationChange((affectsConfiguration) => {
    if (isAppearanceConfigurationChange(affectsConfiguration)) void sendAppearance()
  })
  return [theme, configuration]
}

interface RevealTargetDocument {
  readonly uri: vscode.Uri
  readonly revision: ResolvedGitRevision
  readonly content: string
}

interface EditorSession {
  readonly webview: vscode.Webview
  readonly documents: Map<string, RevealTargetDocument>
  readonly targets: Map<string, RevealTargetDocument>
  lifecycle: 'panel-registered' | 'webview-ready' | 'editor-ready' | 'disposed'
  latestComparisonRequest: number
  editorStates: Map<string, EditorSessionState>
}

function editTargetKey(target: import('./protocol').EditDeliveryTarget, sessionGeneration: number): string {
  return `${sessionGeneration}:${target.kind}:${target.documentId}:${target.kind === 'comparison' ? target.side : ''}`
}

export class PerwriteEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'perwrite.markdownEditor'

  constructor(private readonly context: vscode.ExtensionContext) {
    this.currentEditorConfiguration = this.readEditorConfiguration()
    const configurationSubscription = vscode.workspace.onDidChangeConfiguration(event => {
      if (!isEditorConfigurationChange(id => event.affectsConfiguration(id))) return
      this.configurationGeneration++
      this.currentEditorConfiguration = this.readEditorConfiguration()
      const message = configurationChangeMessage(this.currentEditorConfiguration)
      for (const session of this.sessions) {
        if (session.lifecycle !== 'disposed') void session.webview.postMessage(message)
      }
    })
    context.subscriptions.push(configurationSubscription)
  }

  private appearanceVersion = 0
  private configurationGeneration = 0
  private currentEditorConfiguration: ReturnType<typeof validateEditorConfiguration>
  private readonly sessions = new Set<EditorSession>()
  private readonly documentEdits = new DocumentEditQueue()

  public async revealTarget(...args: unknown[]): Promise<RevealCommandResult> {
    try {
      if (args.length !== 1 || !isRevealCommandInput(args[0])) return { status: 'invalid-arguments' }
      const input = args[0]
      if (!validateRange(input.range)) return { status: 'invalid-range' }
      const resolved = input.revision ? await this.resolveRevealRevision(input.uri, input.revision) : { ok: true as const, value: { kind: 'working-tree' as const } }
      if (!resolved.ok) return { status: resolved.status }
      const revision = resolved.value
      const matches = (target: RevealTargetDocument) =>
        target.uri.toString() === input.uri.toString() && sameResolvedRevision(target.revision, revision)
      const candidates = [...this.sessions].filter(session => session.lifecycle === 'editor-ready')
        .flatMap(session => [...session.documents].filter(([, target]) => matches(target))
          .map(([documentId, target]) => ({ session, documentId, target })))
      if (candidates.length > 1) return { status: 'ambiguous-target' }
      if (candidates.length === 0) {
        const waiting = [...this.sessions].some(session =>
          (session.lifecycle === 'panel-registered' || session.lifecycle === 'webview-ready') &&
          [...session.targets.values()].some(matches),
        )
        return { status: waiting ? 'editor-not-ready' : 'target-not-found' }
      }
      const target = candidates[0].target
      const offsets = target.revision.kind === 'working-tree'
        ? await this.offsetsInWorkingDocument(input.uri, input.range)
        : offsetsForContent(target.content, input.range)
      if (!offsets) return { status: 'invalid-range' }
      let delivered: boolean
      try {
        delivered = await candidates[0].session.webview.postMessage({
          type: 'reveal-target', documentId: candidates[0].documentId, from: offsets.from, to: offsets.to, source: 'external',
        })
      } catch {
        return { status: 'post-message-failed' }
      }
      return delivered
        ? { status: 'sent', uri: input.uri, ...(input.revision ? { revision: input.revision } : {}), from: offsets.from, to: offsets.to }
        : { status: 'post-message-failed' }
    } catch {
      return { status: 'internal-error' }
    }
  }

  private async offsetsInWorkingDocument(uri: vscode.Uri, range: vscode.Range): Promise<{ readonly from: number; readonly to: number } | null> {
    const document = await vscode.workspace.openTextDocument(uri)
    if (!document.validateRange(range).isEqual(range)) return null
    return { from: document.offsetAt(range.start), to: document.offsetAt(range.end) }
  }

  private async resolveRevealRevision(uri: vscode.Uri, revision: GitRevision): Promise<
    | { readonly ok: true; readonly value: ResolvedGitRevision }
    | { readonly ok: false; readonly status: 'revision-not-found' | 'internal-error' }
  > {
    if (revision.kind !== 'commit') return { ok: true, value: { kind: revision.kind } }
    const resolved = await readRevisionSnapshot(this.gitProvider(), uri, revision, 'original')
    if (!resolved.ok) return { ok: false, status: resolved.error.kind === 'revision-missing' ? 'revision-not-found' : 'internal-error' }
    return { ok: true, value: resolved.value.revisionIdentity }
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const initial = await this.resolveDocumentInitialization(document, webviewPanel.webview)
    return this.resolveEditorSession(
      document,
      webviewPanel,
      token,
      initial.kind === 'comparison' ? initial.result : null,
      initial.kind === 'readonly' ? initial.document : null,
    )
  }

  public async resolveCustomTextEditorInlineDiff(
    documents: vscode.CustomEditorDiffDocuments,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const initialComparison = await this.resolveProposedComparison(documents, webviewPanel.webview)
    const editable = initialComparison.ok && initialComparison.value.editableSide
      ? documents[initialComparison.value.editableSide]
      : documents.modified
    return this.resolveEditorSession(editable, webviewPanel, token, initialComparison, null)
  }

  private async resolveEditorSession(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
    initialComparison: ComparisonResult<ResolvedGitComparison> | null,
    initialReadonly: ResolvedReadonlyDocument | null,
  ): Promise<void> {
    const html = createWebviewHtml({ extensionUri: this.context.extensionUri, documentUri: document.uri, webview: webviewPanel.webview })
    webviewPanel.webview.options = { enableScripts: true, localResourceRoots: html.localResourceRoots }
    webviewPanel.webview.html = html.html

    const documentId = document.uri.toString()
    const session: EditorSession = {
      webview: webviewPanel.webview,
      documents: new Map(),
      targets: new Map(),
      lifecycle: 'panel-registered',
      latestComparisonRequest: 0,
      editorStates: new Map(),
    }
    session.editorStates.set(editTargetKey({ kind: 'editing', documentId }, 0), createEditorSession(
      { kind: 'editing', documentId }, 0, document.getText(), documentVersionOf(document), contentHash(document.getText()),
    ))
    const initialCandidates = initialReadonly
      ? [initialReadonly]
      : initialComparison?.ok
        ? [initialComparison.value.original, initialComparison.value.modified]
        : [{ documentId, label: 'Working Tree', baseResourceUri: this.baseResourceUri(webviewPanel.webview, document.uri.fsPath), snapshot: this.workingTreeSnapshot(document) }]
    for (const candidate of initialCandidates) {
      // The physical URI remains separate from the opaque transport documentId.
      session.targets.set(candidate.documentId, {
        uri: vscode.Uri.parse(candidate.snapshot.physicalUri), revision: candidate.snapshot.revisionIdentity, content: candidate.snapshot.content,
      })
    }
    this.sessions.add(session)
    let activeComparison = initialComparison?.ok ? initialComparison.value : null

    const postEditOutcome = (outcome: import('./protocol').EditOutcome): void => {
      void webviewPanel.webview.postMessage({ type: 'edit-result', result: outcome })
    }
    const executeEditorSessionEffects = async (target: vscode.TextDocument, stateKey: string, effects: readonly EditorSessionEffect[]): Promise<void> => {
      for (const effect of effects) {
        if (effect.type === 'send-success') postEditOutcome({ ok: true, value: effect.observation })
        else if (effect.type === 'send-failure') postEditOutcome({ ok: false, error: effect.failure })
        else if (effect.type === 'accepted-host-document-observation') void webviewPanel.webview.postMessage({ type: 'host-document-observation', observation: effect.observation })
        else {
          const applied = await applyWorkspaceEditWithObservation(target, effect.request)
          const transition = applied.ok
            ? recordVerifiedEditObservation(session.editorStates.get(stateKey)!, applied.value)
            : recordFailure(session.editorStates.get(stateKey)!, applied.error)
          session.editorStates.set(stateKey, transition.state)
          await executeEditorSessionEffects(target, stateKey, transition.effects)
        }
      }
    }
    const applyRequest = (target: vscode.TextDocument, request: import('./protocol').EditRequest): Promise<void> => {
      const documentKey = target.uri.toString()
      return this.documentEdits.run(documentKey, async () => {
        const stateKey = editTargetKey(request.target, request.sessionGeneration)
        const currentState = session.editorStates.get(stateKey) ?? createEditorSession(request.target, request.sessionGeneration, target.getText(), documentVersionOf(target), contentHash(target.getText()))
        const transition = requestEdit(currentState, request)
        session.editorStates.set(stateKey, transition.state)
        await executeEditorSessionEffects(target, stateKey, transition.effects)
      })
    }

    const msgSub = webviewPanel.webview.onDidReceiveMessage((raw: unknown) => {
      const decoded = decodeWebviewMessage(raw)
      if (!decoded.ok) return
      const msg = decoded.value
      switch (msg.type) {
        case 'ready':
          session.lifecycle = 'webview-ready'
          if (initialReadonly) {
            void this.postReadonlyInit(webviewPanel.webview, initialReadonly)
          } else if (initialComparison) {
            void this.postComparisonInit(webviewPanel.webview, initialComparison)
          } else {
            void this.postInit(webviewPanel.webview, document)
          }
          break
        case 'editor-ready': {
          session.documents.clear()
          for (const documentId of msg.documentIds) {
            const target = session.targets.get(documentId)
            if (target) session.documents.set(documentId, target)
          }
          session.lifecycle = 'editor-ready'
          break
        }
        case 'edit':
          if (initialReadonly) break
          if (msg.target.kind === 'editing') {
            if (activeComparison || msg.target.documentId !== documentId) break
            void applyRequest(document, msg)
            break
          }
          if (!activeComparison || activeComparison.editableSide !== msg.target.side) break
          if (activeComparison[msg.target.side].documentId !== msg.target.documentId) break
          void this.resolveTextDocument(activeComparison[msg.target.side].snapshot.physicalUri).then(target => {
            if (!target) return
            void applyRequest(target, msg)
          })
          break
        case 'save':
          if (initialReadonly) break
          if (activeComparison?.editableSide) {
            void this.resolveTextDocument(activeComparison[activeComparison.editableSide].snapshot.physicalUri)
              .then(target => target?.save())
          } else if (!activeComparison) {
            document.save()
          }
          break
        case 'open-link':
          this.openLink(msg.url, document)
          break
        case 'comparison-request':
          if (initialReadonly) break
          session.latestComparisonRequest = Math.max(session.latestComparisonRequest, msg.requestId)
          void this.resolveRequestedComparison(webviewPanel.webview, document, msg.requestId, msg.original, msg.modified)
            .then(result => {
              // Only the newest asynchronous request may update the active comparison.
              if (msg.requestId !== session.latestComparisonRequest || session.lifecycle === 'disposed') return
              if (result.ok) {
                activeComparison = result.value
                session.documents.clear()
                session.lifecycle = 'webview-ready'
                session.targets.clear()
                for (const candidate of [result.value.original, result.value.modified]) {
                  session.targets.set(candidate.documentId, {
                    uri: vscode.Uri.parse(candidate.snapshot.physicalUri),
                    revision: candidate.snapshot.revisionIdentity,
                    content: candidate.snapshot.content,
                  })
                }
                session.editorStates.clear()
                for (const side of ['original', 'modified'] as const) {
                  const target = { kind: 'comparison' as const, documentId: result.value[side].documentId, side }
                  const snapshot = result.value[side].snapshot
                  session.editorStates.set(editTargetKey(target, 1), createEditorSession(target, 1, snapshot.content, snapshot.provenance.documentVersion, snapshot.contentHash))
                }
              }
              const response: HostMessage = { type: 'comparison-result', requestId: msg.requestId, result }
              void webviewPanel.webview.postMessage(response)
            })
          break
      }
    })

    const recordChangedDocument = (changedDocument: vscode.TextDocument): void => {
      if (initialReadonly) return
      const changedDocumentUri = changedDocument.uri.toString()
      const target = activeComparison
        ? (() => {
          const side = comparisonSideForDocumentChange(activeComparison, changedDocumentUri)
          return side ? { kind: 'comparison' as const, documentId: activeComparison[side].documentId, side } : null
        })()
        : changedDocumentUri === documentId ? { kind: 'editing' as const, documentId } : null
      if (!target) return
      for (const [stateKey, state] of session.editorStates) {
        const matches = target.kind === 'comparison'
          ? state.snapshot.target.kind === 'comparison' && state.snapshot.target.documentId === target.documentId && state.snapshot.target.side === target.side
          : state.snapshot.target.kind === 'editing' && state.snapshot.target.documentId === target.documentId
        if (!matches) continue
        const observation = observeDocument(changedDocument, state.snapshot.target, state.snapshot.sessionGeneration)
        const transition = recordHostDocumentObservation(state, observation)
        session.editorStates.set(stateKey, transition.state)
        void executeEditorSessionEffects(changedDocument, stateKey, transition.effects)
      }
    }
    const docSub = vscode.workspace.onDidChangeTextDocument(event => {
      const changedDocument = event.document as vscode.TextDocument
      if (typeof changedDocument.version !== 'number') return
      recordChangedDocument(changedDocument)
    })

    const [themeSub, appearanceConfigurationSub] = subscribeAppearanceChanges({
      onThemeChange: listener => vscode.window.onDidChangeActiveColorTheme(listener),
      onConfigurationChange: listener => vscode.workspace.onDidChangeConfiguration(
        event => listener(id => event.affectsConfiguration(id)),
      ),
    }, () => this.postAppearance(webviewPanel.webview))
    webviewPanel.onDidDispose(() => {
      session.lifecycle = 'disposed'
      session.documents.clear()
      session.targets.clear()
      this.sessions.delete(session)
      msgSub.dispose()
      docSub.dispose()
      themeSub.dispose()
      appearanceConfigurationSub.dispose()
    })
  }

  private async postReadonlyInit(webview: vscode.Webview, document: ResolvedReadonlyDocument): Promise<void> {
    const appearance = await this.resolveCurrentAppearance()
    const msg: HostMessage = {
      type: 'readonly-init',
      document,
      appearance,
      configuration: this.resolveEditorConfiguration(),
    }
    await webview.postMessage(msg)
  }

  private async postComparisonInit(webview: vscode.Webview, result: ComparisonResult<ResolvedGitComparison>): Promise<void> {
    const appearance = await this.resolveCurrentAppearance()
    const msg: HostMessage = {
      type: 'comparison-init',
      result,
      appearance,
      configuration: this.resolveEditorConfiguration(),
    }
    await webview.postMessage(msg)
  }

  private async postInit(webview: vscode.Webview, document: vscode.TextDocument): Promise<void> {
    const appearance = await this.resolveCurrentAppearance()
    const docDir = vscode.Uri.joinPath(document.uri, '..')
    const baseResourceUri = webview.asWebviewUri(docDir).toString()
    const msg: HostMessage = {
      type: 'init',
      documentId: document.uri.toString(),
      content: document.getText(),
      documentVersion: typeof document.version === 'number' ? document.version : 0,
      appearance,
      baseResourceUri,
      configuration: this.resolveEditorConfiguration(),
    }
    await webview.postMessage(msg)
  }

  private async resolveDocumentInitialization(document: vscode.TextDocument, webview: vscode.Webview): Promise<{ readonly kind: 'standard' } | { readonly kind: 'comparison'; readonly result: ComparisonResult<ResolvedGitComparison> } | { readonly kind: 'readonly'; readonly document: ResolvedReadonlyDocument }> {
    const decision = decideEditorInitialization(document.uri)
    if (!decision.ok) return { kind: 'comparison', result: decision }
    if (decision.value.kind === 'standard') return { kind: 'standard' }
    const physicalUri = vscode.Uri.file(decision.value.actualFsPath)
    const snapshots = await readCommitInitializationSnapshots(this.gitProvider(), physicalUri, decision.value.ref)
    if (!snapshots.ok) return { kind: 'comparison', result: snapshots }
    return buildCommitEditorInitialization(snapshots.value, this.baseResourceUri(webview, physicalUri.fsPath))
  }

  private gitProvider(): GitExtensionProvider {
    return {
      getExtension: id => vscode.extensions.getExtension(id) as ReturnType<GitExtensionProvider['getExtension']>,
    }
  }

  private comparisonFailure(
    kind: ComparisonFailure['kind'],
    side: ComparisonSide | null,
    target: string,
    detail: string,
  ): ComparisonResult<never> {
    return { ok: false, error: { kind, side, target, detail } }
  }

  private baseResourceUri(webview: vscode.Webview, fsPath: string): string {
    return webview.asWebviewUri(vscode.Uri.joinPath(vscode.Uri.file(fsPath), '..')).toString()
  }

  private workingTreeSnapshot(document: vscode.TextDocument): RevisionSnapshot {
    const content = document.getText()
    return { physicalUri: document.uri.toString(), revisionIdentity: { kind: 'working-tree' }, content, contentHash: contentHash(content), provenance: { kind: 'working-tree', documentVersion: documentVersionOf(document) } }
  }

  private resolvedSide(snapshot: RevisionSnapshot, documentId: string, baseResourceUri: string): ResolvedComparisonSide {
    return { snapshot, label: revisionLabel(snapshot.provenance.kind === 'commit' ? { kind: 'commit', ref: snapshot.provenance.requestedRef } : { kind: snapshot.provenance.kind }), documentId, baseResourceUri }
  }

  private async resolveProposedComparison(documents: vscode.CustomEditorDiffDocuments, webview: vscode.Webview): Promise<ComparisonResult<ResolvedGitComparison>> {
    const resolved = resolveUriComparison(documents.original.uri, documents.modified.uri)
    if (!resolved.ok) return resolved
    const physicalUri = vscode.Uri.file(resolved.value.actualFsPath)
    const read = (revision: GitRevision, side: ComparisonSide, document: vscode.TextDocument) => readRevisionSnapshot(this.gitProvider(), physicalUri, revision, side, revision.kind === 'working-tree' ? { content: document.getText(), documentVersion: documentVersionOf(document) } : undefined)
    const original = await read(resolved.value.comparison.original, 'original', documents.original); if (!original.ok) return original
    const modified = await read(resolved.value.comparison.modified, 'modified', documents.modified); if (!modified.ok) return modified
    if (sameResolvedRevision(original.value.revisionIdentity, modified.value.revisionIdentity)) return this.comparisonFailure('comparison-unresolved', null, revisionLabel(resolved.value.comparison.original), 'Comparison sides use the same revision')
    const base = this.baseResourceUri(webview, physicalUri.fsPath)
    return { ok: true, value: { identity: `${documents.original.uri.toString()}::${documents.modified.uri.toString()}`, original: this.resolvedSide(original.value, documents.original.uri.toString(), base), modified: this.resolvedSide(modified.value, documents.modified.uri.toString(), base), editableSide: editableSideForSnapshots(original.value, modified.value) } }
  }

  private async resolveTextDocument(documentId: string): Promise<vscode.TextDocument | null> {
    const existing = vscode.workspace.textDocuments.find(candidate => candidate.uri.toString() === documentId)
    if (existing) return existing
    try {
      return await vscode.workspace.openTextDocument(vscode.Uri.parse(documentId))
    } catch {
      return null
    }
  }

  private async resolveRequestedComparison(webview: vscode.Webview, workingDocument: vscode.TextDocument, requestId: number, original: GitRevision, modified: GitRevision): Promise<ComparisonResult<ResolvedGitComparison>> {
    const physicalUri = workingDocument.uri.scheme === 'file' ? workingDocument.uri : vscode.Uri.file(workingDocument.uri.fsPath)
    const read = (revision: GitRevision, side: ComparisonSide) => readRevisionSnapshot(this.gitProvider(), physicalUri, revision, side, revision.kind === 'working-tree' ? { content: workingDocument.getText(), documentVersion: documentVersionOf(workingDocument) } : undefined)
    const left = await read(original, 'original'); if (!left.ok) return left
    const right = await read(modified, 'modified'); if (!right.ok) return right
    if (sameResolvedRevision(left.value.revisionIdentity, right.value.revisionIdentity)) return this.comparisonFailure('comparison-unresolved', null, revisionLabel(original), 'Comparison sides use the same revision')
    const base = this.baseResourceUri(webview, physicalUri.fsPath)
    const identifier = (snapshot: RevisionSnapshot) => snapshot.revisionIdentity.kind === 'commit' ? snapshot.revisionIdentity.fullHash : snapshot.revisionIdentity.kind
    return { ok: true, value: { identity: `${requestId}:${physicalUri.toString()}:${identifier(left.value)}:${identifier(right.value)}`, original: this.resolvedSide(left.value, `${physicalUri.toString()}?revision=${encodeURIComponent(identifier(left.value))}`, base), modified: this.resolvedSide(right.value, `${physicalUri.toString()}?revision=${encodeURIComponent(identifier(right.value))}`, base), editableSide: editableSideForSnapshots(left.value, right.value) } }
  }

  private async postAppearance(webview: vscode.Webview): Promise<void> {
    const msg = appearanceChangeMessage(await this.resolveCurrentAppearance())
    await webview.postMessage(msg)
  }

  private resolveEditorConfiguration() {
    return this.currentEditorConfiguration
  }

  private readEditorConfiguration() {
    const config = vscode.workspace.getConfiguration('perwrite')
    return validateEditorConfiguration({
      defaultViewMode: config.get('defaultViewMode'),
      mermaidLayout: config.get('mermaidLayout'),
      mermaidMaxEdges: config.get('mermaidMaxEdges'),
      mermaidPanStep: config.get('mermaidPanStep'),
      mermaidZoomStep: config.get('mermaidZoomStep'),
      texRendering: config.get('texRendering'),
      codeBlockWrap: config.get('codeBlockWrap'),
    }, this.configurationGeneration)
  }

  private async resolveCurrentAppearance(): Promise<AppearanceHostSources> {
    const version = ++this.appearanceVersion
    const settings = readAppearanceSettings({
      get(section) {
        const separator = section.indexOf('.')
        return vscode.workspace.getConfiguration(section.slice(0, separator)).get(section.slice(separator + 1))
      },
    })
    const fontFamily = vscode.workspace.getConfiguration('editor').get<unknown>('fontFamily')
    const fontSize = vscode.workspace.getConfiguration('editor').get<unknown>('fontSize')
    let tokenTheme: Result<TokenThemeData>
    try {
      const output = await vscode.commands.executeCommand<unknown>('_perwrite.resolveActiveTokenTheme', { generation: version })
      if (!isResolveActiveTokenThemeOutput(output)) {
        tokenTheme = { ok: false, error: 'Token theme command returned an invalid response' }
      } else if (output.generation !== version) {
        tokenTheme = { ok: false, error: `Token theme response generation ${output.generation} does not match request generation ${version}` }
      } else {
        tokenTheme = output.result
      }
    } catch (error) {
      tokenTheme = commandFailure(error)
    }
    return {
      version,
      settings,
      fallbackFont: {
        family: typeof fontFamily === 'string' ? fontFamily : undefined,
        size: typeof fontSize === 'number' ? fontSize : undefined,
      },
      tokenTheme,
    }
  }

  private async openLink(url: string, document: vscode.TextDocument): Promise<void> {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      vscode.env.openExternal(vscode.Uri.parse(url))
      return
    }

    const docDir = vscode.Uri.joinPath(document.uri, '..')
    const path = url.replace(/#.*$/, '')
    if (!path) return

    const targetUri = vscode.Uri.joinPath(docDir, path)
    try {
      await vscode.workspace.fs.stat(targetUri)
      await vscode.commands.executeCommand('vscode.open', targetUri)
    } catch {
      vscode.window.showWarningMessage(`File not found: ${path}`)
    }
  }


}
