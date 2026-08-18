import { describe, expect, it } from 'vitest'
import { applyFailureDisplay, type FailureDocument, type FailureElement } from '../webview/failure-dom'
import { resolutionFailureDisplay } from '../webview/appearance'
import { handleHostResult } from '../webview/host-result'
import { createFallbackProfile } from '../src/appearance-profile'

class FakeElement implements FailureElement {
  textContent: string | null = null
  readonly attributes: Record<string, string> = {}
  removed = false
  inserted: FakeElement | null = null
  readonly children: FakeElement[] = []
  click: (() => void) | null = null
  setAttribute(name: string, value: string): void { this.attributes[name] = value }
  insertAdjacentElement(_position: 'afterend', element: FailureElement): void { this.inserted = element as FakeElement }
  remove(): void { this.removed = true }
  appendChild(element: FailureElement): void { this.children.push(element as FakeElement) }
  addEventListener(type: string, callback: () => void): void { if (type === 'click') this.click = callback }
  focus(): void { this.attributes.focused = 'true' }
}

function fakeDocument(): FailureDocument & { toolbar: FakeElement; created: FakeElement[] } {
  const toolbar = new FakeElement()
  const created: FakeElement[] = []
  return { toolbar, created, getElementById(id) { return id === 'toolbar' ? toolbar : created.find(element => element.attributes.id === id) ?? null }, createElement() { const element = new FakeElement(); created.push(element); return element } }
}

describe('failure DOM adapters', () => {
  it('applies an appearance protocol failure to the product DOM adapter', () => {
    const doc = fakeDocument()
    applyFailureDisplay(doc, 'theme-error', 'status', resolutionFailureDisplay({ ok: false, error: 'broken theme', fallback: createFallbackProfile('dark') }))
    expect(doc.created[0].textContent).toBe('Appearance rendering unavailable: broken theme')
  })

  it('typed EditFailure を product DOM adapter に表示する', () => {
    const doc = fakeDocument()
    handleHostResult({ type: 'edit-result', result: { ok: false, error: { editId: 'edit-3', target: { kind: 'editing', documentId: 'd' }, sessionGeneration: 0, baseDocumentVersion: 3, kind: 'apply-rejected', reason: 'rejected' } } }, display => applyFailureDisplay(doc, 'edit-error', 'alert', display))
    expect(doc.created[0].attributes).toEqual({ id: 'edit-error', role: 'alert' })
    expect(doc.created[0].textContent).toBe('Edit edit-3 failed: apply-rejected: rejected')
  })
})
