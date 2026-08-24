import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('Perwrite manifest', () => {
  function readManifest() {
    const packagePath = fileURLToPath(new URL('../package.json', import.meta.url))
    return JSON.parse(readFileSync(packagePath, 'utf8')) as {
      engines: { vscode: string }
      extensionKind: string[]
      extensionDependencies: string[]
      contributes: {
        configuration: { properties: Record<string, { default?: unknown }> }
        menus: Record<string, Array<{ command: string; when: string; group: string }>>
      }
    }
  }

  it('workspace と UI の配置および theme source への依存を宣言する', () => {
    const manifest = readManifest()
    expect(manifest.engines.vscode).toBe('^1.120.0')
    expect(manifest.extensionKind).toEqual(['workspace', 'ui'])
    expect(manifest.extensionDependencies).toEqual(['barineco.perwrite-theme-source'])
  })

  it('指定された Perwrite 固有既定値を宣言する', () => {
    const properties = readManifest().contributes.configuration.properties
    expect({
      'perwrite.heading1Scale': properties['perwrite.heading1Scale'].default,
      'perwrite.heading2Scale': properties['perwrite.heading2Scale'].default,
      'perwrite.heading3Scale': properties['perwrite.heading3Scale'].default,
      'perwrite.lineHeight': properties['perwrite.lineHeight'].default,
      'perwrite.editorWidth': properties['perwrite.editorWidth'].default,
    }).toEqual({
      'perwrite.heading1Scale': 2,
      'perwrite.heading2Scale': 1.6,
      'perwrite.heading3Scale': 1.4,
      'perwrite.lineHeight': 2,
      'perwrite.editorWidth': 960,
    })
  })

  it('保存する比較入口だけを manifest に登録する', () => {
    const menus = readManifest().contributes.menus
    expect(menus['scm/resourceState/context']).toBeUndefined()
    expect(menus['scm/historyItem/context']).toContainEqual({
      command: 'perwrite.openCommitComparison',
      when: 'scmProvider == git',
      group: 'inline',
    })
    expect(menus['timeline/item/context']).toContainEqual({
      command: 'perwrite.openCommitComparison',
      when: 'timelineItem =~ /git:file:commit\\b/ && resourceExtname == .md',
      group: 'inline',
    })
  })
})
