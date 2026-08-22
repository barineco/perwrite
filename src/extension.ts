import * as vscode from 'vscode'
import { PerwriteEditorProvider } from './editor-provider'
import { readCommitInitializationSnapshots, resolveGitDocumentUri, type GitExtensionProvider } from './git-source'
import {
  resolveCommitComparisonInput,
  resolveTimelineComparisonRefs,
  type CommitComparisonRefs,
} from './history-comparison'

function physicalDocumentUri(uri: vscode.Uri): vscode.Uri | null {
  const resolved = resolveGitDocumentUri(uri, 'modified')
  if (!resolved.ok) return null
  return resolved.value.revision.kind === 'working-tree' ? uri : vscode.Uri.file(resolved.value.actualFsPath)
}

function activeDocumentUri(): vscode.Uri | null {
  const textUri = vscode.window.activeTextEditor?.document.uri
  if (textUri) return physicalDocumentUri(textUri)
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
  if (input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText) {
    return physicalDocumentUri(input.uri)
  }
  if (input instanceof vscode.TabInputTextDiff) return physicalDocumentUri(input.modified)
  const openMarkdown = vscode.workspace.textDocuments
    .map(document => physicalDocumentUri(document.uri))
    .filter((uri): uri is vscode.Uri => uri !== null && uri.path.toLowerCase().endsWith('.md'))
  const unique = [...new Map(openMarkdown.map(uri => [uri.toString(), uri])).values()]
  return unique.length === 1 ? unique[0] : null
}

function gitDocumentUri(documentUri: vscode.Uri, ref: string): vscode.Uri {
  return documentUri.with({
    scheme: 'git',
    query: JSON.stringify({ path: documentUri.fsPath, ref }),
  })
}

function gitProvider(): GitExtensionProvider {
  return {
    getExtension: id => vscode.extensions.getExtension(id) as ReturnType<GitExtensionProvider['getExtension']>,
  }
}

async function openCommitComparison(
  documentUri: vscode.Uri,
  refs: CommitComparisonRefs,
): Promise<void> {
  const originalUri = gitDocumentUri(documentUri, refs.originalRef)
  const modifiedUri = gitDocumentUri(documentUri, refs.modifiedRef)
  await vscode.commands.executeCommand(
    'vscode.diff', originalUri, modifiedUri,
    `${vscode.workspace.asRelativePath(documentUri)} (${refs.originalRef} ↔ ${refs.modifiedRef})`,
  )
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new PerwriteEditorProvider(context)
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      PerwriteEditorProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: true,
      },
    ),
    vscode.commands.registerCommand('perwrite.revealTarget', (...args: unknown[]) => provider.revealTarget(...args)),
    vscode.commands.registerCommand('perwrite.openGitComparison', async (
      resource?: vscode.Uri | { readonly resourceUri: vscode.Uri },
    ) => {
      const selectedUri = resource instanceof vscode.Uri
        ? resource
        : resource?.resourceUri ?? vscode.window.activeTextEditor?.document.uri
      if (!selectedUri) {
        void vscode.window.showWarningMessage('Open a working-tree Markdown document before starting a Git comparison.')
        return
      }
      const documentUri = physicalDocumentUri(selectedUri)
      if (!documentUri) {
        void vscode.window.showWarningMessage('Open a working-tree Markdown document before starting a Git comparison.')
        return
      }
      const indexUri = gitDocumentUri(documentUri, '')
      await vscode.commands.executeCommand(
        'vscode.diff', indexUri, documentUri, `${vscode.workspace.asRelativePath(documentUri)} (Index ↔ Working Tree)`,
      )
    }),
    vscode.commands.registerCommand('perwrite.openCommitComparison', async (...args: unknown[]) => {
      const input = resolveCommitComparisonInput(args)
      if (!input.ok) {
        void vscode.window.showWarningMessage(input.error)
        return
      }
      const documentUri = input.value.kind === 'timeline'
        ? input.value.resourceUri instanceof vscode.Uri
          ? physicalDocumentUri(input.value.resourceUri)
          : null
        : activeDocumentUri()
      if (!documentUri || documentUri.path.toLowerCase().endsWith('.md') === false) {
        void vscode.window.showWarningMessage('Open a Markdown document before starting a commit comparison.')
        return
      }
      if (input.value.kind === 'scm-history') {
        await openCommitComparison(documentUri, input.value.refs)
        return
      }
      const snapshots = await readCommitInitializationSnapshots(gitProvider(), documentUri, input.value.ref)
      if (!snapshots.ok) {
        void vscode.window.showWarningMessage(snapshots.error.detail)
        return
      }
      const refs = resolveTimelineComparisonRefs({
        hash: snapshots.value.target.revisionIdentity.kind === 'commit'
          ? snapshots.value.target.revisionIdentity.fullHash
          : '',
        parentHash: snapshots.value.parent?.revisionIdentity.kind === 'commit'
          ? snapshots.value.parent.revisionIdentity.fullHash
          : null,
      })
      if (!refs.ok) {
        void vscode.window.showWarningMessage(refs.error)
        return
      }
      await openCommitComparison(documentUri, refs.value)
    }),
  )
}

export function deactivate(): void {}
