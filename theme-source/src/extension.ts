import * as vscode from 'vscode'
import { resolveActiveTokenTheme, type Result, type TokenThemeData } from './theme-resolver'

export interface ResolveActiveTokenThemeInput {
  readonly generation: number
}

export interface ResolveActiveTokenThemeOutput {
  readonly generation: number
  readonly result: Result<TokenThemeData>
}

function isInput(value: unknown): value is ResolveActiveTokenThemeInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const generation = (value as Record<string, unknown>).generation
  return typeof generation === 'number' && Number.isFinite(generation)
}

export function resolveActiveTokenThemeCommand(input: unknown): ResolveActiveTokenThemeOutput {
  if (!isInput(input)) {
    return {
      generation: 0,
      result: { ok: false, error: 'Command input must contain a finite numeric generation' },
    }
  }
  return { generation: input.generation, result: resolveActiveTokenTheme() }
}

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(
    '_perwrite.resolveActiveTokenTheme',
    resolveActiveTokenThemeCommand,
  )
  context.subscriptions.push(disposable)
}

export function deactivate(): void {}
