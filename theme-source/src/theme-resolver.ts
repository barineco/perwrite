import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vscode from 'vscode'

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string }

export interface TokenThemeData {
  readonly name: string
  readonly type: string
  readonly tokenColors: readonly unknown[]
  readonly semanticTokenColors: Readonly<Record<string, unknown>>
  readonly semanticHighlighting?: boolean
}

export type ThemeFileReader = (absolutePath: string) => Result<string>

export interface ThemeContribution {
  readonly label: string
  readonly id?: string
  readonly path: string
  readonly uiTheme?: string
  readonly extensionPath: string
}

export interface ActiveThemeSource {
  readonly themeName: string
  readonly contributions: readonly ThemeContribution[]
}

interface ThemeData extends TokenThemeData {
  readonly colors: Readonly<Record<string, string>>
}

interface ParsedThemeFile {
  readonly include?: string
  readonly tokenColorsPath?: string
  readonly data: ThemeData
}

function failure(prefix: string, error: unknown): Result<never> {
  return { ok: false, error: `${prefix}: ${error instanceof Error ? error.message : String(error)}` }
}

function stripJsonComments(raw: string): Result<string> {
  let output = ''
  let inString = false
  let escaped = false

  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]
    const next = raw[index + 1]
    if (inString) {
      output += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      output += char
      continue
    }
    if (char === '/' && next === '/') {
      output += '  '
      index += 2
      while (index < raw.length && raw[index] !== '\n' && raw[index] !== '\r') {
        output += ' '
        index++
      }
      if (index < raw.length) output += raw[index]
      continue
    }
    if (char === '/' && next === '*') {
      output += '  '
      index += 2
      let closed = false
      while (index < raw.length) {
        if (raw[index] === '*' && raw[index + 1] === '/') {
          output += '  '
          index++
          closed = true
          break
        }
        output += raw[index] === '\n' || raw[index] === '\r' ? raw[index] : ' '
        index++
      }
      if (!closed) return { ok: false, error: 'JSONC syntax error: unterminated block comment' }
      continue
    }
    output += char
  }

  if (inString) return { ok: false, error: 'JSONC syntax error: unterminated string' }
  return { ok: true, value: output }
}

function removeTrailingCommas(raw: string): string {
  let output = ''
  let inString = false
  let escaped = false

  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]
    if (inString) {
      output += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      output += char
      continue
    }
    if (char === ',') {
      let lookahead = index + 1
      while (/\s/.test(raw[lookahead] ?? '')) lookahead++
      if (raw[lookahead] === '}' || raw[lookahead] === ']') continue
    }
    output += char
  }
  return output
}

export function parseJsonc(raw: string): Result<unknown> {
  const stripped = stripJsonComments(raw)
  if (!stripped.ok) return stripped
  try {
    return { ok: true, value: JSON.parse(removeTrailingCommas(stripped.value)) }
  } catch (error) {
    return failure('JSONC syntax error', error)
  }
}

function objectValue(value: unknown, label: string): Result<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: `${label} must be an object` }
  }
  return { ok: true, value: value as Record<string, unknown> }
}

function stringMap(value: unknown, label: string): Result<Record<string, string>> {
  if (value === undefined) return { ok: true, value: {} }
  const object = objectValue(value, label)
  if (!object.ok) return object
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(object.value)) {
    if (typeof item !== 'string') return { ok: false, error: `${label}.${key} must be a string` }
    result[key] = item
  }
  return { ok: true, value: result }
}

function unknownMap(value: unknown, label: string): Result<Record<string, unknown>> {
  if (value === undefined) return { ok: true, value: {} }
  return objectValue(value, label)
}

function themeDataFromJson(json: Record<string, unknown>, fallbackName: string, fallbackType: string): Result<ThemeData> {
  const colors = stringMap(json.colors, 'colors')
  if (!colors.ok) return colors
  const semanticTokenColors = unknownMap(json.semanticTokenColors, 'semanticTokenColors')
  if (!semanticTokenColors.ok) return semanticTokenColors

  const rawTokenColors = json.tokenColors ?? json.settings
  if (rawTokenColors !== undefined && !Array.isArray(rawTokenColors) && typeof rawTokenColors !== 'string') {
    return { ok: false, error: 'tokenColors must be an array or file path' }
  }
  if (json.semanticHighlighting !== undefined && typeof json.semanticHighlighting !== 'boolean') {
    return { ok: false, error: 'semanticHighlighting must be a boolean' }
  }

  return {
    ok: true,
    value: {
      name: typeof json.name === 'string' ? json.name : fallbackName,
      type: typeof json.type === 'string' ? json.type : fallbackType,
      colors: colors.value,
      tokenColors: Array.isArray(rawTokenColors) ? rawTokenColors : [],
      semanticTokenColors: semanticTokenColors.value,
      semanticHighlighting: json.semanticHighlighting as boolean | undefined,
    },
  }
}

