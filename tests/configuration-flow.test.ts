import { describe, expect, it, vi } from 'vitest'
import { acceptConfiguration, rejectConfiguration, updateInitialInvalidContent, type ConfigurationState } from '../webview/configuration-state'
import { configurationChangeMessage, type EditorConfiguration } from '../src/protocol'
import { isEditorConfigurationChange } from '../src/settings-resolver'

const renderElk: EditorConfiguration = {
  defaultViewMode: 'render', configurationFailure: null,
  rendering: { generation: 1, codeBlockWrap: true, mermaidLayout: 'elk', mermaidMaxEdges: 1024, mermaidPanStep: 80, mermaidZoomStep: 1.5, texRendering: true },
}
const rawDagre: EditorConfiguration = {
  defaultViewMode: 'raw', configurationFailure: null,
  rendering: { generation: 2, codeBlockWrap: false, mermaidLayout: 'dagre', mermaidMaxEdges: 1024, mermaidPanStep: 80, mermaidZoomStep: 1.5, texRendering: false },
}

describe('設定 message と購読', () => {
  it('七つの公開設定だけを editor configuration change として選ぶ', () => {
    for (const id of [
      'perwrite.defaultViewMode', 'perwrite.mermaidLayout', 'perwrite.mermaidMaxEdges',
      'perwrite.mermaidPanStep', 'perwrite.mermaidZoomStep', 'perwrite.texRendering', 'perwrite.codeBlockWrap',
    ]) {
      expect(isEditorConfigurationChange(candidate => candidate === id)).toBe(true)
    }
    expect(isEditorConfigurationChange(candidate => candidate === 'perwrite.editorWidth')).toBe(false)
  })

  it('検証結果を configuration-change message に保存する', () => {
    expect(configurationChangeMessage({ ok: true, value: renderElk })).toEqual({
      type: 'configuration-change', configuration: { ok: true, value: renderElk },
    })
    expect(configurationChangeMessage({ ok: false, error: 'Invalid perwrite.texRendering' })).toEqual({
      type: 'configuration-change', configuration: { ok: false, error: 'Invalid perwrite.texRendering' },
    })
  })
})

describe('設定適用状態の連続遷移', () => {
  it('初期 Invalid から有効設定で EditorView を構築する', () => {
    const init = { content: '# doc' }
    const invalid: ConfigurationState<{ id: number }, typeof init> = {
      kind: 'initial-invalid', init, failure: 'Invalid perwrite.defaultViewMode',
    }
    const create = vi.fn(() => ({ id: 1 }))
    const reconfigure = vi.fn()
    const active = acceptConfiguration(invalid, renderElk, create, reconfigure)

    expect(active).toEqual({
      kind: 'active', init, view: { id: 1 }, configuration: renderElk, configurationFailure: null,
    })
    expect(create).toHaveBeenCalledWith(init, renderElk)
    expect(reconfigure).not.toHaveBeenCalled()
  })

  it('初期 Invalid 中の外部更新を復帰時の文書へ保存する', () => {
    const invalid: ConfigurationState<{ id: number }, { content: string }> = {
      kind: 'initial-invalid', init: { content: 'old' }, failure: 'Invalid setting',
    }
    const updated = updateInitialInvalidContent(invalid, 'new')
    const create = vi.fn((init: { content: string }) => ({ id: init.content.length }))
    const active = acceptConfiguration(updated, renderElk, create, vi.fn())
    expect(create).toHaveBeenCalledWith({ content: 'new' }, renderElk)
    expect(active.kind).toBe('active')
  })

  it('active で Invalid を保持し、次の有効設定で同じ EditorView を再構成して失敗を消す', () => {
    const view = { id: 1 }
    const init = { content: '# doc' }
    const active: ConfigurationState<typeof view, typeof init> = {
      kind: 'active', init, view, configuration: renderElk, configurationFailure: null,
    }
    const rejected = rejectConfiguration(active, 'Invalid perwrite.mermaidLayout')
    expect(rejected).toEqual({ ...active, configurationFailure: 'Invalid perwrite.mermaidLayout' })

    const create = vi.fn(() => ({ id: 2 }))
    const reconfigure = vi.fn()
    const recovered = acceptConfiguration(rejected, rawDagre, create, reconfigure)
    expect(recovered).toEqual({
      kind: 'active', init, view, configuration: rawDagre, configurationFailure: null,
    })
    expect(create).not.toHaveBeenCalled()
    expect(reconfigure).toHaveBeenCalledWith(view, rawDagre)
  })

  it('defaultViewMode の変更を現在の EditorView へ適用せず構成データだけ更新する', () => {
    const view = { mode: 'rich' as const }
    const state: ConfigurationState<typeof view, { content: string }> = {
      kind: 'active', init: { content: 'doc' }, view,
      configuration: renderElk, configurationFailure: null,
    }
    const recovered = acceptConfiguration(state, rawDagre, vi.fn(), vi.fn())
    expect(recovered.kind).toBe('active')
    if (recovered.kind === 'active') {
      expect(recovered.view).toBe(view)
      expect(recovered.view.mode).toBe('rich')
      expect(recovered.configuration.defaultViewMode).toBe('raw')
    }
  })
})
