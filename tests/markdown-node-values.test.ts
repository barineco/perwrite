import { syntaxTree } from '@codemirror/language'
import { describe, expect, it } from 'vitest'
import { markdownLinkAt } from '../webview/editor/setup'
import { linkDestination, linkLabel, wikilinkAlias, wikilinkTarget } from '../webview/editor/markdown-node-values'
import { makeState } from './helpers'

function nodeOf(source: string, name: string) {
  const state = makeState(source)
  let found = syntaxTree(state).topNode.getChild(name)
  if (!found) {
    syntaxTree(state).iterate({ enter(node) { if (!found && node.name === name) found = node.node } })
  }
  if (!found) throw new Error(`${name} was not parsed`)
  return { state, node: found }
}

describe('Lezer node values', () => {
  it('reads angle and escaped image destinations from URL nodes', () => {
    const angle = nodeOf('![a\\*lt](<images/a b.png>)', 'Image')
    expect(linkDestination(angle.state, angle.node)).toBe('images/a b.png')
    expect(linkLabel(angle.state, angle.node)).toBe('a*lt')

    const escaped = nodeOf('![alt](images/a\\(b\\).png)', 'Image')
    expect(linkDestination(escaped.state, escaped.node)).toBe('images/a(b).png')
  })

  it('reads link destinations and wikilink aliases from syntax nodes', () => {
    const link = nodeOf('[label](<page name.md>)', 'Link')
    expect(markdownLinkAt(link.state, 2)).toBe('page name.md')

    const wiki = nodeOf('[[Page Name|shown alias]]', 'Wikilink')
    expect(wikilinkTarget(wiki.state, wiki.node)).toBe('Page Name')
    expect(wikilinkAlias(wiki.state, wiki.node)).toBe('shown alias')
    expect(markdownLinkAt(wiki.state, 4)).toBe('Page Name.md')
  })
})
