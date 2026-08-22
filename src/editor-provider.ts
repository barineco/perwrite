import * as vscode from 'vscode'
import { appearanceChangeMessage, configurationChangeMessage, contentHash, type HostMessage, type RevealCommandInput, type RevealCommandResult, type Result, type TokenThemeData } from './protocol'
import type { AppearanceHostSources } from './appearance-profile'
import { isEditorConfigurationChange, readAppearanceSettings, validateEditorConfiguration } from './settings-resolver'
import { decodeWebviewMessage } from './message-validation'
import { createWebviewHtml } from '../webview/html-adapter'
import { headingTarget, resolveLink } from './link-resolution'
import { PerwriteDocument } from './perwrite-document'
import { readRevisionSnapshot, revisionLabel, editableSideFor, type GitExtensionProvider } from './git-source'
import type { ComparisonResult, GitRevision, ResolvedGitComparison, RevisionSnapshot } from './protocol'

export const APPEARANCE_CONFIGURATION_IDS = [
  'editor.fontFamily', 'editor.fontSize', 'perwrite.lineHeight', 'perwrite.editorWidth',
  'perwrite.heading1Scale', 'perwrite.heading2Scale', 'perwrite.heading3Scale', 'perwrite.heading4Scale', 'perwrite.heading5Scale', 'perwrite.heading6Scale',
  'perwrite.heading1LineHeight', 'perwrite.heading2LineHeight', 'perwrite.heading3LineHeight', 'perwrite.heading4LineHeight', 'perwrite.heading5LineHeight', 'perwrite.heading6LineHeight',
  'perwrite.contentPadding', 'perwrite.blockPadding', 'perwrite.gutterGap', 'perwrite.mathBlockPadding', 'perwrite.tableCellBlockPadding', 'perwrite.tableCellInlinePadding', 'perwrite.tableWidgetBlockPadding', 'perwrite.mermaidBlockPadding',
] as const

export function isAppearanceConfigurationChange(affectsConfiguration: (id: string) => boolean): boolean { return APPEARANCE_CONFIGURATION_IDS.some(affectsConfiguration) }
export function subscribeAppearanceChanges<T>(subscriptions: { readonly onThemeChange: (listener: () => void) => T; readonly onConfigurationChange: (listener: (affectsConfiguration: (id: string) => boolean) => void) => T }, sendAppearance: () => Promise<void>): readonly [T, T] {
  return [subscriptions.onThemeChange(() => { void sendAppearance() }), subscriptions.onConfigurationChange(affects => { if (isAppearanceConfigurationChange(affects)) void sendAppearance() })]
}

class EventEmitter<T> {
  private readonly listeners = new Set<(value: T) => unknown>()
  readonly event: vscode.Event<T> = listener => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) } }
  fire(value: T): void { for (const listener of this.listeners) listener(value) }
}

interface EditorSession {
  readonly panel: vscode.WebviewPanel
  readonly document: PerwriteDocument
  readonly dispose: vscode.Disposable[]
  ready: boolean
}

function isRevealCommandInput(value: unknown): value is RevealCommandInput {
  if (typeof value !== 'object' || value === null) return false
  const input = value as Partial<RevealCommandInput>
  return input.uri instanceof vscode.Uri && input.range instanceof vscode.Range
}

export class PerwriteEditorProvider implements vscode.CustomEditorProvider<PerwriteDocument> {
  static readonly viewType = 'perwrite.markdownEditor'
  private readonly customDocumentChanged = new EventEmitter<vscode.CustomDocumentEditEvent<PerwriteDocument>>()
  readonly onDidChangeCustomDocument = this.customDocumentChanged.event
  private readonly sessions = new Set<EditorSession>()
  private readonly documents = new Map<string, PerwriteDocument>()
  private appearanceVersion = 0
  private configurationGeneration = 0
  private currentEditorConfiguration: ReturnType<typeof validateEditorConfiguration>

