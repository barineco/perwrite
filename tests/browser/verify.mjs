import { runBrowserTest } from './harness.mjs'

const variables = [
  '--perwrite-editor-background:#ffffff', '--perwrite-editor-foreground:#202020',
  '--perwrite-font-family:monospace', '--perwrite-font-size:14px', '--perwrite-line-height:1.8',
  '--perwrite-editor-width:900px', '--perwrite-content-padding:24px', '--perwrite-border:#cccccc',
  '--perwrite-gutter-background:#ffffff', '--perwrite-gutter-foreground:#777777',
  '--perwrite-gutter-active-foreground:#202020', '--perwrite-gutter-gap:24px',
  '--perwrite-gutter-compact-gap:8px', '--perwrite-cursor-foreground:#000000',
  '--perwrite-selection-background:#bdddff', '--perwrite-heading-1-scale:2',
  '--perwrite-heading-1-line-height:1.2', '--perwrite-muted-foreground:#666666',
  '--perwrite-diff-removed-background:#ffcccc', '--perwrite-diff-inserted-background:#ccffcc',
  '--perwrite-codeblock-background:#202040',
  '--perwrite-diff-removed-codeblock-background:#902088',
  '--perwrite-diff-inserted-codeblock-background:#209048',
].join(';')

await runBrowserTest({
  prefix: 'perwrite-browser-',
  entryPoint: 'tests/browser/comparison-scenario.ts',
  outfile: 'comparison.js',
  html: `<!doctype html><html style="${variables}"><head><link rel="stylesheet" href="/comparison.css"></head><body><button id="mode-raw">raw</button><button id="mode-rich">rich</button><button id="mode-render">render</button><button id="tex-off">tex off</button><button id="layout-elk">elk</button><button id="layout-dagre">dagre</button><div id="editor"></div><script src="/comparison.js"></script></body></html>`,
  viewport: { width: 1000, height: 500 },
  async run(page, { check }) {
  await page.waitForFunction(() => document.querySelectorAll('.comparison-side .cm-editor').length === 2)
  const initial = await page.evaluate(() => ({
    views: document.querySelectorAll('.comparison-side .cm-editor').length,
    labels: [...document.querySelectorAll('.comparison-label')].map(element => element.textContent),
    removed: document.querySelectorAll('.comparison-original .cm-comparison-removed').length,
    inserted: document.querySelectorAll('.comparison-modified .cm-comparison-inserted').length,
    deletedWidgets: document.querySelectorAll('.cm-deletedChunk').length,
  }))
  check('左右に一つずつ EditorView を構築する', initial.views === 2 && initial.labels.join('|') === 'HEAD|Working Tree', JSON.stringify(initial))
  check('旧文書の変更行を removed、新文書の変更行を inserted として描画する',
    initial.removed > 0 && initial.inserted > 0 && initial.deletedWidgets === 0, JSON.stringify(initial))

  await page.click('#mode-rich')
  check('左右へ同じ rich 表示を適用する', await page.locator('.comparison-side .cm-strong').count() === 0)
  const inlineCodeBackgrounds = await page.evaluate(() => {
    const background = selector => {
      const element = document.querySelector(selector)
      return element ? getComputedStyle(element).backgroundColor : null
    }
    return {
      removed: background('.comparison-original .cm-comparison-removed .cm-inline-code'),
      inserted: background('.comparison-modified .cm-comparison-inserted .cm-inline-code'),
    }
  })
  check('旧文書の行内 code に removed 派生色を適用する',
    inlineCodeBackgrounds.removed === 'rgb(144, 32, 136)', JSON.stringify(inlineCodeBackgrounds))
  check('新文書の行内 code に inserted 派生色を適用する',
    inlineCodeBackgrounds.inserted === 'rgb(32, 144, 72)', JSON.stringify(inlineCodeBackgrounds))
  await page.click('#mode-render')
  await page.waitForSelector('.comparison-side .cm-katex-block')
  await page.waitForFunction(() =>
    document.querySelectorAll('.comparison-side .cm-mermaid-overview > svg').length === 2 ||
    document.querySelectorAll('.comparison-side .cm-mermaid-error').length > 0,
  null, { timeout: 30000 })
  const mermaidFailures = await page.locator('.comparison-side .cm-mermaid-error').allTextContents()
  check('左右で TeX と Mermaid を描画する',
    await page.locator('.comparison-side .cm-katex-block').count() === 2 &&
    await page.locator('.comparison-side .cm-mermaid-overview > svg').count() === 2,
  JSON.stringify({ failures: mermaidFailures }))

  const scroll = await page.evaluate(async () => {
    const left = document.querySelector('.comparison-original .cm-scroller')
    const right = document.querySelector('.comparison-modified .cm-scroller')
    left.scrollTop = 0
    right.scrollTop = 0
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const before = globalThis.comparisonScenario.synchronizationCount()
    const sourceMaximum = left.scrollHeight - left.clientHeight
    const targetMaximum = right.scrollHeight - right.clientHeight
    left.scrollTop = sourceMaximum * 0.47
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return {
      left: left.scrollTop, right: right.scrollTop,
      heightRatioTarget: left.scrollTop / sourceMaximum * targetMaximum,
      applications: globalThis.comparisonScenario.synchronizationCount() - before,
    }
  })
  check('通常 scroll の比率を一度だけ反対側へ適用する',
    scroll.right > 0 && scroll.applications === 1 && Math.abs(scroll.right - scroll.heightRatioTarget) < 2, JSON.stringify(scroll))

  const revealSuppression = await page.evaluate(async () => {
    const state = globalThis.comparisonScenario
    state.original.dispatch({ selection: { anchor: 5 } })
    state.modified.dispatch({ selection: { anchor: 9 } })
    state.original.scrollDOM.scrollTop = 0
    state.modified.scrollDOM.scrollTop = 0
    await new Promise(resolve => requestAnimationFrame(resolve))
    const before = {
      originalSelection: state.original.state.selection.main.head,
      modifiedSelection: state.modified.state.selection.main.head,
      originalScroll: state.original.scrollDOM.scrollTop,
      modifiedScroll: state.modified.scrollDOM.scrollTop,
      synchronizations: state.synchronizationCount(),
    }
    state.reveal('file:modified', state.modified.state.doc.length - 20, state.modified.state.doc.length - 10, 'external')
    await new Promise(resolve => requestAnimationFrame(resolve))
    const suppressed = {
      originalSelection: state.original.state.selection.main.head,
      modifiedSelection: state.modified.state.selection.main.head,
      originalScroll: state.original.scrollDOM.scrollTop,
      modifiedScroll: state.modified.scrollDOM.scrollTop,
      synchronizations: state.synchronizationCount(),
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    state.modified.scrollDOM.scrollTop = Math.max(1, state.modified.scrollDOM.scrollTop - 100)
    state.modified.scrollDOM.dispatchEvent(new Event('scroll'))
    await new Promise(resolve => requestAnimationFrame(resolve))
    return { before, suppressed, resumed: state.synchronizationCount() }
  })
  check('comparison reveal 中は反対 side の scroll/selection を保存し、settling 後の通常 scroll で同期を再開する',
    revealSuppression.suppressed.originalSelection === revealSuppression.before.originalSelection &&
      revealSuppression.suppressed.modifiedSelection === revealSuppression.before.modifiedSelection &&
      revealSuppression.suppressed.originalScroll === revealSuppression.before.originalScroll &&
      revealSuppression.suppressed.synchronizations === revealSuppression.before.synchronizations &&
      revealSuppression.resumed > revealSuppression.suppressed.synchronizations, JSON.stringify(revealSuppression))

  const preserved = await page.evaluate(async () => {
    const state = globalThis.comparisonScenario
    const visibleAnchor = view => {
      const scrollerTop = view.scrollDOM.getBoundingClientRect().top
      for (let number = 1; number <= view.state.doc.lines; number += 1) {
        const line = view.state.doc.line(number)
        const coords = view.coordsAtPos(line.from)
        if (coords && coords.bottom > scrollerTop) {
          return { number, text: line.text, relativeTop: coords.top - scrollerTop }
        }
      }
      return null
    }
    const waitForWidgets = frames => new Promise(resolve => {
      const wait = remaining => remaining === 0 ? resolve() : requestAnimationFrame(() => wait(remaining - 1))
      wait(frames)
    })
    state.original.dispatch({ selection: { anchor: 17 } })
    state.modified.dispatch({ selection: { anchor: 29 } })
    const identities = [state.original.dom, state.modified.dom]
    const anchorsBefore = [visibleAnchor(state.original), visibleAnchor(state.modified)]
    document.querySelector('#tex-off').click()
    document.querySelector('#layout-dagre').click()
    await waitForWidgets(12)
    const anchorsAfter = [visibleAnchor(state.original), visibleAnchor(state.modified)]
    return {
      identities: identities[0] === state.original.dom && identities[1] === state.modified.dom,
      selections: [state.original.state.selection.main.head, state.modified.state.selection.main.head],
      anchorsBefore,
      anchorsAfter,
      mode: state.mode(),
      katex: document.querySelectorAll('.cm-katex-inline, .cm-katex-block').length,
    }
  })
  check('描画設定変更で view・mode・選択・source anchor の viewport 相対位置を保存する',
    preserved.identities && preserved.mode === 'render' && preserved.selections.join('|') === '17|29' &&
    preserved.katex === 0 && preserved.anchorsBefore.every((anchor, index) =>
      anchor && preserved.anchorsAfter[index] && anchor.number === preserved.anchorsAfter[index].number &&
      anchor.text === preserved.anchorsAfter[index].text &&
      Math.abs(anchor.relativeTop - preserved.anchorsAfter[index].relativeTop) < 10),
    JSON.stringify(preserved))

  await page.waitForTimeout(200)
  const targetChange = await page.evaluate(async () => {
    const state = globalThis.comparisonScenario
    const visibleAnchor = view => {
      const scrollerTop = view.scrollDOM.getBoundingClientRect().top
      for (let number = 1; number <= view.state.doc.lines; number += 1) {
        const line = view.state.doc.line(number)
        const coords = view.coordsAtPos(line.from)
        if (coords && coords.bottom > scrollerTop) {
          return { number, text: line.text, relativeTop: coords.top - scrollerTop }
        }
      }
      return null
    }
    const waitForWidgets = frames => new Promise(resolve => {
      const wait = remaining => remaining === 0 ? resolve() : requestAnimationFrame(() => wait(remaining - 1))
      wait(frames)
    })
    const identities = [state.original.dom, state.modified.dom]
    const selections = [state.original.state.selection.main.head, state.modified.state.selection.main.head]
    const anchorsBefore = [visibleAnchor(state.original), visibleAnchor(state.modified)]
    state.update(document.querySelector('#editor'), {
      identity: 'browser-scenario-next', editableSide: 'modified',
      original: { snapshot: globalThis.comparisonSnapshot(state.original.state.doc.toString().replace('Original', 'Previous'), { kind: 'commit', fullHash: '1111111111111111111111111111111111111111' }, { kind: 'commit', requestedRef: 'HEAD~1', documentVersion: 0 }), label: 'HEAD~1', documentId: 'git:earlier', baseResourceUri: 'https://perwrite.test/' },
      modified: { snapshot: globalThis.comparisonSnapshot(state.modified.state.doc.toString().replace('Modified', 'Current_'), { kind: 'working-tree' }, { kind: 'working-tree', documentVersion: 1 }), label: 'Working Tree', documentId: 'file:modified', baseResourceUri: 'https://perwrite.test/' },
    })
    await waitForWidgets(4)
    const anchorsAfter = [visibleAnchor(state.original), visibleAnchor(state.modified)]
    return {
      identities: identities[0] === state.original.dom && identities[1] === state.modified.dom,
      selectionsBefore: selections,
      selectionsAfter: [state.original.state.selection.main.head, state.modified.state.selection.main.head],
      anchorsBefore,
      anchorsAfter,
      labels: [...document.querySelectorAll('.comparison-label')].map(element => element.textContent),
    }
  })
  check('比較対象変更で view・選択・source anchor の viewport 相対位置を保存する',
    targetChange.identities && JSON.stringify(targetChange.selectionsBefore) === JSON.stringify(targetChange.selectionsAfter) &&
    targetChange.anchorsBefore.every((anchor, index) =>
      anchor && targetChange.anchorsAfter[index] && anchor.number === targetChange.anchorsAfter[index].number &&
      Math.abs(anchor.relativeTop - targetChange.anchorsAfter[index].relativeTop) < 2) &&
    targetChange.labels.join('|') === 'HEAD~1|Working Tree', JSON.stringify(targetChange))

  const readOnly = await page.evaluate(() => ({
    original: globalThis.comparisonScenario.original.state.readOnly,
    modified: globalThis.comparisonScenario.modified.state.readOnly,
    originalDom: globalThis.comparisonScenario.original.contentDOM.getAttribute('contenteditable'),
    modifiedDom: globalThis.comparisonScenario.modified.contentDOM.getAttribute('contenteditable'),
  }))
  check('commit 側を読取専用、working-tree 側を編集可能にする',
    readOnly.original && !readOnly.modified && readOnly.originalDom === 'false' && readOnly.modifiedDom === 'true', JSON.stringify(readOnly))
  },
})
