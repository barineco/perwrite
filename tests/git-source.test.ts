import { describe, expect, it } from 'vitest'
import {
  createGitComparison,
  decodeGitCommit,
  readCommitInitializationSnapshots,
  readRevisionSnapshot,
  gitExtensionMissingError,
  outsideRepositoryError,
  relativePathInRepository,
  resolveGitDocumentUri,
  resolveUriComparison,
  revisionLabel,
  type GitExtension,
  type GitExtensionProvider,
  type GitRepository,
  type GitUri,
} from '../src/git-source'

function fakeRepository(
  rootFsPath: string,
  show: GitRepository['show'],
  getCommit: GitRepository['getCommit'] = async () => ({}),
): GitRepository {
  return { rootUri: { fsPath: rootFsPath }, show, getCommit }
}

function fakeProvider(options: { extension?: boolean; repository?: GitRepository | null }): GitExtensionProvider {
  const extension: GitExtension | undefined = options.extension === false ? undefined : {
    isActive: true,
    exports: { getAPI: () => ({ getRepository: () => options.repository ?? null }) },
    activate: async () => ({ getAPI: () => ({ getRepository: () => options.repository ?? null }) }),
  }
  return { getExtension: () => extension }
}

const document: GitUri = { scheme: 'file', fsPath: '/repo/docs/note.md' }

describe('Git URI の revision 解決', () => {
  it('file・index・commit を判別する', () => {
    expect(resolveGitDocumentUri(document, 'modified')).toEqual({
      ok: true,
      value: { revision: { kind: 'working-tree' }, actualFsPath: '/repo/docs/note.md' },
    })
    expect(resolveGitDocumentUri({ scheme: 'vscode-remote', fsPath: document.fsPath }, 'modified')).toEqual({
      ok: true,
      value: { revision: { kind: 'working-tree' }, actualFsPath: '/repo/docs/note.md' },
    })
    expect(resolveGitDocumentUri({
      scheme: 'git', fsPath: '/virtual', query: JSON.stringify({ path: '/repo/docs/note.md', ref: '' }),
    }, 'original')).toEqual({
      ok: true,
      value: { revision: { kind: 'index' }, actualFsPath: '/repo/docs/note.md' },
    })
    expect(resolveGitDocumentUri({
      scheme: 'git', fsPath: '/virtual', query: JSON.stringify({ path: '/repo/docs/note.md', ref: '~' }),
    }, 'original')).toEqual({
      ok: true,
      value: { revision: { kind: 'index' }, actualFsPath: '/repo/docs/note.md' },
    })
    expect(resolveGitDocumentUri({
      scheme: 'git', fsPath: '/virtual', query: JSON.stringify({ path: '/repo/docs/note.md', ref: 'abc123' }),
    }, 'original')).toEqual({
      ok: true,
      value: { revision: { kind: 'commit', ref: 'abc123' }, actualFsPath: '/repo/docs/note.md' },
    })
  })

  it('壊れた query は side と対象を持つ失敗になる', () => {
    const result = resolveGitDocumentUri({ scheme: 'git', fsPath: '/virtual', query: '{' }, 'original')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatchObject({ kind: 'invalid-uri', side: 'original', target: 'git' })
  })

  it('左右交換で内容の revision と編集可能な側も交換される', () => {
    const index: GitUri = {
      scheme: 'git', fsPath: '/virtual', query: JSON.stringify({ path: document.fsPath, ref: '' }),
    }
    const remoteDocument: GitUri = { scheme: 'vscode-remote', fsPath: document.fsPath }
    expect(resolveUriComparison(index, remoteDocument)).toEqual({
      ok: true,
      value: {
        comparison: createGitComparison({ kind: 'index' }, { kind: 'working-tree' }),
        actualFsPath: document.fsPath,
      },
    })
    expect(resolveUriComparison(remoteDocument, index)).toEqual({
      ok: true,
      value: {
        comparison: createGitComparison({ kind: 'working-tree' }, { kind: 'index' }),
        actualFsPath: document.fsPath,
      },
    })
    expect(resolveUriComparison(document, index)).toEqual({
      ok: true,
      value: {
        comparison: createGitComparison({ kind: 'working-tree' }, { kind: 'index' }),
        actualFsPath: document.fsPath,
      },
    })
  })

  it('Remote-SSH 文書と commit URI を比較する', () => {
    const remoteDocument: GitUri = { scheme: 'vscode-remote', fsPath: document.fsPath }
    const commit: GitUri = {
      scheme: 'git', fsPath: '/virtual', query: JSON.stringify({ path: document.fsPath, ref: 'abc123' }),
    }
    expect(resolveUriComparison(commit, remoteDocument)).toEqual({
      ok: true,
      value: {
        comparison: createGitComparison({ kind: 'commit', ref: 'abc123' }, { kind: 'working-tree' }),
        actualFsPath: document.fsPath,
      },
    })
  })

  it('未知の document scheme を型付き失敗へ変換する', () => {
    expect(resolveUriComparison(
      { scheme: 'untitled', fsPath: document.fsPath },
      document,
    )).toEqual({
      ok: false,
      error: {
        kind: 'comparison-unresolved',
        side: 'original',
        target: 'untitled',
        detail: 'Unsupported document scheme: untitled',
      },
    })
  })

  it('異なる文書と同じ revision を拒否する', () => {
    const other: GitUri = { scheme: 'file', fsPath: '/repo/docs/other.md' }
    const remoteDocument: GitUri = { scheme: 'vscode-remote', fsPath: document.fsPath }
    expect(resolveUriComparison(document, other)).toMatchObject({ ok: false, error: { kind: 'different-document' } })
    expect(resolveUriComparison(document, document)).toMatchObject({ ok: false, error: { kind: 'comparison-unresolved' } })
    expect(resolveUriComparison(remoteDocument, remoteDocument)).toMatchObject({ ok: false, error: { kind: 'comparison-unresolved' } })
  })
})