  constructor(private readonly context: vscode.ExtensionContext) {
    this.currentEditorConfiguration = this.readEditorConfiguration()
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
      if (!isEditorConfigurationChange(id => event.affectsConfiguration(id))) return
      this.configurationGeneration++
      this.currentEditorConfiguration = this.readEditorConfiguration()
      for (const session of this.sessions) void session.panel.webview.postMessage(configurationChangeMessage(this.currentEditorConfiguration))
    }))
  }

  async openCustomDocument(uri: vscode.Uri, openContext: { readonly backupId?: string }): Promise<PerwriteDocument> {
    const document = await PerwriteDocument.open(uri, openContext.backupId)
    this.documents.set(uri.toString(), document)
    document.onDidChange(event => this.customDocumentChanged.fire(event))
    return document
  }

  async resolveCustomEditor(document: PerwriteDocument, panel: vscode.WebviewPanel): Promise<void> {
    const html = createWebviewHtml({ extensionUri: this.context.extensionUri, documentUri: document.uri, webview: panel.webview })
    panel.webview.options = { enableScripts: true, localResourceRoots: html.localResourceRoots }
    panel.webview.html = html.html
    const session: EditorSession = { panel, document, ready: false, dispose: [] }
    this.sessions.add(session)
    const postSnapshot = async (): Promise<void> => {
      if (!session.ready) return
      const state = document.documentState
      await panel.webview.postMessage({ type: 'draft-snapshot', uri: state.uri, content: state.draftSnapshot.content, contentHash: state.draftSnapshot.contentHash, selection: state.draftSnapshot.selection, generation: state.generation, dirty: document.isDirty, externalChange: state.externalChange?.content ?? null })
    }
    const postInitial = async (): Promise<void> => {
      const state = document.documentState
      const appearance = await this.resolveCurrentAppearance()
      await panel.webview.postMessage({ type: 'init', documentId: document.uri.toString(), content: state.draftSnapshot.content, documentVersion: state.generation, appearance, baseResourceUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(document.uri, '..')).toString(), configuration: this.currentEditorConfiguration })
      await postSnapshot()
    }
    session.dispose.push(document.onDidChangeState(() => { void postSnapshot() }))
    session.dispose.push(panel.webview.onDidReceiveMessage(raw => {
      const decoded = decodeWebviewMessage(raw)
      if (!decoded.ok) return
      const message = decoded.value
      if (message.type === 'ready') { session.ready = true; void postInitial(); return }
      if (message.type === 'draft-edit') { if (!document.applyEdit(message)) void postSnapshot(); return }
      if (message.type === 'comparison-request') void this.resolveComparison(document, panel.webview, message.requestId, message.original, message.modified)
      if (message.type === 'activate-link') void this.activateLink(document, panel.webview, message.destination)
    }))
    panel.onDidDispose(() => { for (const disposable of session.dispose) disposable.dispose(); this.sessions.delete(session) })
  }

  async saveCustomDocument(document: PerwriteDocument): Promise<void> {
    const failure = await document.save()
    if (failure) throw new Error(`Cannot save Perwrite document: ${failure}`)
  }
  async saveCustomDocumentAs(document: PerwriteDocument, destination: vscode.Uri): Promise<void> {
    const failure = await document.saveAs(destination)
    if (failure) throw new Error(`Cannot save Perwrite document as: ${failure}`)
  }
  async revertCustomDocument(document: PerwriteDocument): Promise<void> { await document.revert() }
  async backupCustomDocument(document: PerwriteDocument, context: vscode.CustomDocumentBackupContext): Promise<vscode.CustomDocumentBackup> { return document.backup(context.destination) }

  async revealTarget(...args: unknown[]): Promise<RevealCommandResult> {
    if (args.length !== 1 || !isRevealCommandInput(args[0])) return { status: 'invalid-arguments' }
    const input = args[0]
    const session = [...this.sessions].find(candidate => candidate.document.uri.toString() === input.uri.toString() && candidate.ready)
    if (!session) return { status: 'target-not-found' }
    const content = session.document.documentState.draftSnapshot.content
    const lines = content.split('\n')
    if (input.range.start.line >= lines.length || input.range.end.line >= lines.length) return { status: 'invalid-range' }
    const offset = (position: vscode.Position) => lines.slice(0, position.line).reduce((total, line) => total + line.length + 1, 0) + position.character
    const from = offset(input.range.start); const to = offset(input.range.end)
    if (from < 0 || to < from || to > content.length) return { status: 'invalid-range' }
    const delivered = await session.panel.webview.postMessage({ type: 'reveal-target', documentId: input.uri.toString(), from, to, source: 'external' })
    return delivered ? { status: 'sent', uri: input.uri, from, to } : { status: 'post-message-failed' }
  }

  private gitProvider(): GitExtensionProvider { return { getExtension: id => vscode.extensions.getExtension(id) as ReturnType<GitExtensionProvider['getExtension']> } }
  private comparisonFailure(kind: import('./protocol').ComparisonFailure['kind'], side: 'original' | 'modified' | null, target: string, detail: string): ComparisonResult<never> { return { ok: false, error: { kind, side, target, detail } } }
  private resolvedSide(snapshot: RevisionSnapshot, baseResourceUri: string) { return { snapshot, label: revisionLabel(snapshot.revisionIdentity.kind === 'commit' ? { kind: 'commit' as const, ref: snapshot.provenance.kind === 'commit' ? snapshot.provenance.requestedRef : snapshot.revisionIdentity.fullHash } : { kind: snapshot.revisionIdentity.kind }), documentId: `${snapshot.physicalUri}?revision=${snapshot.revisionIdentity.kind === 'commit' ? snapshot.revisionIdentity.fullHash : snapshot.revisionIdentity.kind}`, baseResourceUri } }
  private async resolveComparison(document: PerwriteDocument, webview: vscode.Webview, requestId: number, original: GitRevision, modified: GitRevision): Promise<void> {
    const state = document.documentState
    const working = { content: state.draftSnapshot.content, documentVersion: state.generation }
    const read = (revision: GitRevision, side: 'original' | 'modified') => readRevisionSnapshot(this.gitProvider(), document.uri, revision, side, revision.kind === 'working-tree' ? working : undefined)
    const left = await read(original, 'original'); const right = await read(modified, 'modified')
    if (!left.ok || !right.ok) { await webview.postMessage({ type: 'comparison-result', requestId, result: !left.ok ? left : right }); return }
    if (left.value.contentHash === right.value.contentHash && original.kind === modified.kind) { await webview.postMessage({ type: 'comparison-result', requestId, result: this.comparisonFailure('comparison-unresolved', null, revisionLabel(original), 'Comparison sides use the same revision') }); return }
    const base = webview.asWebviewUri(vscode.Uri.joinPath(document.uri, '..')).toString()
    const result: ComparisonResult<ResolvedGitComparison> = { ok: true, value: { identity: `${requestId}:${document.uri.toString()}`, original: this.resolvedSide(left.value, base), modified: this.resolvedSide(right.value, base), editableSide: editableSideFor(original, modified) } }
    await webview.postMessage({ type: 'comparison-result', requestId, result })
  }

  private async activateLink(document: PerwriteDocument, webview: vscode.Webview, destination: string): Promise<void> {
    const resolved = resolveLink(document.uri, document.documentState.draftSnapshot.content, destination)
    if (resolved.kind === 'external') { await vscode.env.openExternal(resolved.uri); return }
    if (resolved.kind === 'same-document-fragment') { await webview.postMessage({ type: 'reveal-target', documentId: document.uri.toString(), from: resolved.range.from, to: resolved.range.to, source: 'external' }); return }
    if (resolved.kind === 'document-fragment') await vscode.commands.executeCommand('vscode.openWith', resolved.uri, PerwriteEditorProvider.viewType)
  }

  private readEditorConfiguration() {
    const config = vscode.workspace.getConfiguration('perwrite')
    return validateEditorConfiguration({ defaultViewMode: config.get('defaultViewMode'), mermaidLayout: config.get('mermaidLayout'), mermaidMaxEdges: config.get('mermaidMaxEdges'), mermaidPanStep: config.get('mermaidPanStep'), mermaidZoomStep: config.get('mermaidZoomStep'), texRendering: config.get('texRendering'), codeBlockWrap: config.get('codeBlockWrap') }, this.configurationGeneration)
  }
  private async resolveCurrentAppearance(): Promise<AppearanceHostSources> {
    const version = ++this.appearanceVersion
    const settings = readAppearanceSettings({ get: section => { const point = section.indexOf('.'); return vscode.workspace.getConfiguration(section.slice(0, point)).get(section.slice(point + 1)) } })
    const fontFamily = vscode.workspace.getConfiguration('editor').get<unknown>('fontFamily')
    const fontSize = vscode.workspace.getConfiguration('editor').get<unknown>('fontSize')
    let tokenTheme: Result<TokenThemeData>
    try { tokenTheme = (await vscode.commands.executeCommand('_perwrite.resolveActiveTokenTheme', { generation: version }) as { result?: Result<TokenThemeData> })?.result ?? { ok: false, error: 'Token theme command failed' } } catch { tokenTheme = { ok: false, error: 'Token theme command failed' } }
    return { version, settings, fallbackFont: { family: typeof fontFamily === 'string' ? fontFamily : undefined, size: typeof fontSize === 'number' ? fontSize : undefined }, tokenTheme }
  }
}

export { contentHash, headingTarget, appearanceChangeMessage }
