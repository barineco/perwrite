import { describe, expect, it, vi } from 'vitest'
import {
  resolveHighlightLanguage,
  ShikiCoordinator,
  type ShikiHighlighter,
} from '../webview/nodes/code-block-node'

function highlighter(html = '<pre class="shiki"><code><span class="line">ok</span></code></pre>'): ShikiHighlighter {
  return {
    codeToHtml: vi.fn(() => html),
    loadLanguage: vi.fn(async () => undefined),
    loadTheme: vi.fn(async () => undefined),
    dispose: vi.fn(),
  }
}

describe('Shiki language result', () => {
  it('preserves a typed failure when requested language loading fails', async () => {
    const instance = highlighter()
    instance.loadLanguage = vi.fn(async () => { throw new Error('loader unavailable') })
    await expect(resolveHighlightLanguage(instance, 'typescript')).resolves.toEqual({
      requested: 'typescript',
      selected: 'text',
      loadError: 'loader unavailable',
    })
  })

  it('publishes only the current theme candidate and disposes stale candidates', async () => {
    let releaseA: (() => void) | undefined
    let releaseB: (() => void) | undefined
    const candidateA = highlighter('<pre>A</pre>')
    const candidateB = highlighter('<pre>B</pre>')
    const coordinator = new ShikiCoordinator(async theme => {
      await new Promise<void>(resolve => {
        if (theme.name === 'A') releaseA = resolve
        else releaseB = resolve
      })
      return theme.name === 'A' ? candidateA : candidateB
    })

    const preparingA = coordinator.prepareTheme({ name: 'A' }, 1)
    const preparingB = coordinator.prepareTheme({ name: 'B' }, 2)
    releaseB?.()
    const preparedB = await preparingB
    expect(coordinator.publishTheme(preparedB, () => true)?.themeName).toBe('B')
    releaseA?.()
    const preparedA = await preparingA
    expect(coordinator.publishTheme(preparedA, () => false)).toBeNull()
    expect(coordinator.active?.themeName).toBe('B')
    expect(candidateA.dispose).toHaveBeenCalledOnce()
    expect(candidateB.dispose).not.toHaveBeenCalled()
  })

  it('keeps language preparation outside the published snapshot until exchange', async () => {
    const instances: ShikiHighlighter[] = []
    const coordinator = new ShikiCoordinator(async () => {
      const instance = highlighter()
      instances.push(instance)
      return instance
    })
    const theme = await coordinator.prepareTheme({ name: 'theme' }, 1)
    const snapshot = coordinator.publishTheme(theme)!
    const pending = await coordinator.prepareLanguage(snapshot, 'typescript')
    expect(pending.ok).toBe(true)
    if (!pending.ok || !pending.value.candidate) return
    expect(snapshot.loadedLanguages).toEqual([])
    expect(coordinator.active).toBe(snapshot)
    const next = coordinator.publishLanguage(pending.value.candidate, () => true)
    expect(next?.id).not.toBe(snapshot.id)
    expect(next?.loadedLanguages).toEqual(['typescript'])
    expect(coordinator.active?.id).toBe(next?.id)
  })

  it('highlights a widget after an unrelated language load bumps the snapshot id (Regression)', async () => {
    const coordinator = new ShikiCoordinator(async () => highlighter())
    const theme = await coordinator.prepareTheme({ name: 'theme' }, 1)
    const snapshot = coordinator.publishTheme(theme)!
    const observedSnapshotId = snapshot.id

    const pending = await coordinator.prepareLanguage(snapshot, 'python')
    if (!pending.ok || !pending.value.candidate) throw new Error('expected a language candidate')
    coordinator.publishLanguage(pending.value.candidate, () => true)
    expect(coordinator.active?.id).not.toBe(observedSnapshotId)
    expect(coordinator.active?.appearanceVersion).toBe(snapshot.appearanceVersion)

    const result = await coordinator.highlightForWidget(
      'print(1)',
      'python',
      snapshot.appearanceVersion,
    )
    expect(result.ok).toBe(true)
  })

  it('rejects a widget request when the appearance version changed (Invalid)', async () => {
    const coordinator = new ShikiCoordinator(async () => highlighter())
    const theme = await coordinator.prepareTheme({ name: 'theme' }, 1)
    coordinator.publishTheme(theme)!

    const nextTheme = await coordinator.prepareTheme({ name: 'theme2' }, 2)
    coordinator.publishTheme(nextTheme)

    const result = await coordinator.highlightForWidget('code', 'typescript', 1)
    expect(result).toEqual({ ok: false, error: 'Appearance snapshot is not current' })
  })

  it('keeps appearanceVersion unchanged while loadedLanguages grows on language addition (Orthogonality)', async () => {
    const coordinator = new ShikiCoordinator(async () => highlighter())
    const theme = await coordinator.prepareTheme({ name: 'theme' }, 1)
    const snapshot = coordinator.publishTheme(theme)!

    const pending = await coordinator.prepareLanguage(snapshot, 'rust')
    if (!pending.ok || !pending.value.candidate) throw new Error('expected a language candidate')
    const next = coordinator.publishLanguage(pending.value.candidate, () => true)

    expect(next?.appearanceVersion).toBe(snapshot.appearanceVersion)
    expect(next?.loadedLanguages).toEqual(['rust'])
  })

  it('does not declare requestSnapshotId in code-block-node.ts (Invalid)', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const source = await fs.readFile(
      path.resolve(__dirname, '../webview/nodes/code-block-node.ts'),
      'utf-8',
    )
    expect(source).not.toMatch(/requestSnapshotId/)
  })

  it('discards a successful widget highlight only on appearance mismatch, not on snapshot id mismatch (Regression)', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const source = await fs.readFile(
      path.resolve(__dirname, '../webview/nodes/code-block-node.ts'),
      'utf-8',
    )
    const successBranchMatch = source.match(
      /const active = getActiveShikiSnapshot\(\)\n\s*if \(!active \|\| ([^)]+)\) return\n\s*let html = result\.value\.highlighted\.html/,
    )
    expect(successBranchMatch).not.toBeNull()
    const condition = successBranchMatch?.[1] ?? ''
    expect(condition).not.toMatch(/\.id\b/)
    expect(condition).toBe('active.appearanceVersion !== this.appearanceVersion')
  })
})
