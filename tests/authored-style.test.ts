import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

const AUTHORED_STYLE_FILES = [
  '../webview/theme/styles.css', '../webview/editor/theme.ts',
  '../webview/editor/block-line-numbers.ts', '../webview/editor/ir-state-field.ts',
  '../webview/nodes/code-block-node.ts', '../webview/nodes/katex-node.ts', '../webview/nodes/mermaid-node.ts',
] as const

describe('authored appearance styles', () => {
  it('contains no VS Code variable, authored color token, or CSS fallback', () => {
    const authored = AUTHORED_STYLE_FILES.map(source).join('\n')
    expect(authored).not.toContain('--vscode-')
    expect(source('../webview/theme/styles.css')).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i)
    expect(source('../webview/editor/theme.ts')).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i)
    expect(authored).not.toMatch(/var\(--perwrite-[^),]+\s*,/)
  })

  it('does not select profile-owned font, gutter, or table values directly', () => {
    expect(source('../webview/editor/theme.ts')).not.toMatch(/paddingRight:\s*['"]\d/)
    expect(source('../webview/editor/block-line-numbers.ts')).not.toContain("'13px'")
    expect(source('../webview/theme/styles.css')).not.toMatch(/font-family:\s*monospace/)
    expect(source('../webview/theme/styles.css')).not.toMatch(/\.cm-table-widget\s*\{[^}]*padding:\s*\d/si)
    expect(source('../webview/theme/styles.css')).not.toMatch(/\.cm-(?:editor\s+)?(?:th|table-widget th)[^{]*\{[^}]*padding:\s*\d/si)
  })

  it('draws block ranges through the CodeMirror gutter marker path', () => {
    const gutter = source('../webview/editor/block-line-numbers.ts')
    expect(gutter).toContain('widgetMarker(view, _widget, block)')
    for (const legacy of [
      'ViewPlugin', 'getAppearanceMetrics', 'requestAnimationFrame',
      'scrollDOM.addEventListener', 'getBoundingClientRect', 'font-size:',
      'cm-block-range-overlay',
    ]) {
      expect(gutter).not.toContain(legacy)
    }
  })

  it('removes duplicated widget metrics and the runtime color path', () => {
    const widgets = [
      source('../webview/nodes/code-block-node.ts'), source('../webview/nodes/katex-node.ts'),
      source('../webview/nodes/mermaid-node.ts'), source('../webview/editor/ir-state-field.ts'),
    ].join('\n')
    expect(widgets).not.toMatch(/getEditorLineHeight|editorLineHeight|rows\.length \* 32|\+ 16\s*$/m)
    expect(() => source('../webview/editor/color-utils.ts')).toThrow()
  })
})
