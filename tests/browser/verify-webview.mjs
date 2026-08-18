import { createHash } from 'node:crypto'
import { runBrowserTest } from './harness.mjs'

const snapshot = (content, revisionIdentity, provenance) => ({ physicalUri: 'file:///repo/note.md', revisionIdentity, content, contentHash: createHash('sha256').update(content, 'utf8').digest('hex'), provenance })
const comparison = {
  identity: 'comparison-a', editableSide: 'modified',
  original: { snapshot: snapshot('# Original\n\nold', { kind: 'commit', fullHash: '0000000000000000000000000000000000000000' }, { kind: 'commit', requestedRef: 'HEAD', documentVersion: 0 }), label: 'HEAD', documentId: 'git:head', baseResourceUri: 'https://perwrite.test/' },
  modified: { snapshot: snapshot('# Modified\n\nnew', { kind: 'working-tree' }, { kind: 'working-tree', documentVersion: 1 }), label: 'Working Tree', documentId: 'file:work', baseResourceUri: 'https://perwrite.test/' },
}
const comparisonB = { ...comparison, identity: 'comparison-b', original: { ...comparison.original, snapshot: snapshot('# Earlier\n\nold', { kind: 'commit', fullHash: '1111111111111111111111111111111111111111' }, { kind: 'commit', requestedRef: 'HEAD~1', documentVersion: 0 }), label: 'HEAD~1' } }
const readonlyDocument = { snapshot: snapshot('# Initial commit\n\nimmutable', { kind: 'commit', fullHash: '2222222222222222222222222222222222222222' }, { kind: 'commit', requestedRef: 'root-hash', documentVersion: 0 }), target: 'root-hash', reason: 'This commit has no parent to compare', documentId: 'file:///repo/note.md?revision=root-hash', baseResourceUri: 'https://perwrite.test/' }

