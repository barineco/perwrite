import * as vscode from 'vscode'

export interface HeadingTarget {
  readonly slug: string
  readonly from: number
  readonly to: number
}

export type LinkResolution =
  | { readonly kind: 'external'; readonly uri: vscode.Uri }
  | { readonly kind: 'document'; readonly uri: vscode.Uri }
  | { readonly kind: 'same-document-fragment'; readonly uri: vscode.Uri; readonly fragment: string; readonly range: HeadingTarget }
  | { readonly kind: 'document-fragment'; readonly uri: vscode.Uri; readonly fragment: string }
  | { readonly kind: 'failure'; readonly reason: string }

function decodeFragment(fragment: string): string | null {
  try {
    return decodeURIComponent(fragment)
  } catch {
    return null
  }
}

function splitDestination(destination: string): { readonly path: string; readonly fragment: string | null } {
  const fragmentIndex = destination.indexOf('#')
  return fragmentIndex < 0
    ? { path: destination, fragment: null }
    : { path: destination.slice(0, fragmentIndex), fragment: destination.slice(fragmentIndex + 1) }
}

function hasScheme(destination: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(destination)
}

export function headingSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, character => character === '_' || character === '-' ? character : '')
    .replace(/\s+/gu, '-')
}

function atxHeading(line: string): { readonly text: string; readonly from: number; readonly to: number } | null {
  const match = /^(?: {0,3})(#{1,6})(?:[ \t]+|$)(.*)$/.exec(line)
  if (!match) return null
  const source = match[2].replace(/[ \t]+#+[ \t]*$/, '')
  const textOffset = line.length - match[2].length
  return { text: source, from: textOffset, to: textOffset + source.length }
}

function setextUnderline(line: string): boolean {
  return /^(?: {0,3})(?:=+|-+)[ \t]*$/.test(line)
}

export function headingTargets(content: string): readonly HeadingTarget[] {
  const headings: HeadingTarget[] = []
  const occurrences = new Map<string, number>()
  const lines = content.split('\n')
  let offset = 0
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const atx = atxHeading(line)
    const setext = index + 1 < lines.length && line.trim().length > 0 && setextUnderline(lines[index + 1])
      ? { text: line.trim(), from: line.indexOf(line.trim()), to: line.indexOf(line.trim()) + line.trim().length }
      : null
    const heading = atx ?? setext
    if (heading) {
      const baseSlug = headingSlug(heading.text)
      const duplicate = occurrences.get(baseSlug) ?? 0
      occurrences.set(baseSlug, duplicate + 1)
      headings.push({ slug: duplicate === 0 ? baseSlug : `${baseSlug}-${duplicate}`, from: offset + heading.from, to: offset + heading.to })
    }
    offset += line.length + 1
  }
  return headings
}

export function headingTarget(content: string, fragment: string): HeadingTarget | null {
  const decoded = decodeFragment(fragment)
  if (decoded === null) return null
  return headingTargets(content).find(candidate => candidate.slug === decoded) ?? null
}

export function resolveLink(physicalUri: vscode.Uri, content: string, destination: string): LinkResolution {
  const split = splitDestination(destination)
  if (hasScheme(split.path)) {
    const scheme = split.path.slice(0, split.path.indexOf(':')).toLowerCase()
    if (scheme !== 'http' && scheme !== 'https' && scheme !== 'mailto') return { kind: 'failure', reason: `Unsupported link scheme: ${scheme}` }
    try {
      return { kind: 'external', uri: vscode.Uri.parse(destination) }
    } catch {
      return { kind: 'failure', reason: 'External URI is invalid' }
    }
  }

  if (split.path.length === 0) {
    if (split.fragment === null) return { kind: 'failure', reason: 'Link destination is empty' }
    const range = headingTarget(content, split.fragment)
    return range
      ? { kind: 'same-document-fragment', uri: physicalUri, fragment: split.fragment, range }
      : { kind: 'failure', reason: `Heading not found: ${split.fragment}` }
  }

  let uri: vscode.Uri
  try {
    uri = vscode.Uri.joinPath(vscode.Uri.joinPath(physicalUri, '..'), split.path)
  } catch {
    return { kind: 'failure', reason: 'Document destination is invalid' }
  }
  return split.fragment === null
    ? { kind: 'document', uri }
    : { kind: 'document-fragment', uri, fragment: split.fragment }
}
