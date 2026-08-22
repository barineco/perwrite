import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as imageWidget from '../webview/editor/image-widget'
import * as listWidget from '../webview/editor/list-widget'
import * as tableWidget from '../webview/editor/table-widget'
import * as widgetAdapters from '../webview/editor/widget-adapters'

const root = join(process.cwd(), 'webview/editor')
const implementationModules = ['image-widget.ts', 'list-widget.ts', 'table-widget.ts', 'widget-adapters.ts']

function source(module: string): string {
  return readFileSync(join(root, module), 'utf8')
}

function namedImportsFrom(src: string, moduleSpecifier: string): Array<{ typeOnly: boolean; names: string[] }> {
  const specifierPattern = moduleSpecifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`import\\s+(type\\s+)?\\{([^}]*)\\}\\s*from\\s*['"]${specifierPattern}['"]`, 'g')
  const results: Array<{ typeOnly: boolean; names: string[] }> = []
  let match: RegExpExecArray | null
  while ((match = re.exec(src))) {
    const typeOnly = Boolean(match[1])
    const names = match[2]
      .split(',')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const asMatch = part.match(/^(?:type\s+)?(\S+)\s+as\s+(\S+)$/)
        return asMatch ? asMatch[2] : part.replace(/^type\s+/, '')
      })
    results.push({ typeOnly, names })
  }
  return results
}

