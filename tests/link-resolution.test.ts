import { describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => {
  class Uri {
    readonly scheme: string
    readonly path: string
    readonly fsPath: string
    private constructor(value: string) {
      const match = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(value)
      this.scheme = match?.[1] ?? 'file'
      this.path = match ? `/${match[2].split(/[?#]/, 1)[0]}` : value
      this.fsPath = this.path
    }
    static file(path: string) { return new Uri(`file://${path}`) }
    static parse(value: string) { return new Uri(value) }
    static joinPath(uri: Uri, ...parts: string[]) {
      const segments = `${uri.fsPath}/${parts.join('/')}`.split('/')
      const result: string[] = []
      for (const segment of segments) {
        if (!segment || segment === '.') continue
        if (segment === '..') result.pop()
        else result.push(segment)
      }
      return Uri.file(`/${result.join('/')}`)
    }
    toString() { return `${this.scheme}://${this.fsPath.replace(/^\//, '')}` }
  }
  return { Uri }
})

vi.mock('vscode', () => ({ Uri: runtime.Uri }))

import { headingSlug, headingTarget, headingTargets, resolveLink } from '../src/link-resolution'

const uri = runtime.Uri.file('/repo/docs/source.md')

describe('link resolution', () => {
  it('resolves supported external schemes and rejects unsupported schemes', () => {
    for (const destination of ['http://example.test/a', 'https://example.test/a', 'mailto:user@example.test']) {
      expect(resolveLink(uri, '', destination).kind).toBe('external')
    }
    expect(resolveLink(uri, '', 'command:workbench.action').kind).toBe('failure')
    expect(resolveLink(uri, '', 'vscode://file/work').kind).toBe('failure')
    expect(resolveLink(uri, '', 'javascript:alert(1)').kind).toBe('failure')
  })

  it('resolves relative paths from the physical document parent', () => {
    expect(resolveLink(uri, '', '../other.md')).toMatchObject({ kind: 'document', uri: runtime.Uri.file('/repo/other.md') })
    expect(resolveLink(uri, '', 'child.md#section')).toMatchObject({ kind: 'document-fragment', uri: runtime.Uri.file('/repo/docs/child.md'), fragment: 'section' })
  })

  it('resolves same-document and another-document fragments', () => {
    const content = '# Intro\n\n## 日本語 _section-1_\n\n## 日本語 _section-1_\n'
    expect(resolveLink(uri, content, '#日本語-_section-1_')).toMatchObject({ kind: 'same-document-fragment', fragment: '日本語-_section-1_' })
    expect(resolveLink(uri, content, 'other.md#日本語-_section-1_')).toMatchObject({ kind: 'document-fragment', fragment: '日本語-_section-1_' })
  })

  it('derives ATX and setext headings with UTF-16 offsets and duplicate slugs', () => {
    const content = '前😀\n# 日本語 _section-1_\nTitle\n===\n# 日本語 _section-1_\n'
    expect(headingTargets(content)).toEqual([
      { slug: '日本語-_section-1_', from: 6, to: 21 },
      { slug: 'title', from: 22, to: 27 },
      { slug: '日本語-_section-1_-1', from: 34, to: 49 },
    ])
    expect(headingTarget(content, '日本語-_section-1_-1')).toMatchObject({ from: 34, to: 49 })
    expect(headingSlug('日本語 _section-1_')).toBe('日本語-_section-1_')
  })

  it('reports URI fragment decode failure', () => {
    expect(headingTarget('## Heading', '%E0%A4%A')).toBeNull()
    expect(resolveLink(uri, '## Heading', '#%E0%A4%A')).toMatchObject({ kind: 'failure' })
  })
})