export function parseThemeJson(raw: string, fallbackName: string, fallbackType: string): Result<ThemeData> {
  const parsed = parseJsonc(raw)
  if (!parsed.ok) return { ok: false, error: `Theme JSON parse failed: ${parsed.error}` }
  const json = objectValue(parsed.value, 'Theme JSON')
  if (!json.ok) return json
  return themeDataFromJson(json.value, fallbackName, fallbackType)
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function parsePlist(raw: string): Result<unknown> {
  const matchedTokens = raw.match(/<\/?(?:plist|dict|array)>|<(?:true|false)\s*\/>|<(?:key|string|integer|real)>[\s\S]*?<\/(?:key|string|integer|real)>/g)
  if (!matchedTokens) return { ok: false, error: 'plist syntax error: no value tokens' }
  const tokens: readonly string[] = matchedTokens
  let index = 0
  if (tokens[index] === '<plist>') index++

  function parseValue(): Result<unknown> {
    const token = tokens[index++]
    if (token === '<dict>') {
      const object: Record<string, unknown> = {}
      while (tokens[index] !== '</dict>') {
        const keyToken = tokens[index++]
        if (!keyToken?.startsWith('<key>')) return { ok: false, error: 'plist syntax error: dictionary key is missing' }
        const key = decodeXml(keyToken.slice(5, -6))
        const value = parseValue()
        if (!value.ok) return value
        object[key] = value.value
        if (index >= tokens.length) return { ok: false, error: 'plist syntax error: unterminated dictionary' }
      }
      index++
      return { ok: true, value: object }
    }
    if (token === '<array>') {
      const array: unknown[] = []
      while (tokens[index] !== '</array>') {
        const value = parseValue()
        if (!value.ok) return value
        array.push(value.value)
        if (index >= tokens.length) return { ok: false, error: 'plist syntax error: unterminated array' }
      }
      index++
      return { ok: true, value: array }
    }
    if (token === '<true/>' || token === '<true />') return { ok: true, value: true }
    if (token === '<false/>' || token === '<false />') return { ok: true, value: false }

    const scalar = token?.match(/^<(string|key|integer|real)>([\s\S]*)<\/\1>$/)
    if (!scalar) return { ok: false, error: 'plist syntax error: invalid value' }
    if (scalar[1] === 'integer' || scalar[1] === 'real') {
      const number = Number(scalar[2])
      return Number.isFinite(number) ? { ok: true, value: number } : { ok: false, error: 'plist value is not numeric' }
    }
    return { ok: true, value: decodeXml(scalar[2]) }
  }

  return parseValue()
}

function tokenRulesFromFile(filePath: string, reader: ThemeFileReader): Result<readonly unknown[]> {
  const read = reader(filePath)
  if (!read.ok) return read
  const extension = path.extname(filePath).toLowerCase()
  const parsed = extension === '.json' || extension === '.jsonc'
    ? parseJsonc(read.value)
    : extension === '.tmtheme'
      ? parsePlist(read.value)
      : { ok: false as const, error: `Unsupported tokenColors file extension: ${extension || '(none)'}` }
  if (!parsed.ok) return { ok: false, error: `tokenColors file ${filePath}: ${parsed.error}` }

  const object = objectValue(parsed.value, `tokenColors file ${filePath}`)
  if (!object.ok) return object
  const rules = object.value.settings ?? object.value.tokenColors
  if (!Array.isArray(rules)) {
    return { ok: false, error: `tokenColors file ${filePath} must contain a settings or tokenColors array` }
  }
  return { ok: true, value: rules }
}

function parseThemeFile(raw: string, fallbackName: string, fallbackType: string): Result<ParsedThemeFile> {
  const parsed = parseJsonc(raw)
  if (!parsed.ok) return { ok: false, error: `Theme file parse failed: ${parsed.error}` }
  const json = objectValue(parsed.value, 'Theme JSON')
  if (!json.ok) return json
  if (json.value.include !== undefined && typeof json.value.include !== 'string') {
    return { ok: false, error: 'include must be a file path' }
  }
  const data = themeDataFromJson(json.value, fallbackName, fallbackType)
  if (!data.ok) return data
  const rawTokenColors = json.value.tokenColors ?? json.value.settings
  return {
    ok: true,
    value: {
      include: json.value.include as string | undefined,
      tokenColorsPath: typeof rawTokenColors === 'string' ? rawTokenColors : undefined,
      data: data.value,
    },
  }
}

function mergeThemes(parent: ThemeData, child: ThemeData): ThemeData {
  return {
    name: child.name,
    type: child.type,
    colors: { ...parent.colors, ...child.colors },
    tokenColors: [...parent.tokenColors, ...child.tokenColors],
    semanticTokenColors: { ...parent.semanticTokenColors, ...child.semanticTokenColors },
    semanticHighlighting: child.semanticHighlighting ?? parent.semanticHighlighting,
  }
}

function tokenThemeData(theme: ThemeData): TokenThemeData {
  const result: TokenThemeData = {
    name: theme.name,
    type: theme.type,
    tokenColors: theme.tokenColors,
    semanticTokenColors: theme.semanticTokenColors,
  }
  return theme.semanticHighlighting === undefined
    ? result
    : { ...result, semanticHighlighting: theme.semanticHighlighting }
}

export function resolveThemeFile(
  entryPath: string,
  reader: ThemeFileReader,
  fallbackName: string,
  fallbackType: string,
): Result<TokenThemeData> {
  const stack = new Set<string>()

  function visit(candidate: string): Result<ThemeData> {
    const canonical = path.resolve(candidate)
    if (stack.has(canonical)) return { ok: false, error: `Theme include cycle: ${canonical}` }
    stack.add(canonical)

    const read = reader(canonical)
    if (!read.ok) {
      stack.delete(canonical)
      return read
    }
    const parsed = parseThemeFile(read.value, fallbackName, fallbackType)
    if (!parsed.ok) {
      stack.delete(canonical)
      return parsed
    }

    let child = parsed.value.data
    if (parsed.value.tokenColorsPath) {
      const tokenPath = path.resolve(path.dirname(canonical), parsed.value.tokenColorsPath)
      const tokens = tokenRulesFromFile(tokenPath, reader)
      if (!tokens.ok) {
        stack.delete(canonical)
        return tokens
      }
      child = { ...child, tokenColors: tokens.value }
    }

    if (!parsed.value.include) {
      stack.delete(canonical)
      return { ok: true, value: child }
    }
    const parent = visit(path.resolve(path.dirname(canonical), parsed.value.include))
    stack.delete(canonical)
    return parent.ok ? { ok: true, value: mergeThemes(parent.value, child) } : parent
  }

  const result = visit(entryPath)
  return result.ok ? { ok: true, value: tokenThemeData(result.value) } : result
}

export function resolveActiveThemeFromSource(
  source: ActiveThemeSource,
  reader: ThemeFileReader,
): Result<TokenThemeData> {
  const contribution = source.contributions.find(theme => theme.label === source.themeName || theme.id === source.themeName)
  if (!contribution) {
    return { ok: false, error: `Theme contribution not found for active color theme: ${source.themeName}` }
  }
  if (!contribution.path) return { ok: false, error: `Theme contribution path is missing: ${source.themeName}` }

  const fallbackType = contribution.uiTheme === 'vs' || contribution.uiTheme === 'hc-light' ? 'light' : 'dark'
  const themePath = path.resolve(contribution.extensionPath, contribution.path)
  return resolveThemeFile(themePath, reader, source.themeName, fallbackType)
}

const fileReader: ThemeFileReader = absolutePath => {
  try {
    return { ok: true, value: fs.readFileSync(absolutePath, 'utf8') }
  } catch (error) {
    return { ok: false, error: `Theme file read failed for ${absolutePath}: ${error instanceof Error ? error.message : String(error)}` }
  }
}

function readActiveThemeName(): Result<string> {
  try {
    const themeName = vscode.workspace.getConfiguration('workbench').get<unknown>('colorTheme')
    if (typeof themeName !== 'string' || themeName.length === 0) {
      return { ok: false, error: 'Active color theme setting is missing' }
    }
    return { ok: true, value: themeName }
  } catch (error) {
    return failure('Active color theme setting could not be read', error)
  }
}

function collectThemeContributions(): Result<readonly ThemeContribution[]> {
  try {
    const contributions: ThemeContribution[] = []
    for (const extension of vscode.extensions.all) {
      const themes = extension.packageJSON?.contributes?.themes
      if (themes === undefined) continue
      if (!Array.isArray(themes)) return { ok: false, error: `Theme contributions are invalid in ${extension.id}` }
      for (const theme of themes) {
        if (typeof theme !== 'object' || theme === null || Array.isArray(theme)) {
          return { ok: false, error: `Theme contribution is invalid in ${extension.id}` }
        }
        const value = theme as Record<string, unknown>
        if (typeof value.label !== 'string' || typeof value.path !== 'string') {
          return { ok: false, error: `Theme contribution label or path is invalid in ${extension.id}` }
        }
        contributions.push({
          label: value.label,
          id: typeof value.id === 'string' ? value.id : undefined,
          path: value.path,
          uiTheme: typeof value.uiTheme === 'string' ? value.uiTheme : undefined,
          extensionPath: extension.extensionPath,
        })
      }
    }
    return { ok: true, value: contributions }
  } catch (error) {
    return failure('Theme contributions could not be read', error)
  }
}

export function resolveActiveTokenTheme(): Result<TokenThemeData> {
  const themeName = readActiveThemeName()
  if (!themeName.ok) return themeName
  const contributions = collectThemeContributions()
  if (!contributions.ok) return contributions
  return resolveActiveThemeFromSource({ themeName: themeName.value, contributions: contributions.value }, fileReader)
}
