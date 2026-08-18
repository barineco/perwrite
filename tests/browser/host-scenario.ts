import type { AppearanceHostSources } from '../../src/appearance-profile'
import { contentHash, type EditRequest, type EditorConfiguration, type HostMessage, type ResolvedGitComparison, type ResolvedReadonlyDocument, type Result, type WebviewMessage } from '../../src/protocol'
import { defaultPerwriteSettings } from '../../src/settings-resolver'
import { EditorView } from '@codemirror/view'

const outbound: WebviewMessage[] = []
Object.assign(globalThis, {
  acquireVsCodeApi: () => ({
    postMessage(message: WebviewMessage) { outbound.push(message) },
    getState() { return undefined },
    setState() {},
  }),
})

// VS Code 相当の UI 色注入。webview は getComputedStyle でこれらを読む。
const VSCODE_COLORS: Record<string, string> = {
  '--vscode-editor-background': '#123456',
  '--vscode-editor-foreground': '#abcdef',
}
function injectVscodeColors(colors: Record<string, string>): void {
  for (const [name, value] of Object.entries(colors)) document.documentElement.style.setProperty(name, value)
}
injectVscodeColors(VSCODE_COLORS)
document.body.dataset.vscodeThemeKind = 'vscode-dark'

await import('../../webview/index')

const appearance: AppearanceHostSources = {
  version: 1,
  settings: { ok: true, value: { perwrite: defaultPerwriteSettings(), editorFont: { family: 'Mono', size: 14 } } },
  fallbackFont: { family: 'Mono', size: 14 },
  tokenTheme: {
    ok: true,
    value: { name: 'sample', type: 'dark', tokenColors: [], semanticTokenColors: {}, semanticHighlighting: false },
  },
}
const content = '# Title\n\n**styled** and $x^2$\n'

