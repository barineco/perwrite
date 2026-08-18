import { describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => {
  class Uri {
    constructor(public readonly value: string) {}
    static joinPath(uri: Uri, ...parts: string[]) { return new Uri(`${uri.value}/${parts.join('/')}`) }
  }
  return { Uri }
})
vi.mock('vscode', () => ({ Uri: runtime.Uri }))

import { createWebviewHtml } from '../webview/html-adapter'

describe('Webview HTML adapter', () => {
  it('generates nonce CSP without unsafe-eval and only extension/document roots', () => {
    const webview = {
      cspSource: 'vscode-webview-resource:',
      asWebviewUri: (uri: { value: string }) => ({ toString: () => `vscode-resource:${uri.value}` }),
    } as any
    const output = createWebviewHtml({ extensionUri: new runtime.Uri('file:///extension'), documentUri: new runtime.Uri('file:///workspace/doc.md'), webview })
    expect(output.contentSecurityPolicy).toBe([
      `default-src 'none'`,
      `style-src vscode-webview-resource: 'unsafe-inline'`,
      `script-src 'nonce-${output.nonce}'`,
      `img-src vscode-webview-resource: https: data:`,
      `font-src vscode-webview-resource: https: data:`,
    ].join('; '))
    expect(output.contentSecurityPolicy).not.toContain('unsafe-eval')
    expect(output.html).toContain(`nonce-${output.nonce}`)
    expect(output.localResourceRoots).toHaveLength(2)
    expect(output.localResourceRoots.map(root => root.value)).toEqual([
      'file:///extension/dist', 'file:///workspace/doc.md/..',
    ])
    expect(output.html).toContain('Content-Security-Policy')
  })
})
