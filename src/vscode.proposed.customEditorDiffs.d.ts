import type * as vscode from 'vscode'

declare module 'vscode' {
  interface CustomEditorDiffDocuments {
    readonly original: vscode.TextDocument
    readonly modified: vscode.TextDocument
  }

  interface CustomTextEditorProvider {
    resolveCustomTextEditorInlineDiff?(
      documents: CustomEditorDiffDocuments,
      webviewPanel: vscode.WebviewPanel,
      token: vscode.CancellationToken,
    ): void | Thenable<void>
  }
}
