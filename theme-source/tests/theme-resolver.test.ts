import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseJsonc,
  resolveActiveThemeFromSource,
  resolveThemeFile,
  type ThemeFileReader,
} from '../src/theme-resolver'
import { activate, resolveActiveTokenThemeCommand } from '../src/extension'

const vscodeRuntime = vi.hoisted(() => ({
  extensions: { all: [] as unknown[] },
  workspace: { getConfiguration: vi.fn(() => ({ get: vi.fn(() => undefined) })) },
  commands: { registerCommand: vi.fn() },
}))

vi.mock('vscode', () => vscodeRuntime)

function reader(files: Readonly<Record<string, string>>): ThemeFileReader {
  return absolutePath => absolutePath in files
    ? { ok: true, value: files[absolutePath] }
    : { ok: false, error: `Theme file is missing: ${absolutePath}` }
}

describe('theme source resolver', () => {
  it('parses JSONC comments and trailing commas', () => {
    expect(parseJsonc('{ // comment\n "value": 1, }')).toEqual({ ok: true, value: { value: 1 } })
    expect(parseJsonc('{ invalid')).toMatchObject({ ok: false, error: expect.stringContaining('JSONC syntax error') })
  })

  it('resolves label and id matches with nested includes and semantic token inheritance', () => {
    const files = {
      '/themes/base.jsonc': `{
        "tokenColors": [{ "scope": "base" }],
        "semanticTokenColors": { "variable": "#111111" },
        "semanticHighlighting": false
      }`,
      '/themes/middle.jsonc': `{
        "include": "base.jsonc",
        "tokenColors": [{ "scope": "middle" }],
        "semanticTokenColors": { "class": "#222222" }
      }`,
      '/themes/child.jsonc': `{
        "include": "middle.jsonc",
        "name": "Child",
        "tokenColors": [{ "scope": "child" }],
        "semanticTokenColors": { "variable": "#333333" },
        "semanticHighlighting": true
      }`,
    }
    const source = {
      themeName: 'sample.id',
      contributions: [{
        label: 'Sample',
        id: 'sample.id',
        path: 'child.jsonc',
        extensionPath: '/themes',
        uiTheme: 'vs',
      }],
    }
    const result = resolveActiveThemeFromSource(source, reader(files))
    expect(result).toEqual({
      ok: true,
      value: {
        name: 'Child',
        type: 'light',
        tokenColors: [{ scope: 'base' }, { scope: 'middle' }, { scope: 'child' }],
        semanticTokenColors: { variable: '#333333', class: '#222222' },
        semanticHighlighting: true,
      },
    })
  })

  it('resolves inline, JSONC file, and plist token colors', () => {
    const plist = `<?xml version="1.0"?><plist version="1.0"><dict><key>settings</key><array>
      <dict><key>scope</key><string>plist</string><key>settings</key><dict><key>foreground</key><string>#abcdef</string></dict></dict>
    </array></dict></plist>`
    const files = {
      '/themes/base.json': '{ "tokenColors": [{ "scope": "base" }] }',
      '/themes/json-theme.json': '{ "include": "base.json", "tokenColors": "rules.jsonc" }',
      '/themes/rules.jsonc': '{ "tokenColors": [{ "scope": "jsonc" }, ], }',
      '/themes/plist-theme.json': '{ "include": "base.json", "tokenColors": "rules.tmTheme" }',
      '/themes/rules.tmTheme': plist,
      '/themes/inline.json': '{ "tokenColors": [{ "scope": "inline" }] }',
    }

    const json = resolveThemeFile('/themes/json-theme.json', reader(files), 'json', 'dark')
    const plistResult = resolveThemeFile('/themes/plist-theme.json', reader(files), 'plist', 'dark')
    const inline = resolveThemeFile('/themes/inline.json', reader(files), 'inline', 'dark')
    expect(json.ok && plistResult.ok && inline.ok).toBe(true)
    if (json.ok) expect(json.value.tokenColors).toEqual([{ scope: 'base' }, { scope: 'jsonc' }])
    if (plistResult.ok) expect(plistResult.value.tokenColors).toEqual([
      { scope: 'base' }, { scope: 'plist', settings: { foreground: '#abcdef' } },
    ])
    if (inline.ok) expect(inline.value.tokenColors).toEqual([{ scope: 'inline' }])
  })

  it('reports contribution, include, read, syntax, and format failures', () => {
    const cases: Array<[string, Record<string, string>]> = [
      ['/themes/a.json', { '/themes/a.json': '{ "include": "b.json" }', '/themes/b.json': '{ "include": "a.json" }' }],
      ['/themes/a.json', { '/themes/a.json': '{ "tokenColors": "missing.jsonc" }' }],
      ['/themes/a.json', { '/themes/a.json': '{ "tokenColors": "bad.tmTheme" }', '/themes/bad.tmTheme': '<plist><dict><key>settings</key></dict></plist>' }],
      ['/themes/a.json', { '/themes/a.json': '{ "tokenColors": "bad.jsonc" }', '/themes/bad.jsonc': '{ "settings": {} }' }],
      ['/themes/a.json', { '/themes/a.json': '{ "tokenColors": "bad.txt" }', '/themes/bad.txt': '[]' }],
      ['/themes/a.json', { '/themes/a.json': '{ invalid' }],
      ['/themes/a.json', { '/themes/a.json': '{ "include": "missing.jsonc" }' }],
    ]
    for (const [entry, files] of cases) {
      expect(resolveThemeFile(entry, reader(files), 'sample', 'dark').ok).toBe(false)
    }
    expect(resolveActiveThemeFromSource({ themeName: 'missing', contributions: [] }, reader({}))).toEqual({
      ok: false,
      error: 'Theme contribution not found for active color theme: missing',
    })
  })

  it('returns only TokenThemeData fields', () => {
    const result = resolveThemeFile(
      '/themes/theme.json',
      reader({ '/themes/theme.json': '{ "colors": { "editor.background": "#000" }, "tokenColors": [] }' }),
      'sample',
      'dark',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.value).sort()).toEqual([
      'name', 'semanticTokenColors', 'tokenColors', 'type',
    ])
    expect(result.value).not.toHaveProperty('colors')
    expect(JSON.parse(JSON.stringify(result.value))).toEqual(result.value)
  })

  it('validates command input and preserves the requested generation', () => {
    expect(resolveActiveTokenThemeCommand(null)).toEqual({
      generation: 0,
      result: { ok: false, error: 'Command input must contain a finite numeric generation' },
    })
    vscodeRuntime.workspace.getConfiguration.mockReturnValueOnce({ get: vi.fn(() => 'Sample') })
    vscodeRuntime.extensions.all = []
    expect(resolveActiveTokenThemeCommand({ generation: 12 })).toEqual({
      generation: 12,
      result: { ok: false, error: 'Theme contribution not found for active color theme: Sample' },
    })
  })

  it('resolves a token theme through the command runtime and file reader', () => {
    const root = mkdtempSync(join(tmpdir(), 'perwrite-theme-source-'))
    try {
      writeFileSync(join(root, 'comparison.json'), JSON.stringify({
        name: 'Sample Theme',
        tokenColors: [{ scope: 'keyword', settings: { foreground: '#123456' } }],
        semanticTokenColors: { variable: '#654321' },
        semanticHighlighting: true,
      }))
      vscodeRuntime.workspace.getConfiguration.mockReturnValue({ get: vi.fn(() => 'Sample') })
      vscodeRuntime.extensions.all = [{
        id: 'sample.theme',
        extensionPath: root,
        packageJSON: {
          contributes: {
            themes: [{ label: 'Sample', id: 'sample.id', path: 'comparison.json', uiTheme: 'vs-dark' }],
          },
        },
      }]
      expect(resolveActiveTokenThemeCommand({ generation: 7 })).toEqual({
        generation: 7,
        result: {
          ok: true,
          value: {
            name: 'Sample Theme',
            type: 'dark',
            tokenColors: [{ scope: 'keyword', settings: { foreground: '#123456' } }],
            semanticTokenColors: { variable: '#654321' },
            semanticHighlighting: true,
          },
        },
      })
    } finally {
      vscodeRuntime.extensions.all = []
      vscodeRuntime.workspace.getConfiguration.mockReset().mockReturnValue({ get: vi.fn(() => undefined) })
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('declares the UI-only manifest and command entry point', async () => {
    const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../package.json', import.meta.url), 'utf8'))
    expect(manifest.extensionKind).toEqual(['ui'])
    expect(manifest.api).toBe('none')
    expect(manifest.contributes.commands).toContainEqual(expect.objectContaining({ command: '_perwrite.resolveActiveTokenTheme' }))
    expect(manifest.activationEvents).toContain('onCommand:_perwrite.resolveActiveTokenTheme')
  })

  it('registers the command through activate', () => {
    const subscriptions: unknown[] = []
    activate({ subscriptions } as never)
    expect(vscodeRuntime.commands.registerCommand).toHaveBeenCalledWith(
      '_perwrite.resolveActiveTokenTheme', resolveActiveTokenThemeCommand,
    )
    expect(subscriptions).toHaveLength(1)
  })
})
