import { runBrowserTest } from './harness.mjs'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
const variables = [
  '--perwrite-editor-background:#ffffff', '--perwrite-editor-foreground:#202020',
  '--perwrite-font-family:monospace', '--perwrite-font-size:14px', '--perwrite-line-height:1.8',
  '--perwrite-editor-width:900px', '--perwrite-content-padding:24px', '--perwrite-border:#cccccc',
  '--perwrite-gutter-background:#ffffff', '--perwrite-gutter-foreground:#777777',
  '--perwrite-gutter-active-foreground:#202020', '--perwrite-gutter-gap:24px',
  '--perwrite-gutter-compact-gap:8px', '--perwrite-cursor-foreground:#000000',
  '--perwrite-selection-background:#bdddff', '--perwrite-heading-1-scale:2',
  '--perwrite-heading-1-line-height:1.2', '--perwrite-muted-foreground:#666666',
].join(';')

await runBrowserTest({
  prefix: 'perwrite-interactions-',
  entryPoint: 'tests/browser/interaction-scenario.ts',
  outfile: 'interaction.js',
  html: `<!doctype html><html style="${variables}"><head><link rel="stylesheet" href="/interaction.css"></head><body><div id="editor"></div><script src="/interaction.js"></script></body></html>`,
  viewport: { width: 900, height: 600 },
  async run(page, { check }) {
    await page.waitForFunction(() => globalThis.interactionScenario?.view)
    await page.evaluate(() => globalThis.interactionScenario.shikiReady)

    const reset = (doc, anchor) => page.evaluate(
      ({ doc, anchor }) => globalThis.interactionScenario.reset(doc, anchor),
      { doc, anchor },
    )
    const snapshot = () => page.evaluate(() => globalThis.interactionScenario.snapshot())
    const shikiWitness = () => page.evaluate(() => globalThis.interactionScenario.shikiWitness())
    const waitForCompositionEnd = () => page.waitForFunction(
      () => !globalThis.interactionScenario.snapshot().compositionActive,
    )
    const waitForCodeBlockWrap = (generation, enabled, mode) => page.waitForFunction(
      ({ expectedGeneration, expectedEnabled, expectedMode }) => {
        const witness = globalThis.interactionScenario.codeBlockWrapWitness()
        const compositionEnded = !globalThis.interactionScenario.snapshot().compositionActive
        const common = compositionEnded && witness.state.generation === expectedGeneration &&
          witness.state.enabled === expectedEnabled && witness.mode === expectedMode &&
          witness.clientWidth > 0 && witness.editorClientWidth > 0 &&
          witness.editorScrollWidth <= witness.editorClientWidth + 1
        return expectedEnabled
          ? common && witness.whiteSpace === 'break-spaces' && witness.overflowWrap === 'anywhere' &&
              witness.scrollWidth <= witness.clientWidth + 1 && witness.rectTops.length >= 2
          : common && witness.whiteSpace === 'pre' && witness.overflowWrap === 'normal' &&
              witness.scrollWidth > witness.clientWidth && witness.rectTops.length === 1
      },
      { expectedGeneration: generation, expectedEnabled: enabled, expectedMode: mode },
    )
    const setMode = mode => page.evaluate(
      modeValue => globalThis.interactionScenario.setMode(modeValue),
      mode,
    )
    const setSelection = anchor => page.evaluate(
      position => globalThis.interactionScenario.setSelection(position),
      anchor,
    )
    const clickSourcePosition = async (position) => {
      const point = await page.evaluate((sourcePosition) => {
        const rect = globalThis.interactionScenario.view.coordsAtPos(sourcePosition)
        return rect ? { x: rect.left + 0.1, y: (rect.top + rect.bottom) / 2 } : null
      }, position)
      if (!point) throw new Error(`No source coordinates for ${position}`)
      await page.mouse.click(point.x, point.y)
    }
    const clickRenderedCodeOffset = async (offset, side = 'before') => {
      const point = await page.evaluate(({ offset: targetOffset, side: targetSide }) => {
        const code = document.querySelector('.cm-shiki-codeblock code')
        if (!code) return null
        const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT)
        let remaining = targetOffset
        let node = walker.nextNode()
        while (node) {
          const length = node.data.length
          if (remaining < length || (remaining === length && targetSide === 'after')) {
            const start = targetSide === 'after' ? Math.max(0, remaining - 1) : remaining
            const end = Math.min(length, start + 1)
            const range = document.createRange()
            range.setStart(node, start)
            range.setEnd(node, end)
            const rect = range.getBoundingClientRect()
            return {
              x: targetSide === 'after' ? rect.right - 0.1 : rect.left + 0.1,
              y: (rect.top + rect.bottom) / 2,
            }
          }
          remaining -= length
          node = walker.nextNode()
        }
        return null
      }, { offset, side })
      if (!point) throw new Error(`No rendered code coordinates for ${offset}`)
      await page.mouse.click(point.x, point.y)
    }

    const longCodeLine = [
      'const ascii = "' + 'a'.repeat(120) + '";',
      'const spaced = "alpha     beta     gamma     ' + 'delta '.repeat(20) + '";',
      'const url = "https://example.test/' + 'segment/'.repeat(24) + '";',
      'const unicode = "日本語と結合文字éとemoji😀' + '長い文字列'.repeat(30) + '";',
    ].join('\n')
    const wrappingDoc = 'before\n\n```ts\n' + longCodeLine + '\n```\n\nafter'
    await reset(wrappingDoc, 1)
    await page.evaluate(() => { globalThis.codeBlockWrapEditorIdentity = document.querySelector('.cm-editor') })
    const wrappingWitnesses = []
    for (const mode of ['raw', 'rich', 'render']) {
      await setMode(mode)
      const enabledGeneration = await page.evaluate(() => globalThis.interactionScenario.reconfigureCodeBlockWrap(true))
      await waitForCodeBlockWrap(enabledGeneration, true, mode)
      const enabled = await page.evaluate(() => globalThis.interactionScenario.codeBlockWrapWitness())
      const disabledGeneration = await page.evaluate(() => globalThis.interactionScenario.reconfigureCodeBlockWrap(false))
      await waitForCodeBlockWrap(disabledGeneration, false, mode)
      const disabled = await page.evaluate(() => globalThis.interactionScenario.codeBlockWrapWitness())
      wrappingWitnesses.push({ mode, enabled, disabled })
    }
    const wrappingIdentity = await page.evaluate(() => document.querySelector('.cm-editor') === globalThis.codeBlockWrapEditorIdentity)
    check('raw・rich・render の code block は有効時に実寸で折り返し、無効時に論理行を保持する',
      wrappingWitnesses.every(({ mode, enabled, disabled }) =>
        enabled.mode === mode && disabled.mode === mode &&
        enabled.whiteSpace === 'break-spaces' && enabled.overflowWrap === 'anywhere' &&
        enabled.scrollWidth <= enabled.clientWidth + 1 && enabled.rectTops.length >= 2 &&
        disabled.whiteSpace === 'pre' && disabled.rectTops.length === 1 &&
        disabled.scrollWidth > disabled.clientWidth &&
        disabled.editorScrollWidth <= disabled.editorClientWidth + 1),
      JSON.stringify(wrappingWitnesses))
    check('折り返しの再構成は EditorView・source・selection を保存する',
      wrappingIdentity && wrappingWitnesses.every(({ enabled, disabled }) =>
        enabled.doc === wrappingDoc && disabled.doc === wrappingDoc &&
        enabled.selection === 1 && disabled.selection === 1 &&
        enabled.state.generation < disabled.state.generation),
      JSON.stringify({ wrappingIdentity, wrappingWitnesses }))

    await reset('alpha\nbeta\ngamma', 2)
    await setMode('raw')
    await page.evaluate(() => globalThis.interactionScenario.reveal(4, 11))
    const revealModes = []
    for (const mode of ['raw', 'rich', 'render']) {
      await setMode(mode)
      await page.waitForTimeout(10)
      revealModes.push({ mode, witness: await page.evaluate(() => globalThis.interactionScenario.searchRevealWitness()) })
    }
    check('一度設定した external target は raw・rich・render 切替後も同じ range の decoration を再導出する',
      revealModes.every(({ witness }) => witness.target?.source === 'external' &&
        witness.target?.from === 4 && witness.target?.to === 11 &&
        witness.lineOffsets.includes(0) && witness.lineOffsets.includes(6) &&
        witness.exactOffsets[0]?.from === 4 && witness.exactOffsets.at(-1)?.to === 10 &&
        witness.selection[0].head === 2), JSON.stringify(revealModes))

    // SN-1: inspect the concrete target StateField and DOM offsets after every
    // keyboard/button/replace path, then prove a reveal-only redispatch changes
    // neither search state nor CodeMirror history.
    const searchWitness = () => page.evaluate(() => globalThis.interactionScenario.searchRevealWitness())
    const revealOnlyWitness = async () => {
      const before = await searchWitness()
      await page.evaluate(() => globalThis.interactionScenario.repeatRevealOnly())
      await page.waitForTimeout(20)
      return { before, after: await searchWitness() }
    }
    const targetMatchesDom = witness => {
      const target = witness.target
      if (!target) return false
      const selection = witness.selection[0]
      const lineStart = witness.document.lastIndexOf('\n', target.from - 1) + 1
      const expectedDomTo = witness.document[target.to - 1] === '\n' ? target.to - 1 : target.to
      return target.source === 'internal' && target.from === selection.from && target.to === selection.to &&
        witness.lineOffsets.includes(lineStart) &&
        witness.exactOffsets[0]?.from === target.from && witness.exactOffsets.at(-1)?.to === expectedDomTo
    }
    const revealOnlyStable = ({ before, after }) =>
      before.query === after.query && before.replacement === after.replacement &&
      before.document === after.document && JSON.stringify(before.selection) === JSON.stringify(after.selection) &&
      JSON.stringify(before.target) === JSON.stringify(after.target) && before.undoDepth === after.undoDepth

    await reset('needle one\nneedle two\nneedle three', 1)
    await page.keyboard.press(`${modifier}+f`)
    const searchInput = page.locator('.cm-search input[name="search"]')
    const replaceInput = page.locator('.cm-search input[name="replace"]')
    await searchInput.fill('needle')
    // CodeMirror's first findNext at a bare cursor only establishes the match
    // cycle. Establish it through the same panel command before recording Enter.
    await page.locator('.cm-search button[name="next"]').click()
    const operations = []
    await page.keyboard.press('Enter')
    operations.push({ name: 'Enter/findNext', witness: await searchWitness(), revealOnly: await revealOnlyWitness() })
    await page.keyboard.press('Shift+Enter')
    operations.push({ name: 'Shift-Enter/findPrevious', witness: await searchWitness(), revealOnly: await revealOnlyWitness() })
    await page.locator('.cm-search button[name="next"]').click()
    operations.push({ name: 'next button', witness: await searchWitness(), revealOnly: await revealOnlyWitness() })
    await page.locator('.cm-search button[name="prev"]').click()
    operations.push({ name: 'prev button', witness: await searchWitness(), revealOnly: await revealOnlyWitness() })
    await replaceInput.fill('n')
    await page.locator('.cm-search button[name="replace"]').click()
    operations.push({ name: 'short replace button', witness: await searchWitness(), revealOnly: await revealOnlyWitness() })
    await replaceInput.fill('very-long-replacement')
    await page.locator('.cm-search button[name="replace"]').click()
    operations.push({ name: 'long replace button', witness: await searchWitness(), revealOnly: await revealOnlyWitness() })
    check('実 search panel の全操作直後に internal target と line/exact DOM offset が selection と一致する',
      operations.every(operation => targetMatchesDom(operation.witness)), JSON.stringify(operations))
    check('検索操作後の reveal-only transaction は query/replacement/document/selection/target と undoDepth を保存する',
      operations.every(operation => revealOnlyStable(operation.revealOnly)), JSON.stringify(operations))

    const revealWidgetCases = [
      { name: 'hidden marker', source: '**bold**', selector: null, offset: 3 },
      { name: 'fenced code', source: '```ts\nconst x = 1\n```', selector: '.cm-shiki-codeblock', offset: 8 },
      { name: 'table', source: '| A | B |\n| - | - |\n| 1 | 2 |', selector: '.cm-table-widget', offset: 2 },
      { name: 'block math', source: '$$\nx + y\n$$', selector: '.cm-katex-block', offset: 4 },
    ]
    const widgetReveals = []
    for (const item of revealWidgetCases) {
      const document = `${item.name === 'fenced code' ? '$$\nz\n$$' : '```ts\nz\n```'}\n\n${item.source}\n\nafter`
      await reset(document, document.length)
      await setMode('render')
      if (item.selector) await page.waitForSelector(item.selector)
      const unaffectedSelector = item.name === 'fenced code' ? '.cm-katex-block' : '.cm-shiki-codeblock'
      await page.waitForSelector(unaffectedSelector)
      const before = await page.evaluate(({ selector, unaffectedSelector }) => ({
        targetWidget: selector ? document.querySelector(selector) !== null : true,
        unaffectedWidget: document.querySelector(unaffectedSelector) !== null,
      }), { selector: item.selector, unaffectedSelector })
      const sourceFrom = document.indexOf(item.source)
      await page.evaluate(({ from, to }) => globalThis.interactionScenario.reveal(from, to), {
        from: sourceFrom + item.offset, to: sourceFrom + item.offset + 1,
      })
      await page.waitForTimeout(20)
      const after = await page.evaluate(({ selector, unaffectedSelector }) => ({
        witness: globalThis.interactionScenario.searchRevealWitness(),
        targetWidgetGone: selector ? document.querySelector(selector) === null : true,
        unaffectedWidget: document.querySelector(unaffectedSelector) !== null,
        sourceText: document.querySelector('.cm-content')?.textContent,
      }), { selector: item.selector, unaffectedSelector })
      widgetReveals.push({ ...item, document, before, after })
    }
    check('external reveal は render の hidden marker・code・table・block math を source 開示し、対象外 widget を維持する',
      widgetReveals.every(item => item.before.targetWidget && item.before.unaffectedWidget &&
        item.after.targetWidgetGone && item.after.unaffectedWidget &&
        item.after.witness.target?.source === 'external' &&
        item.after.witness.lineOffsets.length >= 1 && item.after.witness.exactOffsets.length >= 1 &&
        item.after.sourceText?.replace(/\s/g, '').includes(item.source.replace(/\s/g, ''))), JSON.stringify(widgetReveals))

    const safeBandDocument = [
      ...Array.from({ length: 90 }, (_, index) => `filler ${index}`),
      'needle bottom',
      ...Array.from({ length: 30 }, (_, index) => `tail ${index}`),
    ].join('\n')
    await reset(safeBandDocument, 0)
    await page.keyboard.press(`${modifier}+f`)
    await page.locator('.cm-search input[name="search"]').fill('needle')
    await page.locator('.cm-search button[name="next"]').click()
    await page.waitForTimeout(80)
    const safeBand = await page.evaluate(() => {
      const view = globalThis.interactionScenario.view
      const witness = globalThis.interactionScenario.searchRevealWitness()
      const rect = view.coordsAtPos(witness.target.from)
      const lineHeight = rect.bottom - rect.top
      return {
        witness, line: { top: rect.top, bottom: rect.bottom },
        band: { top: witness.panel.scrollerTop + lineHeight, bottom: Math.min(witness.panel.scrollerBottom, witness.panel.top) - lineHeight },
      }
    })
    const scrollBeforeStableReveal = safeBand.witness.scrollTop
    await page.evaluate(() => globalThis.interactionScenario.repeatRevealOnly())
    await page.waitForTimeout(40)
    const scrollAfterStableReveal = await page.evaluate(() => globalThis.interactionScenario.searchRevealWitness().scrollTop)
    check('panel の実 top を下端に使う safe band 内へ最下部 findNext target を scroll し、既に band 内なら scrollTop を保存する',
      safeBand.line.top >= safeBand.band.top - 1 && safeBand.line.bottom <= safeBand.band.bottom + 1 &&
        Number.isFinite(safeBand.witness.panel.top) && scrollAfterStableReveal === scrollBeforeStableReveal,
      JSON.stringify({ safeBand, scrollBeforeStableReveal, scrollAfterStableReveal }))

    await reset('abcd', 2)
    await page.keyboard.type('x')
    const typed = await snapshot()
    await page.keyboard.press(`${modifier}+z`)
    const typedUndo = await snapshot()
    await page.keyboard.press(`${modifier}+Shift+z`)
    const typedRedo = await snapshot()
    check('通常文字入力は文書と selection を更新して Undo と Redo で往復する',
      typed.doc === 'abxcd' && typed.ranges[0].head === 3 &&
      typedUndo.doc === 'abcd' && typedUndo.ranges[0].head === 2 &&
      typedRedo.doc === 'abxcd' && typedRedo.ranges[0].head === 3,
      JSON.stringify({ typed, typedUndo, typedRedo }))

    await reset('abcd', 2)
    await page.keyboard.press('Backspace')
    const ordinaryBackward = await snapshot()
    await reset('abcd', 2)
    await page.keyboard.press('Delete')
    const ordinaryForward = await snapshot()
    check('通常 Backspace と Delete は一文字だけを削除する',
      ordinaryBackward.doc === 'acd' && ordinaryBackward.ranges[0].head === 1 &&
      ordinaryForward.doc === 'abd' && ordinaryForward.ranges[0].head === 2,
      JSON.stringify({ ordinaryBackward, ordinaryForward }))
    await page.keyboard.press(`${modifier}+z`)
    const ordinaryForwardUndo = await snapshot()
    await page.keyboard.press(`${modifier}+Shift+z`)
    const ordinaryForwardRedo = await snapshot()
    await reset('abcd', 2)
    await page.keyboard.press('Backspace')
    await page.keyboard.press(`${modifier}+z`)
    const ordinaryBackwardUndo = await snapshot()
    await page.keyboard.press(`${modifier}+Shift+z`)
    const ordinaryBackwardRedo = await snapshot()
    check('通常 Backspace と Delete の Undo と Redo は selection を含めて往復する',
      ordinaryForwardUndo.doc === 'abcd' && ordinaryForwardUndo.ranges[0].head === 2 &&
      ordinaryForwardRedo.doc === 'abd' && ordinaryForwardRedo.ranges[0].head === 2 &&
      ordinaryBackwardUndo.doc === 'abcd' && ordinaryBackwardUndo.ranges[0].head === 2 &&
      ordinaryBackwardRedo.doc === 'acd' && ordinaryBackwardRedo.ranges[0].head === 1,
      JSON.stringify({
        ordinaryForwardUndo, ordinaryForwardRedo,
        ordinaryBackwardUndo, ordinaryBackwardRedo,
      }))

    await reset('- first\n- second', 11)
    await page.keyboard.press('Tab')
    const indented = await snapshot()
    check('Tab は list subtree を一段下げる',
      indented.doc === '- first\n  - second' && indented.ranges[0].head === 13,
      JSON.stringify(indented))
    await page.keyboard.press('Shift+Tab')
    const outdented = await snapshot()
    check('Shift-Tab は list subtree を一段上げる',
      outdented.doc === '- first\n- second' && outdented.ranges[0].head === 11,
      JSON.stringify(outdented))
    await page.keyboard.press(`${modifier}+z`)
    const undoIndent = await snapshot()
    await page.keyboard.press(`${modifier}+Shift+z`)
    const redoIndent = await snapshot()
    check('list 操作の Undo と Redo は文書と selection を往復する',
      undoIndent.doc === '- first\n  - second' && redoIndent.doc === '- first\n- second',
      JSON.stringify({ undoIndent, redoIndent }))

    const modeResults = []
    for (const mode of ['raw', 'rich', 'render']) {
      await reset('- first\n- second', 11)
      await setMode(mode)
      await page.keyboard.press('Tab')
      const down = await snapshot()
      await page.keyboard.press('Shift+Tab')
      const up = await snapshot()
      modeResults.push({ mode, down, up })
    }
    check('raw・rich・render は同じ Tab と Shift-Tab の結果を返す',
      modeResults.every(result =>
        result.down.doc === '- first\n  - second' && result.down.ranges[0].head === 13 &&
        result.up.doc === '- first\n- second' && result.up.ranges[0].head === 11),
      JSON.stringify(modeResults))

    await reset('- item', 6)
    await page.keyboard.press('Enter')
    const listContinuation = await snapshot()
    await reset('> quote', 7)
    await page.keyboard.press('Enter')
    const quoteContinuation = await snapshot()
    check('Markdown keymap は list と quote の Enter を一度だけ継続する',
      listContinuation.doc === '- item\n- ' && quoteContinuation.doc === '> quote\n> ',
      JSON.stringify({ listContinuation, quoteContinuation }))

    const enterHistoryCases = [
      {
        name: '通常 list',
        doc: '- item',
        anchor: 6,
        expected: { doc: '- item\n- ', head: 9 },
      },
      {
        name: 'OrderedList の連番書き換え',
        doc: '1. one\n2. two',
        anchor: 6,
        expected: { doc: '1. one\n2. \n3. two', head: 10 },
      },
      {
        name: '空項目の継続解除',
        doc: '- item\n\n- ',
        anchor: 10,
        expected: { doc: '- item\n\n', head: 8 },
      },
    ]
    const enterHistoryResults = []
    for (const item of enterHistoryCases) {
      await reset(item.doc, item.anchor)
      const before = await snapshot()
      await page.keyboard.press('Enter')
      const applied = await snapshot()
      await page.keyboard.press(`${modifier}+z`)
      const undone = await snapshot()
      await page.keyboard.press(`${modifier}+Shift+z`)
      const redone = await snapshot()
      enterHistoryResults.push({ ...item, before, applied, undone, redone })
    }
    check('list 継続 Enter の三形式は文書と selection を Undo と Redo で往復する',
      enterHistoryResults.every(item =>
        item.before.doc === item.doc && item.before.ranges[0].head === item.anchor &&
        item.applied.doc === item.expected.doc &&
        item.applied.ranges[0].head === item.expected.head &&
        item.undone.doc === item.doc && item.undone.ranges[0].head === item.anchor &&
        item.redone.doc === item.expected.doc &&
        item.redone.ranges[0].head === item.expected.head),
      JSON.stringify(enterHistoryResults))

    await reset('- item', 6)
    await page.keyboard.type('x')
    const typedBeforeEnter = await snapshot()
    await page.keyboard.press('Enter')
    const continuedBetweenTyping = await snapshot()
    await page.keyboard.type('y')
    const typedAfterEnter = await snapshot()
    await page.keyboard.press(`${modifier}+z`)
    const undoTrailingInput = await snapshot()
    await page.keyboard.press(`${modifier}+z`)
    const undoContinuation = await snapshot()
    await page.keyboard.press(`${modifier}+z`)
    const undoLeadingInput = await snapshot()
    check('入力・継続 Enter・入力は三段の Undo と各 selection を保存する',
      typedBeforeEnter.doc === '- itemx' && typedBeforeEnter.ranges[0].head === 7 &&
      continuedBetweenTyping.doc === '- itemx\n- ' &&
      continuedBetweenTyping.ranges[0].head === 10 &&
      typedAfterEnter.doc === '- itemx\n- y' && typedAfterEnter.ranges[0].head === 11 &&
      undoTrailingInput.doc === continuedBetweenTyping.doc &&
      undoTrailingInput.ranges[0].head === continuedBetweenTyping.ranges[0].head &&
      undoContinuation.doc === typedBeforeEnter.doc &&
      undoContinuation.ranges[0].head === typedBeforeEnter.ranges[0].head &&
      undoLeadingInput.doc === '- item' && undoLeadingInput.ranges[0].head === 6,
      JSON.stringify({
        typedBeforeEnter, continuedBetweenTyping, typedAfterEnter,
        undoTrailingInput, undoContinuation, undoLeadingInput,
      }))

    const atomicList = '- ![image](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)\n- item'
    await reset(atomicList, atomicList.length)
    const atomicBefore = await snapshot()
    const atomicBeforeCount = await page.evaluate(() => globalThis.interactionScenario.atomicRangeCount())
    await page.keyboard.press('Enter')
    const atomicContinued = await snapshot()
    const atomicContinuedCount = await page.evaluate(() => globalThis.interactionScenario.atomicRangeCount())
    await page.keyboard.press(`${modifier}+z`)
    const atomicUndone = await snapshot()
    const atomicUndoneCount = await page.evaluate(() => globalThis.interactionScenario.atomicRangeCount())
    await page.keyboard.press(`${modifier}+Shift+z`)
    const atomicRedone = await snapshot()
    check('atomic image を含む list の実 Enter は selection を Undo と Redo で往復する',
      atomicBefore.ranges[0].head === atomicList.length &&
      atomicBeforeCount > 0 &&
      atomicContinued.doc === `${atomicList}\n- ` &&
      atomicContinuedCount > 0 &&
      atomicContinued.ranges[0].head === atomicList.length + 3 &&
      atomicUndone.doc === atomicList && atomicUndone.ranges[0].head === atomicList.length &&
      atomicUndoneCount > 0 &&
      atomicRedone.doc === atomicContinued.doc &&
      atomicRedone.ranges[0].head === atomicContinued.ranges[0].head,
      JSON.stringify({
        atomicBefore, atomicBeforeCount, atomicContinued, atomicContinuedCount,
        atomicUndone, atomicUndoneCount, atomicRedone,
      }))

    await reset('- item', 2)
    await page.keyboard.press('Backspace')
    const listMarkerDeletion = await snapshot()
    await reset('> quote', 2)
    await page.keyboard.press('Backspace')
    const quoteMarkerDeletion = await snapshot()
    check('Markdown Backspace は list と quote の marker を構造単位で削除する',
      listMarkerDeletion.doc === 'item' && quoteMarkerDeletion.doc === 'quote',
      JSON.stringify({ listMarkerDeletion, quoteMarkerDeletion }))

    const taskDoc = '- [ ] task\n\noutside'
    await reset(taskDoc, taskDoc.indexOf('outside') + 3)
    const checkboxPosition = await page.evaluate(() => {
      const target = document.querySelector('.cm-task-checkbox')
      return target ? globalThis.interactionScenario.view.posAtDOM(target) : null
    })
    await page.locator('.cm-task-checkbox').click()
    const task = await snapshot()
    check('checkbox pointer は task marker を切り替えて別行の selection を保存する',
      task.doc === '- [x] task\n\noutside' && task.ranges[0].head === taskDoc.indexOf('outside') + 3,
      JSON.stringify({ checkboxPosition, task }))
    await page.keyboard.press(`${modifier}+z`)
    const taskUndo = await snapshot()
    await page.keyboard.press(`${modifier}+Shift+z`)
    const taskRedo = await snapshot()
    check('task marker の Undo と Redo は文書と selection を往復する',
      taskUndo.doc === taskDoc && taskUndo.ranges[0].head === taskDoc.indexOf('outside') + 3 &&
      taskRedo.doc === '- [x] task\n\noutside' && taskRedo.ranges[0].head === taskDoc.indexOf('outside') + 3,
      JSON.stringify({ taskUndo, taskRedo }))

    const blockDoc = '```ts\nconst x = 1\n```\n\nafter'
    const blockEnd = blockDoc.indexOf('\n\nafter')
    await reset(blockDoc, blockEnd)
    await page.keyboard.press('Backspace')
    const selectedBlock = await snapshot()
    check('block 直後の Backspace は source range を選択する',
      selectedBlock.doc === blockDoc && selectedBlock.ranges[0].from === 0 &&
      selectedBlock.ranges[0].to === blockEnd,
      JSON.stringify(selectedBlock))
    await page.keyboard.press('Backspace')
    const deletedBlock = await snapshot()
    check('選択した block の Backspace は range を削除する',
      deletedBlock.doc === '\n\nafter' && deletedBlock.ranges[0].head === 0,
      JSON.stringify(deletedBlock))
    await page.keyboard.press(`${modifier}+z`)
    const blockUndo = await snapshot()
    await page.keyboard.press(`${modifier}+Shift+z`)
    const blockRedo = await snapshot()
    check('block 削除の Undo と Redo は source selection と caret を往復する',
      blockUndo.doc === blockDoc && blockUndo.ranges[0].from === 0 && blockUndo.ranges[0].to === blockEnd &&
      blockRedo.doc === '\n\nafter' && blockRedo.ranges[0].head === 0,
      JSON.stringify({ blockUndo, blockRedo }))

    const pointerDoc = '```ts\nalpha\n日本語 long\nemoji 😀 end\nz\n```\n\nafter'
    const codeFrom = pointerDoc.indexOf('alpha')
    const sourcePositions = [
      codeFrom + 1,
      codeFrom + 4,
      codeFrom + 'alpha\n日'.length,
      codeFrom + 'alpha\n日本語 long'.length,
      codeFrom + 'alpha\n日本語 long\n'.length,
      codeFrom + 'alpha\n日本語 long\nemoji 😀'.length,
    ]
    const richPointers = []
    for (const position of sourcePositions) {
      await reset(pointerDoc, pointerDoc.length)
      await setMode('rich')
      await clickSourcePosition(position)
      richPointers.push(await snapshot())
    }
    check('rich の複数行 code source はクリックした桁と改行前後を保存する',
      richPointers.every((result, index) =>
        result.doc === pointerDoc && result.ranges[0].head === sourcePositions[index]),
      JSON.stringify(richPointers))

    const renderedTargets = [
      { offset: 1, side: 'before', expected: 1 },
      { offset: 4, side: 'before', expected: 4 },
      { offset: 'alpha\n日'.length, side: 'before', expected: 'alpha\n日'.length },
      {
        offset: 'alpha\n日本語 long'.length,
        side: 'after',
        expected: 'alpha\n日本語 long'.length,
      },
      {
        offset: 'alpha\n日本語 long\n'.length,
        side: 'before',
        expected: 'alpha\n日本語 long\n'.length,
      },
      {
        offset: 'alpha\n日本語 long\nemoji 😀'.length,
        side: 'before',
        expected: 'alpha\n日本語 long\nemoji 😀'.length,
      },
    ]
    const renderedPointers = []
    for (const target of renderedTargets) {
      await reset(pointerDoc, pointerDoc.length)
      await page.waitForSelector('.cm-shiki-codeblock pre.shiki code .line')
      await clickRenderedCodeOffset(target.offset, target.side)
      await page.waitForFunction(() =>
        !document.querySelector('.cm-shiki-codeblock') &&
        document.querySelectorAll('.cm-codeblock-line').length > 0)
      renderedPointers.push({
        snapshot: await snapshot(),
        widgetCount: await page.locator('.cm-shiki-codeblock').count(),
        sourceLineCount: await page.locator('.cm-codeblock-line').count(),
        expected: codeFrom + target.expected,
      })
    }
    check('render の Shiki token はクリックした桁を source offset へ変換して source を開示する',
      renderedPointers.every(result =>
        result.snapshot.doc === pointerDoc &&
        result.snapshot.ranges[0].head === result.expected &&
        result.widgetCount === 0 && result.sourceLineCount >= 6),
      JSON.stringify(renderedPointers))

    await reset(pointerDoc, pointerDoc.length)
    const shikiStates = await page.waitForFunction(() => {
      const witness = globalThis.interactionScenario.shikiWitness()
      return witness.length === 1 && (witness[0].state === 'ready' || witness[0].state === 'fallback') ? witness : false
    })
    const shikiReadyWitness = await shikiStates.jsonValue()
    check('Shiki は表示状態と snapshot identity を同時に公開する',
      shikiReadyWitness.length === 1 &&
      ['ready', 'fallback'].includes(shikiReadyWitness[0].state) &&
      (shikiReadyWitness[0].state === 'fallback' ||
        (Number(shikiReadyWitness[0].snapshotId) > 0 && Number(shikiReadyWitness[0].appearanceVersion) >= 0 &&
          shikiReadyWitness[0].tokenCount > 0)),
      JSON.stringify(shikiReadyWitness))
    const shikiBeforeDetach = await shikiWitness()
    const shikiAfterDetach = await page.evaluate(() => {
      const wrapper = document.querySelector('.cm-shiki-codeblock')
      const before = wrapper?.innerHTML ?? null
      wrapper?.remove()
      return { before, after: wrapper?.innerHTML ?? null, connected: wrapper?.isConnected ?? false }
    })
    check('Shiki wrapper の切断後に DOM snapshot は変更されない',
      shikiAfterDetach.connected === false && shikiAfterDetach.before === shikiAfterDetach.after &&
      shikiBeforeDetach.length === 1,
      JSON.stringify({ shikiBeforeDetach, shikiAfterDetach }))

    const directCode = 'plain 😀 code'
    await reset('x'.repeat(80), 0)
    const directResults = await page.evaluate(({ code, codeFrom, offset }) => ({
      error: globalThis.interactionScenario.clickCodeWidgetSource(code, codeFrom, offset, 'error'),
      unresolved: globalThis.interactionScenario.unresolvedCodeOffsets(code),
      clamped: globalThis.interactionScenario.clampedCodeOffset(code),
    }), {
      code: directCode,
      codeFrom: 20,
      offset: 'plain 😀'.length,
    })
    const actualPlain = await page.evaluate(({ doc, anchor, offset }) =>
      globalThis.interactionScenario.clickActualPlainCode(doc, anchor, offset), {
      doc: pointerDoc,
      anchor: pointerDoc.length,
      offset: 'alpha\n日本語 long\nemoji 😀'.length,
    })
    check('実際の強調表示前 widget は UTF-16 offset へ移動して source を開示する',
      actualPlain.snapshot.ranges[0].head ===
        codeFrom + 'alpha\n日本語 long\nemoji 😀'.length &&
      actualPlain.widgetCount === 0 && actualPlain.sourceLineCount >= 6,
      JSON.stringify(actualPlain))
    check('失敗表示と caret adapter は UTF-16 offset、座標補正、解決不能時の理由を返す',
      directResults.error.ranges[0].head === 20 + 'plain 😀'.length &&
      directResults.unresolved.before.ok === false &&
      directResults.unresolved.after.ok === false &&
      directResults.clamped.offset.ok === true && directResults.clamped.offset.value === 2 &&
      directResults.clamped.calls.length === 2 &&
      directResults.clamped.calls[1].x >= directResults.clamped.rect.left &&
      directResults.clamped.calls[1].x <= directResults.clamped.rect.right,
      JSON.stringify(directResults))

    const singleLineDoc = '```ts\nsingle line\n```\n\nafter'
    const singleCodeFrom = singleLineDoc.indexOf('single')
    await reset(singleLineDoc, singleLineDoc.length)
    await page.waitForSelector('.cm-shiki-codeblock pre.shiki code .line')
    await clickRenderedCodeOffset(7)
    await page.waitForFunction(() => !document.querySelector('.cm-shiki-codeblock'))
    const singleLinePointer = await snapshot()
    check('render の単一行 code はクリックした桁へ移動する',
      singleLinePointer.doc === singleLineDoc &&
      singleLinePointer.ranges[0].head === singleCodeFrom + 7,
      JSON.stringify(singleLinePointer))

    const gutterDoc = [
      'one', 'two', 'three',
      '```ts', 'x', '```',
      'middle',
      '```ts', 'a', 'b', 'c', '```',
      ...Array.from({ length: 30 }, (_, index) => `tail ${index + 1}`),
    ].join('\n')
    await reset(gutterDoc, gutterDoc.length)
    await page.waitForFunction(() =>
      document.querySelectorAll('.cm-shiki-codeblock').length === 2 &&
      document.querySelectorAll('.cm-block-gutter-range').length === 2)
    await page.waitForFunction(() => {
      const markers = [...document.querySelectorAll('.cm-block-gutter-range')]
      const widgets = [...document.querySelectorAll('.cm-shiki-codeblock')]
      return markers.every((marker, index) => {
        const gutterRect = marker.parentElement.getBoundingClientRect()
        const widgetRect = widgets[index].getBoundingClientRect()
        return Math.abs(gutterRect.top - widgetRect.top) < 1 &&
          Math.abs(gutterRect.bottom - widgetRect.bottom) < 1
      })
    })
    const gutterBefore = await page.evaluate(() => globalThis.interactionScenario.gutterSnapshot(13))
    await page.evaluate(() => globalThis.interactionScenario.applyGutterFont('serif', '18px'))
    await page.waitForFunction(() => {
      const markers = [...document.querySelectorAll('.cm-block-gutter-range')]
      const widgets = [...document.querySelectorAll('.cm-shiki-codeblock')]
      return getComputedStyle(markers[0]).fontSize === '18px' &&
        markers.every((marker, index) => {
          const gutterRect = marker.parentElement.getBoundingClientRect()
          const widgetRect = widgets[index].getBoundingClientRect()
          return Math.abs(gutterRect.top - widgetRect.top) < 1 &&
            Math.abs(gutterRect.bottom - widgetRect.bottom) < 1
        })
    })
    const gutterAfterAppearance = await page.evaluate(() => globalThis.interactionScenario.gutterSnapshot(13))
    await page.evaluate(() => {
      const view = globalThis.interactionScenario.view
      view.scrollDOM.scrollTop = 100
      view.scrollDOM.dispatchEvent(new Event('scroll'))
    })
    await page.waitForTimeout(50)
    const gutterAfterScroll = await page.evaluate(() => globalThis.interactionScenario.gutterSnapshot(13))
    const matchingStyles = snapshot =>
      snapshot?.ranges.every(range =>
        range.parentClassName.includes('cm-gutterElement') &&
        range.parentIsDirectGutterChild &&
        range.fontFamily === snapshot.normal.fontFamily &&
        range.fontSize === snapshot.normal.fontSize &&
        range.fontWeight === snapshot.normal.fontWeight &&
        range.color === snapshot.normal.color &&
        range.opacity === snapshot.normal.opacity &&
        range.fontVariantNumeric === snapshot.normal.fontVariantNumeric)
    const alignedRanges = snapshot =>
      snapshot?.ranges.every(range =>
        Math.abs(range.elementTop - range.widgetTop) < 1 &&
        Math.abs(range.elementBottom - range.widgetBottom) < 1 &&
        Math.abs(range.elementHeight - range.widgetHeight) < 1 &&
        Math.abs(range.markerTop - range.elementTop) < 1 &&
        Math.abs(range.markerBottom - range.elementBottom) < 1)
    check('通常行と block range は同じ gutter marker 経路と computed style を使う',
      gutterBefore?.ranges.length === 2 &&
      gutterBefore.normal?.text === '13' && gutterBefore.normal.height > 0 &&
      JSON.stringify(gutterBefore.ranges.map(range => range.text)) ===
        JSON.stringify([['4', '6'], ['8', '12']]) &&
      matchingStyles(gutterBefore) && alignedRanges(gutterBefore),
      JSON.stringify(gutterBefore))
    check('appearance 更新後も通常行と block range の font が同時に一致する',
      gutterAfterAppearance?.normal.fontFamily.includes('serif') &&
      gutterAfterAppearance?.normal.fontSize === '18px' &&
      matchingStyles(gutterAfterAppearance) &&
      alignedRanges(gutterAfterAppearance),
      JSON.stringify(gutterAfterAppearance))
    check('scroll 後も block widget と gutter range の上下端が一致する',
      matchingStyles(gutterAfterScroll) && alignedRanges(gutterAfterScroll),
      JSON.stringify(gutterAfterScroll))
    await page.evaluate(() => globalThis.interactionScenario.applyGutterFont('monospace', '14px'))

    for (const source of ['$$\nx + y\n$$', '| A | B |\n| - | - |\n| 1 | 2 |']) {
      const document = `${source}\n\nafter`
      await reset(document, 0)
      await page.keyboard.press('Delete')
      const selected = await snapshot()
      await page.keyboard.press('Delete')
      const deleted = await snapshot()
      await page.keyboard.press(`${modifier}+z`)
      const restored = await snapshot()
      check(`Delete は ${source.startsWith('$$') ? 'BlockMath' : 'Table'} を選択後に削除する`,
        selected.ranges[0].from === 0 && selected.ranges[0].to === source.length &&
        deleted.doc === '\n\nafter' && restored.doc === document &&
        restored.ranges[0].from === 0 && restored.ranges[0].to === source.length,
        JSON.stringify({ selected, deleted, restored }))
    }

    await reset('**bold**', 2)
    await page.keyboard.press('Backspace')
    const marker = await snapshot()
    check('Backspace は hidden marker だけを削除する',
      marker.doc === 'bold**' && marker.ranges[0].head === 0,
      JSON.stringify(marker))

    const markerCases = [
      { source: '*em*', anchor: 0, key: 'Delete', expected: 'em*' },
      { source: '*em*', anchor: 4, key: 'Backspace', expected: '*em' },
      { source: '~~gone~~', anchor: 0, key: 'Delete', expected: 'gone~~' },
      { source: '~~gone~~', anchor: 8, key: 'Backspace', expected: '~~gone' },
      { source: '[[target|label]]', anchor: 0, key: 'Delete', expected: 'label]]' },
      { source: '[[target|label]]', anchor: 16, key: 'Backspace', expected: '[[target|label' },
    ]
    const markerResults = []
    for (const item of markerCases) {
      await reset(item.source, item.anchor)
      await page.keyboard.press(item.key)
      markerResults.push({ ...item, result: await snapshot() })
    }
    check('emphasis・strike・wikilink の開始側と終了側は marker だけを削除する',
      markerResults.every(item => item.result.doc === item.expected),
      JSON.stringify(markerResults))

    const markerModes = []
    for (const mode of ['raw', 'rich', 'render']) {
      await reset('**bold**', 2)
      await setMode(mode)
      await page.keyboard.press('Backspace')
      markerModes.push({ mode, result: await snapshot() })
    }
    check('raw・rich・render は hidden marker の削除結果を共有する',
      markerModes.every(item => item.result.doc === 'bold**' && item.result.ranges[0].head === 0),
      JSON.stringify(markerModes))

    await reset('ab', 1)
    const client = await page.context().newCDPSession(page)
    await client.send('Input.imeSetComposition', {
      text: '日', selectionStart: 1, selectionEnd: 1,
    })
    const composingOne = await snapshot()
    await client.send('Input.imeSetComposition', {
      text: '日本', selectionStart: 2, selectionEnd: 2,
    })
    const composingTwo = await snapshot()
    await client.send('Input.insertText', { text: '日本' })
    await waitForCompositionEnd()
    const composed = await snapshot()
    check('IME composition は更新中と確定後の文書と selection を保存する',
      composingOne.doc === 'a日b' && composingOne.ranges[0].head === 2 &&
      composingTwo.doc === 'a日本b' && composingTwo.ranges[0].head === 3 &&
      composed.doc === 'a日本b' && composed.ranges[0].head === 3 && !composed.compositionActive,
      JSON.stringify({ composingOne, composingTwo, composed }))
    await page.keyboard.press(`${modifier}+z`)
    const compositionUndo = await snapshot()
    await page.keyboard.press(`${modifier}+Shift+z`)
    const compositionRedo = await snapshot()
    check('IME composition の Undo と Redo は確定入力を一単位で往復する',
      compositionUndo.doc === 'ab' && compositionUndo.ranges[0].head === 1 &&
      compositionRedo.doc === 'a日本b' && compositionRedo.ranges[0].head === 3,
      JSON.stringify({ compositionUndo, compositionRedo }))

    const widgetDoc = [
      'ab',
      '',
      '![image](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)',
      '',
      '$e=mc^2$',
      '',
      '```ts',
      'const x = 1',
      '```',
      '',
      '$$',
      'x + y',
      '$$',
      '',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
    ].join('\n')
    await reset(widgetDoc, 1)
    await page.waitForSelector('.cm-image')
    await page.waitForSelector('.cm-katex-inline')
    await page.waitForSelector('.cm-shiki-codeblock')
    await page.waitForSelector('.cm-katex-block')
    await page.waitForSelector('.cm-table-widget')
    await page.evaluate(() => {
      const selectors = [
        '.cm-image', '.cm-katex-inline', '.cm-shiki-codeblock',
        '.cm-katex-block', '.cm-table-widget',
      ]
      globalThis.compositionWidgetIdentity = selectors.map(selector => ({
        selector,
        element: document.querySelector(selector),
      }))
    })
    const widgetClient = await page.context().newCDPSession(page)
    await widgetClient.send('Input.imeSetComposition', {
      text: '日', selectionStart: 1, selectionEnd: 1,
    })
    const firstWidgetIdentity = await page.evaluate(() =>
      globalThis.compositionWidgetIdentity.every(item =>
        document.querySelector(item.selector) === item.element))
    await widgetClient.send('Input.imeSetComposition', {
      text: '日本', selectionStart: 2, selectionEnd: 2,
    })
    const secondWidgetIdentity = await page.evaluate(() =>
      globalThis.compositionWidgetIdentity.every(item =>
        document.querySelector(item.selector) === item.element))
    await widgetClient.send('Input.insertText', { text: '日本' })
    check('composition 更新中は五種類の widget DOM identity を保存する',
      firstWidgetIdentity && secondWidgetIdentity,
      JSON.stringify({ firstWidgetIdentity, secondWidgetIdentity }))

    const adjacentWidgetCases = [
      {
        name: 'Image',
        node: 'Image',
        source: '![image](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)',
        selector: '.cm-image',
      },
      { name: 'InlineMath', node: 'InlineMath', source: '$e=mc^2$', selector: '.cm-katex-inline' },
      { name: 'FencedCode', node: 'FencedCode', source: '```ts\nconst x = 1\n```', selector: '.cm-shiki-codeblock' },
      { name: 'BlockMath', node: 'BlockMath', source: '$$\nx + y\n$$', selector: '.cm-katex-block' },
      { name: 'Table', node: 'Table', source: '| A | B |\n| - | - |\n| 1 | 2 |', selector: '.cm-table-widget' },
    ]
    const adjacentWidgetResults = []
    for (const item of adjacentWidgetCases) {
      for (const side of ['before', 'after']) {
        const document = `before\n\n${item.source}\n\nafter`
        await reset(document, 0)
        const sourceRange = await page.evaluate(nodeName =>
          globalThis.interactionScenario.syntaxRange(nodeName), item.node)
        const anchor = side === 'before'
          ? Math.max(0, sourceRange.from - 1)
          : Math.min(document.length, sourceRange.to + 1)
        await setSelection(anchor)
        await page.waitForSelector(item.selector)
        await page.evaluate(selector => {
          globalThis.adjacentWidgetIdentity = document.querySelector(selector)
        }, item.selector)
        const adjacentClient = await page.context().newCDPSession(page)
        await adjacentClient.send('Input.imeSetComposition', {
          text: '日', selectionStart: 1, selectionEnd: 1,
        })
        const preserved = await page.evaluate(selector =>
          document.querySelector(selector) === globalThis.adjacentWidgetIdentity, item.selector)
        const during = await snapshot()
        await adjacentClient.send('Input.insertText', { text: '日' })
        await waitForCompositionEnd()
        const ended = await snapshot()
        const expectedDoc = `${document.slice(0, anchor)}日${document.slice(anchor)}`
        adjacentWidgetResults.push({
          name: item.name,
          side,
          preserved,
          activeDuring: during.compositionActive,
          inactiveAfter: !ended.compositionActive,
          documentSaved: during.doc === expectedDoc && ended.doc === expectedDoc,
          selectionSaved: during.ranges[0].head === anchor + 1 &&
            ended.ranges[0].head === anchor + 1,
        })
      }
    }
    check('五種類の widget の直前と直後で composition 中の DOM identity を保存する',
      adjacentWidgetResults.every(result =>
        result.preserved && result.activeDuring && result.inactiveAfter &&
        result.documentSaved && result.selectionSaved),
      JSON.stringify(adjacentWidgetResults))

    const guardedKeys = []
    const guardedExpectations = {
      Tab: { doc: '- first\n- s日econd', head: 12 },
      Backspace: { doc: '- first\n- second', head: 11 },
      Delete: { doc: '- first\n- s日cond', head: 12 },
    }
    for (const key of ['Tab', 'Backspace', 'Delete']) {
      const source = '- first\n- second'
      await reset(source, source.indexOf('second') + 1)
      const guardedClient = await page.context().newCDPSession(page)
      await guardedClient.send('Input.imeSetComposition', {
        text: '日', selectionStart: 1, selectionEnd: 1,
      })
      const beforeKey = await snapshot()
      await page.keyboard.press(key)
      const afterKey = await snapshot()
      await guardedClient.send('Input.imeSetComposition', {
        text: '', selectionStart: 0, selectionEnd: 0,
      })
      await page.evaluate(() => {
        globalThis.interactionScenario.view.contentDOM.dispatchEvent(
          new CompositionEvent('compositionend', { data: '' }),
        )
      })
      await waitForCompositionEnd()
      const finalized = await snapshot()
      const lineStart = finalized.doc.indexOf('\n') + 1
      if (key === 'Tab') await setSelection(lineStart + 3)
      else if (key === 'Backspace') await setSelection(lineStart + 2)
      else await setSelection(lineStart)
      await page.keyboard.press(key)
      const recovered = await snapshot()
      guardedKeys.push({ key, beforeKey, afterKey, finalized, recovered })
    }
    check('composition 中は Tab・Backspace・Delete の構造操作を適用しない',
      guardedKeys.every(item => {
        const expected = guardedExpectations[item.key]
        const activeResult = item.beforeKey.compositionActive &&
          item.afterKey.compositionActive &&
          item.afterKey.doc === expected.doc &&
          item.afterKey.ranges[0].head === expected.head
        const recovered = !item.finalized.compositionActive &&
          (item.key === 'Tab'
            ? item.recovered.doc.includes('\n  -')
            : !item.recovered.doc.slice(item.recovered.doc.indexOf('\n') + 1).startsWith('- '))
        return activeResult && recovered
      }),
      JSON.stringify(guardedKeys))
  },
})