Object.assign(globalThis, {
  perwriteHost: {
    outbound,
    setVscodeColor(name: string, value: string) {
      document.documentElement.style.setProperty(name, value)
      // テーマ切替の通知面 ( body の theme-kind 属性 ) を触り、observeThemeDom を発火させる。
      document.body.dataset.vscodeThemeName = `revision-${value}`
    },
    sendInit(configuration: Result<EditorConfiguration>) {
      const message: HostMessage = {
        type: 'init', documentId: 'file:host-scenario', documentVersion: 1,
        content, appearance, baseResourceUri: 'https://perwrite.test/', configuration,
      }
      window.dispatchEvent(new MessageEvent('message', { data: message }))
    },
    sendConfiguration(configuration: Result<EditorConfiguration>) {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'configuration-change', configuration } satisfies HostMessage,
      }))
    },
    sendExternalUpdate(content: string) {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'host-document-observation', observation: {
          target: { kind: 'editing', documentId: 'file:host-scenario' },
          sessionGeneration: Number(document.body.dataset.webviewSessionGeneration), documentVersion: 2,
          content, contentHash: contentHash(content),
        } } satisfies HostMessage,
      }))
    },
    dispatchNormalChanges() {
      const editor = document.querySelector<HTMLElement>('.cm-editor')
      const view = editor ? EditorView.findFromDOM(editor) : null
      if (!view) throw new Error('normal EditorView is unavailable')
      const from = view.state.doc.length
      view.dispatch({ changes: { from, insert: 'a' } })
      view.dispatch({ changes: { from: from + 1, insert: 'b' } })
    },
    dispatchNormalChange(insert: string) {
      const editor = document.querySelector<HTMLElement>('.cm-editor')
      const view = editor ? EditorView.findFromDOM(editor) : null
      if (!view) throw new Error('normal EditorView is unavailable')
      view.dispatch({ changes: { from: view.state.doc.length, insert } })
    },
    sendObservation(request: EditRequest, afterDocumentVersion: number, overrides: Partial<EditRequest> = {}) {
      const verifiedRequest = { ...request, ...overrides }
      const value = {
        request: verifiedRequest,
        before: { target: verifiedRequest.target, sessionGeneration: verifiedRequest.sessionGeneration, documentVersion: verifiedRequest.baseDocumentVersion, content, contentHash: contentHash(content) },
        after: { target: verifiedRequest.target, sessionGeneration: verifiedRequest.sessionGeneration, documentVersion: afterDocumentVersion, content, contentHash: contentHash(content) },
      }
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'edit-result', result: { ok: true, value } } satisfies HostMessage,
      }))
    },
    sendConflict(request: EditRequest, documentVersion: number, snapshotContent: string) {
      const snapshot = {
        target: request.target, sessionGeneration: request.sessionGeneration, documentVersion,
        content: snapshotContent, contentHash: contentHash(snapshotContent),
      }
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'edit-result', result: { ok: false, error: {
          editId: request.editId, target: request.target, sessionGeneration: request.sessionGeneration,
          baseDocumentVersion: request.baseDocumentVersion, kind: 'base-version-conflict', reason: 'delayed conflict', snapshot,
        } } } satisfies HostMessage,
      }))
    },
    sendFailure(request: EditRequest, overrides: Partial<EditRequest> = {}) {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'edit-result', result: { ok: false, error: {
          editId: overrides.editId ?? request.editId,
          target: overrides.target ?? request.target,
          sessionGeneration: overrides.sessionGeneration ?? request.sessionGeneration,
          baseDocumentVersion: overrides.baseDocumentVersion ?? request.baseDocumentVersion,
          kind: 'apply-rejected', reason: 'stale failure',
        } } } satisfies HostMessage,
      }))
    },
    stateWitness(side?: 'original' | 'modified') {
      const selector = side ? `.comparison-${side} .cm-editor` : '.cm-editor'
      const editor = document.querySelector<HTMLElement>(selector)
      const view = editor ? EditorView.findFromDOM(editor) : null
      return {
        content: view?.state.doc.toString() ?? null,
        selection: view?.state.selection.ranges.map(range => ({ from: range.from, to: range.to })) ?? [],
        failure: document.querySelector('#edit-error')?.textContent ?? null,
        editorKind: document.body.dataset.editorKind ?? null,
        comparisonIdentity: document.body.dataset.comparisonIdentity ?? null,
        outboundCount: outbound.length,
      }
    },
    sendComparisonResult(requestId: number, comparison: ResolvedGitComparison) {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'comparison-result', requestId, result: { ok: true, value: comparison } } satisfies HostMessage,
      }))
    },
    sendComparisonExternalUpdate(_identity: string, side: 'original' | 'modified', content: string) {
      const documentId = side === 'original' ? 'git:head' : 'file:work'
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'host-document-observation', observation: {
          target: { kind: 'comparison', documentId, side },
          sessionGeneration: Number(document.body.dataset.webviewSessionGeneration),
          documentVersion: side === 'original' ? 1 : 4, content, contentHash: contentHash(content),
        } } satisfies HostMessage,
      }))
    },
    sendMismatchedFailureSnapshot(request: EditRequest, snapshotContent: string) {
      const snapshot = {
        target: { kind: 'editing' as const, documentId: 'different-document' }, sessionGeneration: request.sessionGeneration,
        documentVersion: request.baseDocumentVersion + 10, content: snapshotContent, contentHash: contentHash(snapshotContent),
      }
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'edit-result', result: { ok: false, error: {
          editId: request.editId, target: request.target, sessionGeneration: request.sessionGeneration,
          baseDocumentVersion: request.baseDocumentVersion, kind: 'base-version-conflict', reason: 'mismatched failure snapshot', snapshot,
        } } } satisfies HostMessage,
      }))
    },
    dispatchComparisonChanges(side: 'original' | 'modified') {
      const editor = document.querySelector<HTMLElement>(`.comparison-${side} .cm-editor`)
      const view = editor ? EditorView.findFromDOM(editor) : null
      if (!view) throw new Error(`${side} comparison EditorView is unavailable`)
      const from = view.state.doc.length
      view.dispatch({ changes: { from, insert: 'a' } })
      view.dispatch({ changes: { from: from + 1, insert: 'b' } })
    },
    dispatchComparisonChange(side: 'original' | 'modified', insert: string) {
      const editor = document.querySelector<HTMLElement>(`.comparison-${side} .cm-editor`)
      const view = editor ? EditorView.findFromDOM(editor) : null
      if (!view) throw new Error(`${side} comparison EditorView is unavailable`)
      view.dispatch({ changes: { from: view.state.doc.length, insert } })
    },
    sendReadonlyInit(document: ResolvedReadonlyDocument, configuration: Result<EditorConfiguration>) {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'readonly-init', document, appearance, configuration } satisfies HostMessage,
      }))
    },
    attemptReadonlyMutation() {
      const editor = document.querySelector<HTMLElement>('.readonly-editor .cm-editor')
      const view = editor ? EditorView.findFromDOM(editor) : null
      if (!view) throw new Error('readonly EditorView is unavailable')
      const before = view.state.doc.toString()
      view.dispatch({ changes: { from: 0, to: before.length, insert: 'changed' } })
      return { before, after: view.state.doc.toString() }
    },
  },
})