describe('revision snapshot の取得と失敗', () => {
  it.each([[{ kind: 'index' } as const, '', { kind: 'index' }], [{ kind: 'commit', ref: 'HEAD' } as const, 'resolved-hash', { kind: 'commit', fullHash: 'resolved-hash' }]])('%s を snapshot として取得する', async (revision, expectedRef, identity) => {
    const repository = fakeRepository('/repo', async (ref, path) => { expect(ref).toBe(expectedRef); expect(path).toBe('docs/note.md'); return 'content' }, async () => ({ hash: 'resolved-hash', parents: [] }))
    expect(await readRevisionSnapshot(fakeProvider({ repository }), document, revision)).toMatchObject({ ok: true, value: { physicalUri: document.fsPath, revisionIdentity: identity, content: 'content', provenance: revision.kind === 'commit' ? { kind: 'commit', requestedRef: 'HEAD', documentVersion: 0 } : { kind: 'index', documentVersion: 0 } } })
  })

  it('working tree の content と version を同じ snapshot に観測する', async () => {
    expect(await readRevisionSnapshot(fakeProvider({ repository: null }), document, { kind: 'working-tree' }, 'modified', { content: 'working', documentVersion: 7 })).toMatchObject({ ok: true, value: { physicalUri: document.fsPath, revisionIdentity: { kind: 'working-tree' }, content: 'working', provenance: { kind: 'working-tree', documentVersion: 7 } } })
  })

  it('拡張不在と repository 外を区別する', async () => {
    expect(await readRevisionSnapshot(fakeProvider({ extension: false }), document, { kind: 'index' })).toMatchObject({ ok: false, error: { kind: 'git-extension-missing' } })
    expect(await readRevisionSnapshot(fakeProvider({ repository: null }), document, { kind: 'index' })).toMatchObject({ ok: false, error: { kind: 'outside-repository' } })
  })
})

describe('commit snapshot の hash identity と第一親', () => {
  it('ref を一度だけ解決し、対象と第一親を hash で取得する', async () => {
    const getCommitRefs: string[] = []; const shownRefs: string[] = []
    const repository = fakeRepository('/repo', async ref => { shownRefs.push(ref); return ref === 'target-a' ? 'target content' : 'parent content' }, async ref => { getCommitRefs.push(ref); return { hash: 'target-a', parents: ['parent-a'] } })
    const result = await readCommitInitializationSnapshots(fakeProvider({ repository }), document, 'moving')
    expect(result).toMatchObject({ ok: true, value: { target: { revisionIdentity: { kind: 'commit', fullHash: 'target-a' }, content: 'target content', provenance: { kind: 'commit', requestedRef: 'moving' } }, parent: { revisionIdentity: { kind: 'commit', fullHash: 'parent-a' }, content: 'parent content', provenance: { kind: 'commit', requestedRef: 'parent-a' } } } })
    expect(getCommitRefs).toEqual(['moving']); expect(shownRefs).toEqual(['target-a', 'parent-a'])
  })
  it('親なし commit は target snapshot だけを返す', async () => {
    const repository = fakeRepository('/repo', async ref => `${ref} content`, async () => ({ hash: 'root-hash', parents: [] }))
    expect(await readCommitInitializationSnapshots(fakeProvider({ repository }), document, 'root-ref')).toMatchObject({ ok: true, value: { target: { revisionIdentity: { kind: 'commit', fullHash: 'root-hash' }, provenance: { kind: 'commit', requestedRef: 'root-ref' } }, parent: null } })
  })
  it('不正な commit を show 前に失敗へ変換する', async () => {
    let showCalls = 0; const repository = fakeRepository('/repo', async () => (showCalls++, 'unused'), async () => ({ hash: 'target', parents: 'parent' }))
    expect(await readCommitInitializationSnapshots(fakeProvider({ repository }), document, 'bad')).toMatchObject({ ok: false, error: { kind: 'commit-invalid' } }); expect(showCalls).toBe(0)
  })
})

describe('相対パスの算出', () => {
  it('root 配下だけを相対パスへ変換する', () => {
    expect(relativePathInRepository('/repo', '/repo/docs/note.md')).toBe('docs/note.md')
    expect(relativePathInRepository('/repo/', '/repo/note.md')).toBe('note.md')
    expect(relativePathInRepository('/repo', '/repository/note.md')).toBeNull()
  })
})
