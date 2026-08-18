import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => {
  class Uri {
    public readonly scheme: string
    public readonly fsPath: string
    public readonly path: string
    public readonly query: string

    private constructor(scheme: string, fsPath: string, query = '') {
      this.scheme = scheme
      this.fsPath = fsPath
      this.path = fsPath
      this.query = query
    }

    static file(fsPath: string): Uri { return new Uri('file', fsPath) }

    with(change: { scheme?: string; query?: string }): Uri {
      return new Uri(change.scheme ?? this.scheme, this.fsPath, change.query ?? this.query)
    }
  }

  const commands = new Map<string, (...args: unknown[]) => unknown>()
  const executeCommand = vi.fn()
  const getCommit = vi.fn()
  const show = vi.fn()

  return { Uri, commands, executeCommand, getCommit, show }
})

vi.mock('vscode', () => ({
  Uri: runtime.Uri,
  TabInputCustom: class {},
  TabInputText: class {},
  TabInputTextDiff: class {},
  extensions: {
    getExtension: () => ({
      isActive: true,
      exports: {
        getAPI: () => ({
          getRepository: () => ({
            rootUri: runtime.Uri.file('/repo'),
            getCommit: runtime.getCommit,
            show: runtime.show,
          }),
        }),
      },
    }),
  },
  commands: {
    executeCommand: runtime.executeCommand,
    registerCommand: (id: string, callback: (...args: unknown[]) => unknown) => {
      runtime.commands.set(id, callback)
      return { dispose() {} }
    },
  },
  window: {
    activeTextEditor: undefined,
    tabGroups: { activeTabGroup: { activeTab: undefined } },
    showWarningMessage: vi.fn(),
    registerCustomEditorProvider: () => ({ dispose() {} }),
  },
  workspace: {
    asRelativePath: (uri: { fsPath: string }) => uri.fsPath.replace('/repo/', ''),
    textDocuments: [],
    onDidChangeConfiguration: () => ({ dispose() {} }),
    onDidChangeTextDocument: () => ({ dispose() {} }),
    getConfiguration: () => ({ get: () => undefined }),
    fs: { stat: vi.fn() },
  },
  env: { openExternal: vi.fn() },
}))

import { activate } from '../src/extension'

beforeEach(() => {
  runtime.commands.clear()
  runtime.executeCommand.mockReset().mockResolvedValue(undefined)
  runtime.getCommit.mockReset().mockResolvedValue({ hash: 'a'.repeat(40), parents: ['b'.repeat(40)] })
  runtime.show.mockReset().mockResolvedValue('commit content')
})

describe('Timeline commit comparison', () => {
  it('resolves a moving ref once and opens immutable target and parent hashes', async () => {
    activate({ subscriptions: [], extensionUri: runtime.Uri.file('/extension') } as any)

    const command = runtime.commands.get('perwrite.openCommitComparison')
    await command?.(
      { ref: 'moving-ref', contextValue: 'git:file:commit' },
      runtime.Uri.file('/repo/docs/note.md'),
      { source: 'git' },
    )

    expect(runtime.getCommit).toHaveBeenCalledTimes(1)
    expect(runtime.getCommit).toHaveBeenCalledWith('moving-ref')
    expect(runtime.show.mock.calls.map(([ref]: [string]) => ref)).toEqual(['a'.repeat(40), 'b'.repeat(40)])
    expect(runtime.executeCommand).toHaveBeenCalledWith(
      'vscode.diff',
      expect.objectContaining({ scheme: 'git', query: JSON.stringify({ path: '/repo/docs/note.md', ref: 'b'.repeat(40) }) }),
      expect.objectContaining({ scheme: 'git', query: JSON.stringify({ path: '/repo/docs/note.md', ref: 'a'.repeat(40) }) }),
      `docs/note.md (${'b'.repeat(40)} ↔ ${'a'.repeat(40)})`,
    )
  })
})
