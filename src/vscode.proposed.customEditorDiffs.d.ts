import type * as vscode from 'vscode'

declare module 'vscode' {
  interface CustomEditorInlineDiffDocuments<T extends vscode.CustomDocument> {
    readonly original: T
    readonly modified: T
  }

  interface CustomEditorProvider<T extends vscode.CustomDocument> {
    resolveCustomEditorInlineDiff?(
      documents: CustomEditorInlineDiffDocuments<T>,
      webviewPanel: vscode.WebviewPanel,
      token: vscode.CancellationToken,
    ): void | Thenable<void>
  }
}
