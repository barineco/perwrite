import * as crypto from 'crypto'
import * as vscode from 'vscode'

export interface WebviewHtmlInput {
  readonly extensionUri: vscode.Uri
  readonly documentUri: vscode.Uri
  readonly webview: vscode.Webview
}

export interface WebviewHtmlOutput {
  readonly html: string
  readonly nonce: string
  readonly contentSecurityPolicy: string
  readonly localResourceRoots: readonly vscode.Uri[]
}

export function createWebviewHtml(input: WebviewHtmlInput): WebviewHtmlOutput {
  const scriptUri = input.webview.asWebviewUri(vscode.Uri.joinPath(input.extensionUri, 'dist', 'webview.js'))
  const styleUri = input.webview.asWebviewUri(vscode.Uri.joinPath(input.extensionUri, 'dist', 'webview.css'))
  const nonce = crypto.randomBytes(16).toString('hex')
  const csp = [
    `default-src 'none'`,
    `style-src ${input.webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${input.webview.cspSource} https: data:`,
    `font-src ${input.webview.cspSource} https: data:`,
  ].join('; ')
  const documentRoot = vscode.Uri.joinPath(input.documentUri, '..')
  const localResourceRoots = [vscode.Uri.joinPath(input.extensionUri, 'dist'), documentRoot]
  const localResourceRootsJson = JSON.stringify(localResourceRoots.map(root => root.toString()))
    .replace(/&/g, '&amp;').replace(/\"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="perwrite-local-resource-roots" content="${localResourceRootsJson}">
  <title>Perwrite</title>
  <link rel="stylesheet" href="${styleUri}">
</head>
<body>
  <div id="toolbar">
    <span class="toolbar-title">Perwrite</span>
    <div class="comparison-targets">
      <input id="comparison-original" class="comparison-target" aria-label="Original Git revision" value="HEAD">
      <span>↔</span>
      <input id="comparison-modified" class="comparison-target" aria-label="Modified Git revision" value="working-tree">
      <button id="apply-comparison" class="toolbar-btn" title="Apply Git comparison">Compare</button>
    </div>
    <div class="toolbar-actions">
      <button id="toggle-view" class="toolbar-btn" title="Cycle view mode (raw / rich / render)">Render</button>
      <button id="toggle-diff" class="toolbar-btn" title="Compare against HEAD">Diff</button>
    </div>
  </div>
  <div id="editor"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
  return { html, nonce, contentSecurityPolicy: csp, localResourceRoots }
}
