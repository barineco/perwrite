import { runBrowserTest } from './harness.mjs'

const frames = (page, count = 2) => page.evaluate(async amount => {
  for (let index = 0; index < amount; index++) await new Promise(resolve => requestAnimationFrame(() => resolve()))
}, count)

const within = (actual, expected, tolerance = 2) => typeof actual === 'number'
  && typeof expected === 'number' && Math.abs(actual - expected) <= tolerance

async function geometryWitness(page, label, pos) {
  return page.evaluate(({ label, pos }) => {
    const editor = document.querySelector('.cm-editor')
    const scroller = editor?.querySelector('.cm-scroller')
    const content = editor?.querySelector('.cm-content')
    const styles = element => element ? {
      whiteSpace: getComputedStyle(element).whiteSpace,
      overflowX: getComputedStyle(element).overflowX,
      overflowWrap: getComputedStyle(element).overflowWrap,
      maxWidth: getComputedStyle(element).maxWidth,
    } : null
    const metrics = element => element ? { clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight } : null
    return {
      label,
      anchor: globalThis.perwriteHost.anchor(pos),
      view: globalThis.perwriteHost.view(),
      editor: metrics(editor), scroller: metrics(scroller), content: metrics(content),
      styles: { editor: styles(editor), scroller: styles(scroller), content: styles(content) },
    }
  }, { label, pos })
}

function detail(witness) { return JSON.stringify(witness) }
function visible(anchor) { return anchor && anchor.rectBottom >= anchor.viewportTop && anchor.rectTop <= anchor.viewportBottom }

function sourcePosition(source, needle) {
  const position = source.indexOf(needle)
  if (position < 0) throw new Error(`missing source sentinel ${needle}`)
  return position
}

async function inlineWidgetWitness(page, label) {
  return page.evaluate(label => {
    const content = document.querySelector('.cm-content')
    const rect = element => {
      if (!element) return null
      const box = element.getBoundingClientRect()
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }
    }
    const style = element => element ? { display: getComputedStyle(element).display, width: getComputedStyle(element).width } : null
    const bufferWitness = element => {
      const computed = getComputedStyle(element)
      return {
        className: element.className,
        outerHTML: element.outerHTML.slice(0, 500),
        display: computed.display,
        width: computed.width,
        minWidth: computed.minWidth,
        maxWidth: computed.maxWidth,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        parentClassName: element.parentElement?.className,
        rect: rect(element),
      }
    }
    const markers = ['.cm-list-bullet', '.cm-list-number', '.cm-task-checkbox'].map(selector => ({
      selector,
      count: document.querySelectorAll(selector).length,
      items: [...document.querySelectorAll(selector)].map(element => ({
        visible: !!(element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none'),
        rect: rect(element),
      })),
    }))
    const lines = [...document.querySelectorAll('.cm-line')].map(element => ({ text: element.textContent, rect: rect(element), rows: (() => { const range = document.createRange(); range.selectNodeContents(element); return range.getClientRects().length })() }))
    return { label, source: globalThis.perwriteHost.witness().content, text: content?.textContent, content: rect(content), buffers: [...document.querySelectorAll('img.cm-widgetBuffer')].map(bufferWitness), markers, lines }
  }, label)
}

const paragraphs = (label, count) => Array.from({ length: count }, (_, index) => `${label} paragraph ${index} keeps the source document tall.`).join('\n\n')
const mermaid = nodes => `\`\`\`mermaid\ngraph TD\n${Array.from({ length: nodes }, (_, index) => `N${index}-->N${index + 1}`).join('\n')}\n\`\`\``