await runBrowserTest({
  prefix: 'perwrite-webview-',
  entryPoint: 'tests/browser/host-scenario.ts',
  outfile: 'host.js',
  format: 'esm',
  target: 'es2022',
  html: `<!doctype html><html><head><link rel="stylesheet" href="/host.css"></head><body><div id="toolbar"><span>Perwrite</span><div class="comparison-targets"><input id="comparison-original" value="HEAD"><input id="comparison-modified" value="working-tree"><button id="apply-comparison">Compare</button></div><button id="toggle-view">Render</button><button id="toggle-diff">Diff</button></div><div id="editor"></div><script type="module" src="/host.js"></script></body></html>`,
  viewport: { width: 1000, height: 800 },
  async run(page, { check }) {
  await page.waitForFunction(() => globalThis.perwriteHost?.outbound.some(message => message.type === 'ready'))
  await page.evaluate(() => globalThis.perwriteHost.sendInit({
    ok: false, error: 'Invalid perwrite.defaultViewMode: expected raw, rich, or render',
  }))
  await page.waitForSelector('#configuration-error')
  check('初期 Invalid では EditorView を構築しない', await page.locator('.cm-editor').count() === 0)
  await page.evaluate(() => globalThis.perwriteHost.sendExternalUpdate('# Updated while invalid\n\n$x^2$'))

  const valid = { defaultViewMode: 'render', configurationFailure: null, rendering: { generation: 1, codeBlockWrap: true, mermaidLayout: 'elk', mermaidMaxEdges: 1024, mermaidPanStep: 80, mermaidZoomStep: 1.5, texRendering: true } }
  await page.evaluate(value => globalThis.perwriteHost.sendConfiguration({ ok: true, value }), valid)
  await page.waitForSelector('.cm-editor')
  check('有効設定で EditorView を構築して失敗を消す', await page.locator('#configuration-error').count() === 0)

  const injected = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--perwrite-editor-background').trim())
  check('DOM の --vscode-* から --perwrite-* が DOM 由来色になる', injected === '#123456', injected)
  await page.evaluate(() => globalThis.perwriteHost.setVscodeColor('--vscode-editor-background', '#654321'))
  await page.waitForFunction(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--perwrite-editor-background').trim() === '#654321')
  const followed = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--perwrite-editor-background').trim())
  check('--vscode-* の変更に --perwrite-* が追随する', followed === '#654321', followed)
  check('初期 Invalid 中の外部更新から EditorView を構築する',
    (await page.locator('.cm-content').textContent()).includes('Updated while invalid'))
  await page.evaluate(() => { globalThis.editorIdentity = document.querySelector('.cm-editor') })

  await page.evaluate(() => globalThis.perwriteHost.sendConfiguration({
    ok: false, error: 'Invalid perwrite.texRendering: expected a boolean',
  }))
  await page.waitForSelector('#configuration-error')
  check('変更 Invalid で既存 EditorView を保存する', await page.evaluate(() => document.querySelector('.cm-editor') === globalThis.editorIdentity))

  const recovered = { defaultViewMode: 'raw', configurationFailure: null, rendering: { generation: 2, codeBlockWrap: false, mermaidLayout: 'dagre', mermaidMaxEdges: 1024, mermaidPanStep: 80, mermaidZoomStep: 1.5, texRendering: false } }
  await page.evaluate(value => globalThis.perwriteHost.sendConfiguration({ ok: true, value }), recovered)
  await page.waitForFunction(() => !document.querySelector('#configuration-error'))
  const signature = await page.evaluate(() => ({
    sameView: document.querySelector('.cm-editor') === globalThis.editorIdentity,
    mode: document.querySelector('#toggle-view')?.textContent,
    katex: document.querySelectorAll('.cm-katex-inline, .cm-katex-block').length,
    text: document.querySelector('.cm-content')?.textContent,
  }))
  check('復帰時に同じ EditorView と現在モードを保存する', signature.sameView && signature.mode === 'Render', JSON.stringify(signature))
  check('TeX 無効を parser と widget へ適用する', signature.katex === 0 && signature.text.includes('$x^2$'), JSON.stringify(signature))

  await page.evaluate(value => globalThis.perwriteHost.sendConfiguration({ ok: true, value }), valid)
  const staleGeneration = await page.evaluate(() => ({
    sameView: document.querySelector('.cm-editor') === globalThis.editorIdentity,
    mode: document.querySelector('#toggle-view')?.textContent,
    wrappingDisabled: document.querySelector('.cm-editor')?.classList.contains('cm-codeblock-wrap-disabled'),
  }))
  check('後着した古い configuration generation を effect 0 件で破棄する',
    staleGeneration.sameView && staleGeneration.mode === 'Render' && staleGeneration.wrappingDisabled,
    JSON.stringify(staleGeneration))

  await page.evaluate(() => globalThis.perwriteHost.dispatchNormalChange('A'))
  await page.waitForFunction(() => globalThis.perwriteHost.outbound.some(message =>
    message.type === 'edit' && message.target?.kind === 'editing' && message.changes?.[0]?.insert === 'A'))
  const normalA = await page.evaluate(() => globalThis.perwriteHost.outbound.findLast(message =>
    message.type === 'edit' && message.target?.kind === 'editing' && message.changes?.[0]?.insert === 'A'))
  const countAfterA = await page.evaluate(() => globalThis.perwriteHost.outbound.filter(message => message.type === 'edit').length)
  await page.evaluate(() => globalThis.perwriteHost.dispatchNormalChange('B'))
  await page.waitForTimeout(400)
  const countBeforeObservation = await page.evaluate(() => globalThis.perwriteHost.outbound.filter(message => message.type === 'edit').length)
  check('通常編集 B は A observation 前に送信しない', countBeforeObservation === countAfterA,
    JSON.stringify({ normalA, countAfterA, countBeforeObservation }))

  const staleBefore = await page.evaluate(() => globalThis.perwriteHost.stateWitness())
  await page.evaluate(request => globalThis.perwriteHost.sendObservation(request, 2, { editId: 'stale-edit' }), normalA)
  const staleAfter = await page.evaluate(() => globalThis.perwriteHost.stateWitness())
  check('stale 成功結果は DOM・selection・表示 session・failure・配送を変更しない',
    JSON.stringify(staleAfter) === JSON.stringify(staleBefore), JSON.stringify({ staleBefore, staleAfter }))

  const staleFailureBefore = await page.evaluate(() => globalThis.perwriteHost.stateWitness())
  await page.evaluate(request => globalThis.perwriteHost.sendFailure(request, { editId: 'stale-failure' }), normalA)
  const staleFailureAfter = await page.evaluate(() => globalThis.perwriteHost.stateWitness())
  check('stale failure は DOM・content・selection・version・session state・failure 表示を変更しない',
    JSON.stringify(staleFailureAfter) === JSON.stringify(staleFailureBefore),
    JSON.stringify({ staleFailureBefore, staleFailureAfter }))

  await page.evaluate(request => globalThis.perwriteHost.sendObservation(request, 2), normalA)
  await page.waitForFunction(() => globalThis.perwriteHost.outbound.some(message =>
    message.type === 'edit' && message.baseDocumentVersion === 2 && message.changes?.[0]?.insert === 'B'))
  const normalB = await page.evaluate(() => globalThis.perwriteHost.outbound.findLast(message =>
    message.type === 'edit' && message.baseDocumentVersion === 2 && message.changes?.[0]?.insert === 'B'))
  check('A observation 後の B は appliedDocumentVersion を一度だけ使う',
    normalB.target.documentId === normalA.target.documentId && normalB.sessionGeneration === normalA.sessionGeneration,
    JSON.stringify({ normalA, normalB }))
  await page.evaluate(request => globalThis.perwriteHost.sendObservation(request, 3), normalB)

  await page.evaluate(() => globalThis.perwriteHost.dispatchNormalChange('C'))
  await page.waitForFunction(() => globalThis.perwriteHost.outbound.some(message => message.type === 'edit' && message.changes?.[0]?.insert === 'C'))
  const recoveryA = await page.evaluate(() => globalThis.perwriteHost.outbound.findLast(message => message.type === 'edit' && message.changes?.[0]?.insert === 'C'))
  const afterRecoveryA = await page.evaluate(() => globalThis.perwriteHost.stateWitness().content)
  await page.evaluate(() => globalThis.perwriteHost.dispatchNormalChange('D'))
  await page.waitForTimeout(400)
  await page.evaluate(({ request, content }) => globalThis.perwriteHost.sendConflict(request, 10, content), { request: recoveryA, content: afterRecoveryA })
  await page.waitForSelector('#edit-error button')
  const recoveryButtons = await page.locator('#edit-error button').allTextContents()
  check('HostDocumentObservation は再試行と明示破棄を表示する',
    JSON.stringify(recoveryButtons) === JSON.stringify(['再試行', '待機中の編集を破棄']), JSON.stringify(recoveryButtons))
  await page.getByRole('button', { name: '再試行' }).click()
  await page.waitForFunction(() => globalThis.perwriteHost.outbound.some(message =>
    message.type === 'edit' && message.baseDocumentVersion === 10 && message.changes?.[0]?.insert === 'D'))
  const recoveryB = await page.evaluate(() => globalThis.perwriteHost.outbound.findLast(message =>
    message.type === 'edit' && message.baseDocumentVersion === 10 && message.changes?.[0]?.insert === 'D'))
  const retriedWitness = await page.evaluate(() => globalThis.perwriteHost.stateWitness())
  check('HostDocumentObservation recovery は queued input を DOM へ戻して新しい版から再送する',
    retriedWitness.content.endsWith('CD') && retriedWitness.failure === null, JSON.stringify({ recoveryB, retriedWitness }))
  await page.evaluate(request => globalThis.perwriteHost.sendObservation(request, 11), recoveryB)

  const mismatchFailureBefore = await page.evaluate(() => globalThis.perwriteHost.stateWitness())
  await page.evaluate(({ request, content }) => globalThis.perwriteHost.sendMismatchedFailureSnapshot(request, content), {
    request: recoveryB, content: mismatchFailureBefore.content,
  })
  const mismatchFailureAfter = await page.evaluate(() => globalThis.perwriteHost.stateWitness())
  check('対象が不一致の failure snapshot は content と表示状態を保存する',
    JSON.stringify(mismatchFailureAfter) === JSON.stringify(mismatchFailureBefore),
    JSON.stringify({ mismatchFailureBefore, mismatchFailureAfter }))

  await page.evaluate(() => globalThis.perwriteHost.dispatchNormalChange('E'))
  await page.waitForFunction(() => globalThis.perwriteHost.outbound.some(message => message.type === 'edit' && message.changes?.[0]?.insert === 'E'))
  const discardA = await page.evaluate(() => globalThis.perwriteHost.outbound.findLast(message => message.type === 'edit' && message.changes?.[0]?.insert === 'E'))
  const afterDiscardA = await page.evaluate(() => globalThis.perwriteHost.stateWitness().content)
  await page.evaluate(() => globalThis.perwriteHost.dispatchNormalChange('F'))
  await page.waitForTimeout(400)
  await page.evaluate(({ request, content }) => globalThis.perwriteHost.sendConflict(request, 20, content), { request: discardA, content: afterDiscardA })
  await page.getByRole('button', { name: '待機中の編集を破棄' }).click()
  const discardWitness = await page.evaluate(() => globalThis.perwriteHost.stateWitness())
  check('queued input の破棄は利用者 click だけで recovery を解消して結果を表示する',
    discardWitness.content.endsWith('E') && discardWitness.failure.includes('Queued edit discarded'), JSON.stringify(discardWitness))

  await page.click('#toggle-diff')
  const request = await page.evaluate(() => globalThis.perwriteHost.outbound.at(-1))

  await page.evaluate(({ requestId, comparison }) => globalThis.perwriteHost.sendComparisonResult(requestId, comparison), { requestId: request.requestId, comparison })
  await page.waitForFunction(() => document.querySelectorAll('.comparison-side .cm-editor').length === 2)
  await page.evaluate(() => {
    globalThis.leftIdentity = document.querySelector('.comparison-original .cm-editor')
    globalThis.rightIdentity = document.querySelector('.comparison-modified .cm-editor')
  })
  const immutableOriginalBefore = await page.evaluate(() => ({
    content: globalThis.perwriteHost.stateWitness('original').content,
    edits: globalThis.perwriteHost.outbound.filter(message => message.type === 'edit').length,
  }))
  await page.locator('.comparison-original .cm-content').click()
  await page.keyboard.insertText('forbidden')
  await page.waitForTimeout(400)
  const immutableOriginalAfter = await page.evaluate(() => ({
    content: globalThis.perwriteHost.stateWitness('original').content,
    edits: globalThis.perwriteHost.outbound.filter(message => message.type === 'edit').length,
  }))
  check('comparison の readonly original は共通 scheduler へ edit を送信しない',
    JSON.stringify(immutableOriginalAfter) === JSON.stringify(immutableOriginalBefore),
    JSON.stringify({ immutableOriginalBefore, immutableOriginalAfter }))
  await page.evaluate(() => globalThis.perwriteHost.dispatchComparisonChanges('modified'))
  await page.waitForFunction(() => globalThis.perwriteHost.outbound.some(message =>
    message.type === 'edit' && message.target?.kind === 'comparison' && message.target.side === 'modified' &&
    message.baseDocumentVersion === 1 && message.changes?.length === 1 && message.changes[0].insert === 'ab'))
  const comparisonDelivery = await page.evaluate(() =>
    globalThis.perwriteHost.outbound.findLast(message => message.type === 'edit' && message.target?.kind === 'comparison' && message.changes?.[0]?.insert === 'ab'))
  check('比較編集の debounce は連続 transaction を一つの ChangeSet へ合成する',
    comparisonDelivery?.changes?.[0]?.from === comparisonDelivery?.changes?.[0]?.to &&
      comparisonDelivery.changes[0].insert === 'ab' && comparisonDelivery.baseDocumentVersion === 1 &&
      comparisonDelivery.target.side === 'modified',
    JSON.stringify(comparisonDelivery))
  const comparisonCountBeforeQueued = await page.evaluate(() => globalThis.perwriteHost.outbound.filter(message => message.type === 'edit').length)
  await page.evaluate(() => globalThis.perwriteHost.dispatchComparisonChange('modified', 'c'))
  await page.waitForTimeout(400)
  const comparisonCountWhileQueued = await page.evaluate(() => globalThis.perwriteHost.outbound.filter(message => message.type === 'edit').length)
  check('comparison modified は observation 前の追加編集を送信しない',
    comparisonCountWhileQueued === comparisonCountBeforeQueued, JSON.stringify({ comparisonCountBeforeQueued, comparisonCountWhileQueued }))
  await page.evaluate(request => globalThis.perwriteHost.sendObservation(request, 2), comparisonDelivery)
  await page.waitForFunction(() => globalThis.perwriteHost.outbound.some(message =>
    message.type === 'edit' && message.target?.side === 'modified' && message.baseDocumentVersion === 2 && message.changes?.[0]?.insert === 'c'))
  const comparisonQueued = await page.evaluate(() => globalThis.perwriteHost.outbound.findLast(message =>
    message.type === 'edit' && message.target?.side === 'modified' && message.baseDocumentVersion === 2 && message.changes?.[0]?.insert === 'c'))
  check('comparison modified は observation の版で追加編集を送る',
    comparisonQueued.target.documentId === comparisonDelivery.target.documentId, JSON.stringify(comparisonQueued))
  await page.evaluate(request => globalThis.perwriteHost.sendObservation(request, 3), comparisonQueued)
  const comparisonPreservationBefore = await page.evaluate(() => ({
    original: globalThis.perwriteHost.stateWitness('original'), modified: globalThis.perwriteHost.stateWitness('modified'),
  }))
  await page.evaluate(() => globalThis.perwriteHost.sendComparisonExternalUpdate('comparison-a', 'modified', '# Modified\n\nexternal'))
  const comparisonPreservationAfter = await page.evaluate(() => ({
    original: globalThis.perwriteHost.stateWitness('original'), modified: globalThis.perwriteHost.stateWitness('modified'),
  }))
  check('comparison modified の observation は original view を保存する',
    comparisonPreservationBefore.original.content === comparisonPreservationAfter.original.content &&
      comparisonPreservationAfter.modified.content.includes('external'),
    JSON.stringify({ comparisonPreservationBefore, comparisonPreservationAfter }))

  const originalEditable = { ...comparison, identity: 'comparison-original-editable', editableSide: 'original' }
  await page.evaluate(() => {
    document.querySelector('#comparison-original').value = 'HEAD'
    document.querySelector('#comparison-modified').value = 'working-tree'
    document.querySelector('#apply-comparison').click()
  })
  const originalRequest = await page.evaluate(() => globalThis.perwriteHost.outbound.at(-1))
  check('comparison original fixture は新しい比較要求を発行する', originalRequest?.type === 'comparison-request', JSON.stringify(originalRequest))
  await page.evaluate(({ requestId, comparison }) => globalThis.perwriteHost.sendComparisonResult(requestId, comparison), { requestId: originalRequest.requestId, comparison: originalEditable })
  await page.waitForFunction(() => document.querySelector('.comparison-original .cm-content')?.getAttribute('contenteditable') === 'true')
  await page.evaluate(() => globalThis.perwriteHost.dispatchComparisonChange('original', 'x'))
  await page.waitForFunction(() => globalThis.perwriteHost.outbound.some(message =>
    message.type === 'edit' && message.target?.side === 'original' && message.changes?.[0]?.insert === 'x'))
  const originalA = await page.evaluate(() => globalThis.perwriteHost.outbound.findLast(message =>
    message.type === 'edit' && message.target?.side === 'original' && message.changes?.[0]?.insert === 'x'))
  const originalCount = await page.evaluate(() => globalThis.perwriteHost.outbound.filter(message => message.type === 'edit').length)
  await page.evaluate(() => globalThis.perwriteHost.dispatchComparisonChange('original', 'y'))
  await page.waitForTimeout(400)
  check('comparison original は observation 前の追加編集を送信しない',
    await page.evaluate(count => globalThis.perwriteHost.outbound.filter(message => message.type === 'edit').length === count, originalCount))
  await page.evaluate(request => globalThis.perwriteHost.sendObservation(request, 1), originalA)
  await page.waitForFunction(() => globalThis.perwriteHost.outbound.some(message =>
    message.type === 'edit' && message.target?.side === 'original' && message.baseDocumentVersion === 1 && message.changes?.[0]?.insert === 'y'))
  const originalB = await page.evaluate(() => globalThis.perwriteHost.outbound.findLast(message =>
    message.type === 'edit' && message.target?.side === 'original' && message.baseDocumentVersion === 1 && message.changes?.[0]?.insert === 'y'))
  check('comparison original は observation の版で追加編集を送る', originalB.target.side === 'original', JSON.stringify(originalB))
  await page.evaluate(request => globalThis.perwriteHost.sendObservation(request, 2), originalB)


  await page.evaluate(() => {
    document.querySelector('#comparison-original').value = 'HEAD~1'
    document.querySelector('#comparison-modified').value = 'working-tree'
    document.querySelector('#apply-comparison').click()
  })
  const secondRequest = await page.evaluate(() => globalThis.perwriteHost.outbound.at(-1))
  const pendingBeforeSecondResult = await page.evaluate(() => ({
    presentation: document.body.dataset.comparisonPresentation,
    requestId: document.body.dataset.comparisonRequestId,
    generation: document.body.dataset.comparisonSessionGeneration,
    editors: document.querySelectorAll('.comparison-side .cm-editor').length,
    content: document.querySelector('.comparison-side .cm-content')?.textContent ?? null,
  }))
  check('新しい比較要求は pending と空の比較 DOM を公開する',
    pendingBeforeSecondResult.presentation === 'pending' && pendingBeforeSecondResult.requestId === String(secondRequest.requestId) &&
      pendingBeforeSecondResult.editors === 0 && pendingBeforeSecondResult.content === null,
    JSON.stringify(pendingBeforeSecondResult))
  await page.evaluate(({ requestId, comparison }) => globalThis.perwriteHost.sendComparisonResult(requestId, comparison), { requestId: request.requestId, comparison })
  await page.evaluate(({ requestId, comparison }) => globalThis.perwriteHost.sendComparisonResult(requestId, comparison), { requestId: secondRequest.requestId, comparison: comparisonB })
  await page.waitForFunction(() => document.querySelector('.comparison-label')?.textContent === 'HEAD~1')
  const changedComparison = await page.evaluate(() => ({
    sameLeft: document.querySelector('.comparison-original .cm-editor') === globalThis.leftIdentity,
    sameRight: document.querySelector('.comparison-modified .cm-editor') === globalThis.rightIdentity,
    labels: [...document.querySelectorAll('.comparison-label')].map(element => element.textContent),
    text: [...document.querySelectorAll('.comparison-side .cm-content')].map(element => element.textContent),
  }))
  check('対象変更で旧 EditorView を破棄して最新応答だけを適用する',
    !changedComparison.sameLeft && !changedComparison.sameRight && changedComparison.labels[0] === 'HEAD~1' && changedComparison.text[0].includes('Earlier') &&
      !changedComparison.text.some(text => text.includes('# Original')), JSON.stringify(changedComparison))


  await page.evaluate(() => {
    document.querySelector('#comparison-original').value = 'delayed'
    document.querySelector('#comparison-modified').value = 'working-tree'
    document.querySelector('#apply-comparison').click()
  })
  const delayedReadonlyRequest = await page.evaluate(() => globalThis.perwriteHost.outbound.at(-1))
  await page.evaluate(
    ({ documentValue, configuration }) => globalThis.perwriteHost.sendReadonlyInit(documentValue, { ok: true, value: configuration }),
    { documentValue: readonlyDocument, configuration: recovered },
  )
  await page.waitForSelector('body[data-editor-kind="readonly-commit"] .cm-editor')
  const readonlyBeforeDelayedResult = await page.evaluate(() => globalThis.perwriteHost.stateWitness())
  await page.evaluate(({ requestId, comparison }) => globalThis.perwriteHost.sendComparisonResult(requestId, comparison), {
    requestId: delayedReadonlyRequest.requestId, comparison: comparisonB,
  })
  const readonlyAfterDelayedResult = await page.evaluate(() => globalThis.perwriteHost.stateWitness())
  check('readonly initialization 後の遅延 comparison result は表示 session を変更しない',
    JSON.stringify(readonlyAfterDelayedResult) === JSON.stringify(readonlyBeforeDelayedResult),
    JSON.stringify({ delayedReadonlyRequest, readonlyBeforeDelayedResult, readonlyAfterDelayedResult }))
  const readonlyBefore = await page.evaluate(() => ({
    content: document.querySelector('.readonly-editor .cm-content')?.textContent,
    editable: document.querySelector('.readonly-editor .cm-content')?.getAttribute('contenteditable'),
    reason: document.querySelector('#readonly-info')?.textContent,
    diffHidden: document.querySelector('#toggle-diff')?.hidden,
    comparisons: globalThis.perwriteHost.outbound.filter(message => message.type === 'comparison-request').length,
    edits: globalThis.perwriteHost.outbound.filter(message => message.type === 'edit').length,
  }))
  check('親なし commit は対象名と理由を持つ読み取り専用単一表示になる',
    readonlyBefore.content.includes('Initial commit') &&
      readonlyBefore.editable === 'false' &&
      readonlyBefore.reason.includes('root-hash') &&
      readonlyBefore.reason.includes('no parent') &&
      readonlyBefore.diffHidden,
    JSON.stringify(readonlyBefore))
  const mutation = await page.evaluate(async () => {
    const result = globalThis.perwriteHost.attemptReadonlyMutation()
    document.querySelector('#toggle-diff')?.click()
    await new Promise(resolve => setTimeout(resolve, 400))
    return {
      ...result,
      edits: globalThis.perwriteHost.outbound.filter(message => message.type === 'edit').length,
      comparisons: globalThis.perwriteHost.outbound.filter(message => message.type === 'comparison-request').length,
    }
  })
  check('親なし commit は programmatic transaction でも文書を維持し edit を送信しない',
    mutation.after === mutation.before &&
      mutation.edits === readonlyBefore.edits &&
      mutation.comparisons === readonlyBefore.comparisons,
    JSON.stringify(mutation))
  },
})