describe('Decoration module inventory', () => {
  it('対象 module と正本の導出入口が存在する', () => {
    for (const module of [...implementationModules, 'ir-state-field.ts']) {
      expect(existsSync(join(root, module)), module).toBe(true)
    }
    expect(source('ir-state-field.ts')).toContain('export const irDecorationField')
    expect(source('ir-state-field.ts')).toContain('export function buildIrPresentation')
    expect(source('ir-state-field.ts')).toMatch(/import\s*\{\s*nodeRenderData\s*\}\s*from\s*['"]\.\/ir-node-render-registry['"]/)
  })

  it('Widget 実装は分割先の公開 export から直接取得できる', () => {
    expect(imageWidget.ImageWidget).toBeDefined()
    expect(imageWidget.resolveImageSrc).toBeDefined()
    expect(imageWidget.setBaseResourceUri).toBeDefined()
    expect(listWidget.ListBulletWidget).toBeDefined()
    expect(listWidget.ListNumberWidget).toBeDefined()
    expect(listWidget.CheckboxWidget).toBeDefined()
    expect(tableWidget.TableWidget).toBeDefined()
    expect(widgetAdapters.SourceTextWidget).toBeDefined()
    expect(widgetAdapters.applyTableDomNode).toBeDefined()
    expect(widgetAdapters.browserTableDomAdapter).toBeDefined()
  })

  it('正本は分割先への互換 re-export と Widget 実装本体を持たない', () => {
    const irStateSource = source('ir-state-field.ts')
    expect(irStateSource).not.toMatch(/export\s*\{[^}]+\}\s*from\s*['"]\.\/(?:image-widget|list-widget|table-widget|widget-adapters)['"]/)
    expect(irStateSource).not.toMatch(/class\s+(?:ImageWidget|ListBulletWidget|ListNumberWidget|CheckboxWidget|SourceTextWidget|TableWidget)\b/)
    expect(source('image-widget.ts')).toContain('export class ImageWidget')
    expect(source('list-widget.ts')).toContain('export class ListBulletWidget')
    expect(source('table-widget.ts')).toContain('export class TableWidget')
    expect(source('widget-adapters.ts')).toContain('export class SourceTextWidget')
  })

  it('装飾設定へ passThrough を載せず、識別子回避の文字列連結を持たない', () => {
    const irStateSource = source('ir-state-field.ts')
    expect(irStateSource).not.toMatch(/passThrough\s*:/)
    expect(irStateSource).toContain('export type IrPresentation')
    expect(irStateSource).toContain('atomicRanges')
    expect(irStateSource).not.toMatch(/\bderiveLink\b/)
    expect(existsSync(join(root, 'ir-display-derivation.ts'))).toBe(true)
    expect(existsSync(join(root, 'ir-node-render-registry.ts'))).toBe(true)
    expect(existsSync(join(root, 'ir-fenced-code-registry.ts'))).toBe(true)
    expect(source('ir-display-derivation.ts')).toContain('deriveLink')
    expect(source('ir-display-derivation.ts')).not.toMatch(/export const nodeRenderData/)
    expect(source('ir-display-derivation.ts')).not.toMatch(/fencedCodeResolverByLang/)
    expect(source('ir-display-derivation.ts')).not.toMatch(/function materialsFor/)
    expect(source('ir-node-render-registry.ts')).toContain('export const nodeRenderData')
    expect(source('ir-node-render-registry.ts')).toContain('function materialsFor')
    expect(source('ir-node-render-registry.ts')).not.toMatch(/export const deriveLink/)
    expect(source('ir-fenced-code-registry.ts')).toContain('fencedCodeResolverByLang')
    expect(source('ir-fenced-code-registry.ts')).toContain('resolveMermaidFencedCode')
    expect(source('ir-fenced-code-registry.ts')).not.toMatch(/deriveFencedCode/)
    expect(source('decoration-options.ts')).not.toMatch(/passThrough/)
    expect(source('render-rules.ts')).toContain("export const checkboxMarkerNode = 'TaskMarker'")
    expect(source('render-rules.ts')).not.toMatch(/'Ta'\s*\+\s*'skMarker'/)
    expect(source('ir-state-field.ts')).not.toMatch(/'sp'\s*\+\s*'ec'/)
    expect(source('ir-state-field.ts')).not.toMatch(/Reflect\.get/)
    expect(source('ir-display-derivation.ts')).not.toMatch(/'sp'\s*\+\s*'ec'/)
    expect(source('ir-display-derivation.ts')).not.toMatch(/Reflect\.get/)
  })

  it('提示面の産出入口が buildIrPresentation 一つに定まり、atomic 範囲の読み取り module が存在しない', () => {
    expect(source('ir-state-field.ts')).not.toMatch(/(?:^|\s)function\s+buildDecorationsWithDiagnostic\s*\(/)
    expect(source('ir-state-field.ts')).not.toMatch(/(?:^|\s)const\s+buildDecorationsWithDiagnostic\s*=/)
    expect(source('ir-state-field.ts')).not.toMatch(/(?:^|\s)function\s+buildDecorations\s*\(/)
    expect(source('ir-state-field.ts')).not.toMatch(/(?:^|\s)const\s+buildDecorations\s*=/)
    expect(existsSync(join(root, 'ir-atomic-ranges.ts'))).toBe(false)
    expect(source('ir-display-derivation.ts')).not.toMatch(/\bnodeRenderData\b/)
    expect(source('ir-display-derivation.ts')).not.toMatch(/\bfencedCodeResolverByLang\b/)
  })

  it('導出は node registry から型のみ、fenced registry から値のみを読む', () => {
    const derivationSource = source('ir-display-derivation.ts')

    const nodeRegistryImports = namedImportsFrom(derivationSource, './ir-node-render-registry')
    expect(nodeRegistryImports.length).toBe(1)
    expect(nodeRegistryImports[0].typeOnly).toBe(true)
    expect(nodeRegistryImports[0].names).toEqual(['NodeRenderData'])

    const fencedRegistryImports = namedImportsFrom(derivationSource, './ir-fenced-code-registry')
    expect(fencedRegistryImports.length).toBe(1)
    expect(fencedRegistryImports[0].typeOnly).toBe(false)
    expect(fencedRegistryImports[0].names).toEqual(['resolveFencedCodeWidget'])

    for (const registry of ['ir-node-render-registry', 'ir-fenced-code-registry']) {
      const references = derivationSource.match(new RegExp(`['"\`][^'"\`]*${registry}['"\`]`, 'g')) ?? []
      expect(references.length, registry).toBe(1)
    }
  })

  it('TableWidget 導出は専用 projection と viewport module を持たない', () => {
    expect(existsSync(join(root, 'rich-table-projection.ts'))).toBe(false)
    expect(existsSync(join(root, 'rich-table-viewport.ts'))).toBe(false)
    const references = [
      source('ir-state-field.ts'),
      source('ir-display-derivation.ts'),
      source('setup.ts'),
      readFileSync(join(process.cwd(), 'webview/index.ts'), 'utf8'),
      readFileSync(join(process.cwd(), 'webview/appearance.ts'), 'utf8'),
      readFileSync(join(process.cwd(), 'webview/theme/styles.css'), 'utf8'),
    ].join('\n')
    expect(references).not.toMatch(/rich-table-(projection|viewport)|richTable|RichTable|TableProjection/)
    expect(references).not.toMatch(/logicalViewportCapacity|tableHorizontalViewport|documentViewportAnchor|reconfigureLogicalViewportCapacity|cm-rich-table-/)
    expect(references).toContain('TableWidget')
    expect(references).toContain('invalidateEditorAppearances')
  })

  it('Webview の resource URI 接続は image-widget を直接参照する', () => {
    const indexSource = readFileSync(join(process.cwd(), 'webview/index.ts'), 'utf8')
    expect(indexSource).toContain("import { setBaseResourceUri } from './editor/image-widget'")
    expect(indexSource).not.toContain("from './editor/ir-state-field'")
  })
})