await runBrowserTest({
  prefix: 'perwrite-webview-', entryPoint: 'tests/browser/host-scenario.ts', outfile: 'host.js', format: 'esm', target: 'es2022',
  html: '<!doctype html><html><head><link rel="stylesheet" href="/host.css"><style>html,body{height:100%;overflow:hidden}body{margin:0}#toolbar{height:40px}#editor{position:fixed!important;top:40px;left:0;right:0;height:760px!important;min-height:0!important;max-width:1000px}</style></head><body><div id="toolbar"><button id="toggle-view">Render</button></div><div id="editor"></div><script type="module" src="/host.js"></script></body></html>', viewport: { width: 1000, height: 800 },
  async run(page, { check }) {
    await page.waitForFunction(() => globalThis.perwriteHost?.outbound.some(message => message.type === 'ready'))
    await page.evaluate(() => globalThis.perwriteHost.sendInit())
    await page.waitForSelector('.cm-editor')
    await page.evaluate(() => {
      const root = document.querySelector('#editor'); const editor = document.querySelector('.cm-editor'); const scroller = document.querySelector('.cm-scroller')
      root.style.setProperty('height', '760px', 'important'); root.style.setProperty('max-height', '760px', 'important')
      editor.style.setProperty('height', '760px', 'important'); editor.style.setProperty('max-height', '760px', 'important')
      scroller.style.setProperty('height', '760px', 'important'); scroller.style.setProperty('max-height', '760px', 'important')
    })
    const initial = await page.evaluate(() => globalThis.perwriteHost.witness())
    check('初期 snapshot で EditorView を一度だけ構築する', initial.content === '# Title\n')
    await page.evaluate(() => globalThis.perwriteHost.input('A'))
    await page.waitForFunction(() => globalThis.perwriteHost.outbound.some(message => message.type === 'draft-edit'))
    const edit = await page.evaluate(() => globalThis.perwriteHost.outbound.findLast(message => message.type === 'draft-edit'))
    check('実入力は draft-edit を送る', edit?.changes?.[0]?.insert === 'A')
    await page.evaluate(() => { globalThis.perwriteHost.input('B') })
    await page.waitForFunction(() => globalThis.perwriteHost.outbound.filter(message => message.type === 'draft-edit').length === 2)
    const rapid = await page.evaluate(() => globalThis.perwriteHost.outbound.filter(message => message.type === 'draft-edit').slice(-2))
    check('Host snapshot 前の連続入力は連続 generation を送る', rapid[1].generation === rapid[0].generation + 1 && rapid[1].beforeHash !== rapid[0].beforeHash)
    await page.evaluate(() => globalThis.perwriteHost.rejectCanonical('# Canonical\n'))
    await page.waitForFunction(() => globalThis.perwriteHost.witness().content === '# Canonical\n')
    check('拒否後の canonical snapshot は楽観入力を戻す', (await page.evaluate(() => globalThis.perwriteHost.witness())).content === '# Canonical\n')
    await page.evaluate(() => globalThis.perwriteHost.select(3, 1))
    await page.evaluate(() => globalThis.perwriteHost.input('!'))
    await page.waitForFunction(() => globalThis.perwriteHost.outbound.filter(message => message.type === 'draft-edit').at(-1)?.selection?.join(',') === '3,1')
    check('選択範囲は draft-edit として anchor/head 順に送る', (await page.evaluate(() => globalThis.perwriteHost.outbound.filter(message => message.type === 'draft-edit').at(-1)?.selection)).join(',') === '3,1')
    await page.evaluate(() => { globalThis.perwriteHost.redo() })
    await page.waitForFunction(() => globalThis.perwriteHost.witness().content === '# Title\nA')
    const redo = await page.evaluate(() => globalThis.perwriteHost.witness())
    check('Redo snapshot は editor と selection を置換する', redo.content === '# Title\nA' && redo.selection.join(',') === '8,7')
    await page.evaluate(() => { globalThis.perwriteHost.undo() })
    await page.waitForFunction(() => globalThis.perwriteHost.witness().content === '# Title\n')
    const undo = await page.evaluate(() => globalThis.perwriteHost.witness())
    check('Undo snapshot は editor と selection を置換する', undo.content === '# Title\n' && undo.selection.join(',') === '1,0')
    await page.evaluate(() => globalThis.perwriteHost.externalClean('# External\n'))
    await page.waitForFunction(() => globalThis.perwriteHost.witness().content === '# External\n')
    check('clean external snapshot を適用する', (await page.evaluate(() => globalThis.perwriteHost.witness())).content === '# External\n')
    await page.evaluate(() => globalThis.perwriteHost.externalDirty('# Disk\n'))
    const dirty = await page.evaluate(() => globalThis.perwriteHost.witness())
    check('dirty external snapshot は draft を保持して conflict を表示する', dirty.content === '# External\n' && dirty.conflict === 'true')
    await page.evaluate(() => globalThis.perwriteHost.select(4, 2))
    const beforeToggle = await page.evaluate(() => globalThis.perwriteHost.witness())
    await page.evaluate(() => globalThis.perwriteHost.toggle())
    await page.waitForTimeout(20)
    check('表示切替は draft と selection を保持する', await page.evaluate(expected => { const witness = globalThis.perwriteHost.witness(); return witness.content === expected.content && witness.selection.join(',') === expected.selection.join(',') }, beforeToggle))

    const inlineWidgetSource = '# Inline widget regression heading\n\nOrdinary prose keeps `inline code` on this body line.\n\n- Bullet item retains its body text\n1. Numbered item retains its body text\n- [ ] Unchecked task retains its body text\n- [x] Checked task retains its body text\n'
    for (const mode of ['render', 'rich']) {
      await page.evaluate(({ source, mode }) => { globalThis.perwriteHost.setMode('raw'); globalThis.perwriteHost.replaceContent(source); globalThis.perwriteHost.setMode(mode) }, { source: inlineWidgetSource, mode })
      await frames(page, 3)
      const inlineWidgets = await inlineWidgetWitness(page, mode)
      const markerItems = inlineWidgets.markers.flatMap(marker => marker.items)
      if (mode === 'render') {
        const buffersStayInline = inlineWidgets.buffers.length > 0 && inlineWidgets.buffers.every(buffer => /^inline/.test(buffer.display) && buffer.rect.width < inlineWidgets.content.width - 2 && buffer.scrollWidth <= buffer.clientWidth)
        check('render の cm-widgetBuffer は行内表示で content 幅へ膨張せず overflow しない', buffersStayInline, detail(inlineWidgets))
        check('render は list / task marker と本文を表示する', inlineWidgets.text?.includes('Bullet item retains its body text') && inlineWidgets.text?.includes('Numbered item retains its body text') && inlineWidgets.text?.includes('Unchecked task retains its body text') && inlineWidgets.text?.includes('Checked task retains its body text') && inlineWidgets.markers.every(marker => marker.count > 0) && markerItems.every(item => item.visible), detail(inlineWidgets))
      }
      if (mode === 'rich') check('rich は source text を保持する', inlineWidgets.source === inlineWidgetSource, detail(inlineWidgets))
    }

    // Geometry regressions intentionally use source-coordinate anchors and relative viewport positions.
    const renderAnchor = 'ANCHOR_RENDER'
    const renderBefore = `${paragraphs('render above', 20)}\n\n${mermaid(2)}\n\n${paragraphs('render middle', 18)}\n\n${renderAnchor}\n\n${paragraphs('render below', 40)}\n`
    await page.evaluate(source => { globalThis.perwriteHost.setMode('raw'); globalThis.perwriteHost.replaceContent(source); globalThis.perwriteHost.setMode('render') }, renderBefore)
    await page.waitForTimeout(100)
    const renderMermaidPos = sourcePosition(renderBefore, '```mermaid')
    await page.evaluate(pos => globalThis.perwriteHost.scrollTo(pos), renderMermaidPos)
    await frames(page, 2)
    await page.waitForTimeout(1000)
    const renderWidget = await page.evaluate(() => ({ widgets: [...document.querySelectorAll('.cm-mermaid-block')].map(element => element.dataset.presentation), mode: document.querySelector('.cm-editor')?.className, text: document.querySelector('.cm-content')?.textContent }))
    check('render fixture は Mermaid widget を実 DOM に配置する', renderWidget.widgets.length > 0, detail(renderWidget))
    const renderPos = sourcePosition(renderBefore, renderAnchor)
    await page.evaluate(pos => globalThis.perwriteHost.scrollTo(pos), renderPos)
    await frames(page, 4)
    await page.evaluate(pos => globalThis.perwriteHost.scrollTo(pos), renderPos)
    await frames(page, 2)
    const renderInitial = await geometryWitness(page, 'render-before-change', renderPos)
    const renderInsert = 'EXTRA_RENDER_NODE_A-->EXTRA_RENDER_NODE_B\nEXTRA_RENDER_NODE_B-->EXTRA_RENDER_NODE_C\n'
    const renderEditAt = renderBefore.indexOf('```', renderBefore.indexOf('```') + 1) - 1
    await page.evaluate(({ from, insert }) => globalThis.perwriteHost.edit({ from, to: from, insert }), { from: renderEditAt, insert: renderInsert })
    await page.waitForTimeout(1000)
    await frames(page, 3)
    const renderAfter = await geometryWitness(page, 'render-after-change', renderPos + renderInsert.length)
    check('render 入力は source anchor relativeTop を保存する', visible(renderAfter.anchor) && within(renderAfter.anchor?.relativeTop, renderInitial.anchor?.relativeTop), detail({ before: renderInitial, after: renderAfter }))

    const richAnchor = 'ANCHOR_RICH'
    const richBefore = `${paragraphs('rich above', 24)}\n\n| first | second |\n| --- | --- |\n| small | cell |\n\n${richAnchor}\n\n${paragraphs('rich below', 45)}\n`
    await page.evaluate(source => { globalThis.perwriteHost.setMode('raw'); globalThis.perwriteHost.replaceContent(source); globalThis.perwriteHost.setMode('rich'); globalThis.perwriteHost.configurationChange(true) }, richBefore)
    await frames(page, 3)
    const richPos = sourcePosition(richBefore, richAnchor)
    await page.evaluate(pos => globalThis.perwriteHost.scrollTo(pos), richPos)
    await frames(page, 2)
    await page.evaluate(pos => globalThis.perwriteHost.scrollTo(pos), richPos)
    await frames(page, 2)
    const richInitial = await geometryWitness(page, 'rich-before-change', richPos)
    if (!richInitial.anchor) {
      await page.evaluate(pos => globalThis.perwriteHost.scrollTo(pos), richPos)
      await frames(page, 2)
    }
    const richStableInitial = await geometryWitness(page, 'rich-before-change-stable', richPos)
    const richInsert = '# Rich heading that increases presentation height\n\n'.repeat(8)
    const richEditAt = 0
    await page.evaluate(({ from, insert }) => globalThis.perwriteHost.edit({ from, to: from, insert }), { from: richEditAt, insert: richInsert })
    await frames(page, 3)
    const richAfter = await geometryWitness(page, 'rich-after-change', richPos + richInsert.length)
    check('rich 入力は source anchor relativeTop を保存する', visible(richAfter.anchor) && visible(richStableInitial.anchor) && within(richAfter.anchor?.relativeTop, richStableInitial.anchor?.relativeTop), detail({ before: richInitial, stableBefore: richStableInitial, after: richAfter }))

    const asyncAnchor = 'ANCHOR_ASYNC'
    const asyncSource = `${paragraphs('async above', 22)}\n\n${mermaid(18)}\n\n${asyncAnchor}\n\n${paragraphs('async below', 40)}\n`
    await page.evaluate(source => { globalThis.perwriteHost.setMode('raw'); globalThis.perwriteHost.replaceContent(source); globalThis.perwriteHost.setMode('render') }, asyncSource)
    const asyncPos = sourcePosition(asyncSource, asyncAnchor)
    await page.evaluate(pos => globalThis.perwriteHost.scrollTo(pos), asyncPos)
    await frames(page, 2)
    await page.evaluate(pos => globalThis.perwriteHost.scrollTo(pos), asyncPos)
    await frames(page, 2)
    await page.evaluate(pos => globalThis.perwriteHost.scrollTo(pos), asyncPos)
    await frames(page, 2)
    const asyncInitial = await geometryWitness(page, 'async-initial', asyncPos)
    await page.waitForSelector('.cm-mermaid-block[data-presentation="presented"]')
    await frames(page, 3)
    const asyncSettled = await geometryWitness(page, 'async-settled', asyncPos)
    await frames(page, 2)
    const asyncStable = await geometryWitness(page, 'async-stable', asyncPos)
    check('非同期 widget settle 後に source anchor を保存し重複補正しない', visible(asyncInitial.anchor) && visible(asyncSettled.anchor) && within(asyncSettled.anchor?.relativeTop, asyncInitial.anchor?.relativeTop) && within(asyncStable.anchor?.relativeTop, asyncSettled.anchor?.relativeTop, 0.5), detail({ before: asyncInitial, settled: asyncSettled, stable: asyncStable }))

    const revealSource = `${paragraphs('reveal above', 65)}\n\nOLD_REVEAL_ANCHOR\n\n${paragraphs('reveal middle', 65)}\n\nREVEAL_TARGET\n\n${paragraphs('reveal below', 20)}\n`
    await page.evaluate(source => { globalThis.perwriteHost.setMode('raw'); globalThis.perwriteHost.replaceContent(source); globalThis.perwriteHost.setMode('render') }, revealSource)
    await frames(page, 5)
    const oldRevealPos = sourcePosition(revealSource, 'OLD_REVEAL_ANCHOR')
    const revealPos = sourcePosition(revealSource, 'REVEAL_TARGET')
    await page.evaluate(pos => globalThis.perwriteHost.scrollTo(pos), oldRevealPos)
    await frames(page, 3)
    const revealLayoutInsert = '# qualifying layout edit\n\n'
    await page.evaluate(({ insert, pos }) => {
      globalThis.__perwriteScrollIntoViewCalls = []
      globalThis.__perwriteOriginalScrollIntoView = Element.prototype.scrollIntoView
      Element.prototype.scrollIntoView = function (...args) { globalThis.__perwriteScrollIntoViewCalls.push({ className: this.className, args }); return globalThis.__perwriteOriginalScrollIntoView.apply(this, args) }
      globalThis.perwriteHost.edit({ from: 0, to: 0, insert })
      globalThis.__perwriteCompensationScrollIntoViewCalls = globalThis.__perwriteScrollIntoViewCalls.length
      globalThis.perwriteHost.reveal(pos + insert.length, pos + insert.length + 'REVEAL_TARGET'.length)
    }, { insert: revealLayoutInsert, pos: revealPos })
    await page.waitForTimeout(100)
    await frames(page, 3)
    const revealWitness = await geometryWitness(page, 'reveal-separation', revealPos + revealLayoutInsert.length)
    const oldRevealWitness = await geometryWitness(page, 'old-anchor-after-reveal', oldRevealPos + revealLayoutInsert.length)
    const revealCalls = await page.evaluate(() => {
      const calls = globalThis.__perwriteScrollIntoViewCalls.slice()
      const compensationCalls = globalThis.__perwriteCompensationScrollIntoViewCalls
      Element.prototype.scrollIntoView = globalThis.__perwriteOriginalScrollIntoView
      return { calls, compensationCalls }
    })
    check('explicit reveal は compensation と分離され target を表示する', visible(revealWitness.anchor) && !visible(oldRevealWitness.anchor) && revealCalls.calls.length === revealCalls.compensationCalls, detail({ calls: revealCalls, target: revealWitness, old: oldRevealWitness }))

    const proseSentinel = `PROSE_SENTINEL_${'p'.repeat(350)}`
    const inlineSentinel = `INLINE_SENTINEL_${'i'.repeat(350)}`
    const wrapSource = `${proseSentinel} and \`${inlineSentinel}\`\n`
    await page.evaluate(source => { document.querySelector('#editor').style.maxWidth = '280px'; globalThis.perwriteHost.setMode('render'); globalThis.perwriteHost.configurationChange(true); globalThis.perwriteHost.replaceContent(source) }, wrapSource)
    await frames(page, 3)
    const wrapWitness = await geometryWitness(page, 'normal-inline-wrap', 0)
    const normalInline = await page.evaluate(({ proseSentinel, inlineSentinel }) => {
      const line = [...document.querySelectorAll('.cm-line')].find(element => element.textContent.includes(proseSentinel))
      const inline = document.querySelector('.cm-inline-code')
      const rangeRows = element => { const range = document.createRange(); range.selectNodeContents(element); return range.getClientRects().length }
      return { line: line && { text: line.textContent, rows: rangeRows(line), style: { overflowWrap: getComputedStyle(line).overflowWrap } }, inline: inline && { text: inline.textContent, rows: rangeRows(inline), style: { whiteSpace: getComputedStyle(inline).whiteSpace, overflowWrap: getComputedStyle(inline).overflowWrap } } }
    }, { proseSentinel, inlineSentinel })
    check('通常文 / inline code は狭幅で wrap し outer editor を overflow させない', normalInline.line?.text.includes(proseSentinel) && normalInline.inline?.text.includes(inlineSentinel) && normalInline.line.rows > 1 && normalInline.inline.rows > 1 && normalInline.line.style.overflowWrap === 'anywhere' && normalInline.inline.style.whiteSpace === 'break-spaces' && wrapWitness.scroller.scrollWidth <= wrapWitness.scroller.clientWidth + 1 && wrapWitness.content.scrollWidth <= wrapWitness.content.clientWidth + 1, detail({ normalInline, wrapWitness }))

    const codeSentinel = `CODE_WRAP_SENTINEL_${'c'.repeat(500)}`
    const codeSource = `\`\`\`javascript\n${codeSentinel}\n\`\`\`\n`
    await page.evaluate(source => { globalThis.perwriteHost.setMode('raw'); globalThis.perwriteHost.configurationChange(true); globalThis.perwriteHost.replaceContent(source); globalThis.perwriteHost.setMode('render') }, codeSource)
    await page.waitForSelector('.cm-shiki-codeblock pre')
    await page.waitForTimeout(500)
    await frames(page, 3)
    const enabledCode = await page.evaluate(sentinel => { const pre = document.querySelector('.cm-shiki-codeblock pre'); const code = document.querySelector('.cm-shiki-codeblock code'); const attributes = pre && { style: pre.getAttribute('style'), className: pre.className, outerHTML: pre.outerHTML.slice(0, 400) }; const chain = []; for (let node = pre; node && node !== document.body; node = node.parentElement) chain.push({ className: node.className, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, style: { display: getComputedStyle(node).display, width: getComputedStyle(node).width, minWidth: getComputedStyle(node).minWidth, maxWidth: getComputedStyle(node).maxWidth, whiteSpace: getComputedStyle(node).whiteSpace, overflowX: getComputedStyle(node).overflowX } }); return { text: code?.textContent, attributes, chain, pre: pre && { clientWidth: pre.clientWidth, scrollWidth: pre.scrollWidth, rows: (() => { const range = document.createRange(); range.selectNodeContents(code); return range.getClientRects().length })(), style: { whiteSpace: getComputedStyle(code).whiteSpace, overflowX: getComputedStyle(pre).overflowX } } } }, codeSentinel)
    const enabledWitness = await geometryWitness(page, 'code-wrap-enabled', 0)
    check('code block wrap enabled は複数行表示で local horizontal overflow を持たない', enabledCode.text.includes(codeSentinel) && enabledCode.pre.style.whiteSpace === 'break-spaces' && enabledCode.pre.scrollWidth <= enabledCode.pre.clientWidth + 1 && enabledCode.pre.rows > 1 && enabledWitness.scroller.scrollWidth <= enabledWitness.scroller.clientWidth + 1, detail({ enabledCode, enabledWitness }))

    await page.evaluate(() => globalThis.perwriteHost.configurationChange(false))
    await frames(page, 3)
    const disabledCode = await page.evaluate(() => { const pre = document.querySelector('.cm-shiki-codeblock pre'); const code = document.querySelector('.cm-shiki-codeblock code'); return { editorClass: document.querySelector('.cm-editor')?.className, pre: pre && { clientWidth: pre.clientWidth, scrollWidth: pre.scrollWidth, style: { whiteSpace: getComputedStyle(code).whiteSpace, overflowX: getComputedStyle(pre).overflowX } } } })
    const disabledWitness = await geometryWitness(page, 'code-wrap-disabled', 0)
    check('configuration-change 経路の code block wrap disabled は local overflow を維持する', disabledCode.editorClass.includes('cm-codeblock-wrap-disabled') && disabledCode.pre.style.whiteSpace === 'pre' && disabledCode.pre.style.overflowX === 'auto' && disabledCode.pre.scrollWidth > disabledCode.pre.clientWidth + 1 && disabledWitness.scroller.scrollWidth <= disabledWitness.scroller.clientWidth + 1 && disabledWitness.content.scrollWidth <= disabledWitness.content.clientWidth + 1, detail({ disabledCode, disabledWitness }))

    const tableWord = 'TABLE_OVERFLOW_SENTINEL_'.repeat(18)
    const mathWord = 'x'.repeat(120)
    const localOverflowSource = `| ${tableWord} | ${tableWord} | ${tableWord} |\n| --- | --- | --- |\n| ${tableWord} | ${tableWord} | ${tableWord} |\n\n$$\n\\displaystyle ${mathWord}\n$$\n`
    await page.evaluate(source => { document.querySelector('#editor').style.maxWidth = '280px'; globalThis.perwriteHost.configurationChange(true); globalThis.perwriteHost.setMode('raw'); globalThis.perwriteHost.replaceContent(source); globalThis.perwriteHost.setMode('render') }, localOverflowSource)
    await page.waitForSelector('.cm-table-widget')
    await frames(page, 3)
    const tableOverflow = await page.evaluate(() => {
      const table = document.querySelector('.cm-table-widget'); const cell = document.querySelector('.cm-table-widget td')
      return { clientWidth: table?.clientWidth, scrollWidth: table?.scrollWidth, overflowX: table && getComputedStyle(table).overflowX, textAlign: cell && getComputedStyle(cell).textAlign }
    })
    const mathPos = sourcePosition(localOverflowSource, '$$')
    await page.evaluate(pos => globalThis.perwriteHost.scrollTo(pos), mathPos)
    await frames(page, 3)
    await page.waitForSelector('.cm-katex-block')
    const mathOverflow = await page.evaluate(() => {
      const math = document.querySelector('.cm-katex-block')
      return { clientWidth: math?.clientWidth, scrollWidth: math?.scrollWidth, overflowX: math && getComputedStyle(math).overflowX }
    })
    const localWitness = await geometryWitness(page, 'table-math-local-overflow', mathPos)
    check('table / display math は局所 horizontal overflow と outer editor containment を保つ', tableOverflow.overflowX === 'auto' && mathOverflow.overflowX === 'auto' && tableOverflow.scrollWidth >= tableOverflow.clientWidth && mathOverflow.scrollWidth > mathOverflow.clientWidth + 1 && ['left', 'start'].includes(tableOverflow.textAlign) && localWitness.scroller.scrollWidth <= localWitness.scroller.clientWidth + 1 && localWitness.content.scrollWidth <= localWitness.content.clientWidth + 1, detail({ tableOverflow, mathOverflow, localWitness }))
  },
})
