import { runBrowserTest } from './harness.mjs'

const css = [
  '--perwrite-editor-background:#fff', '--perwrite-editor-foreground:#222', '--perwrite-border:#aaa',
  '--perwrite-error-foreground:#c00', '--perwrite-muted-foreground:#666', '--perwrite-focus-border:#06f',
  '--perwrite-font-family:sans-serif', '--perwrite-font-size:14px', '--perwrite-line-height:1.8',
  '--perwrite-editor-width:1100px', '--perwrite-content-padding:16px', '--perwrite-gutter-gap:16px',
].join(';')

await runBrowserTest({
  prefix: 'perwrite-mermaid-',
  entryPoint: 'tests/browser/mermaid-scenario.ts',
  outfile: 'mermaid.js',
  html: `<!doctype html><html style="${css}"><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; font-src 'self' data:"><link rel="stylesheet" href="/mermaid.css"></head><body><div id="editor"></div><script src="/mermaid.js"></script></body></html>`,
  viewport: { width: 1200, height: 800 },
  async run(page, { check }) {
    await page.waitForFunction(() => globalThis.mermaidScenario && document.querySelectorAll('.cm-mermaid-overview').length >= 4, null, { timeout: 30000 })
    const renderObservations = await page.evaluate(() => globalThis.mermaidScenario.renderObservations())
    check('Mermaid の一時描画は非表示の preparation target だけに存在する', renderObservations.length > 0 &&
      renderObservations.every(value => value.location !== 'unprepared' &&
        (value.location !== 'preparation' || value.visibility === 'hidden')), JSON.stringify(renderObservations))
    check('表示 DOM に入る Mermaid SVG は geometry と寸法が確定している', renderObservations
      .filter(value => value.location === 'inline' || value.location === 'overlay')
      .every(value => value.configured), JSON.stringify(renderObservations))
    const preparedModal = await page.evaluate(() => globalThis.modalScenario.prepare())
    check('共通 modal は構築中の DOM を非表示で保持する', preparedModal.connected && preparedModal.phase === 'preparing' &&
      preparedModal.visibility === 'hidden', JSON.stringify(preparedModal))
    const presentedModal = await page.evaluate(() => globalThis.modalScenario.present())
    check('共通 modal は明示した present 後だけ表示と focus を適用する', presentedModal.phase === 'presented' &&
      presentedModal.visibility === 'visible' && presentedModal.focused, JSON.stringify(presentedModal))
    await page.evaluate(() => globalThis.modalScenario.dispose())
    const modalTransitionFailures = await page.evaluate(() => globalThis.modalScenario.invalidTransitions())
    check('共通 modal は不正な状態遷移と外部 focus を明示的に失敗させる', modalTransitionFailures.length === 3 &&
      modalTransitionFailures.every(value => value.startsWith('Error: Modal ')), JSON.stringify(modalTransitionFailures))
    const requests = []
    page.on('request', request => requests.push({ type: request.resourceType(), url: request.url() }))
    await page.evaluate(() => {
      globalThis.mermaidResourceMutations = []
      globalThis.mermaidCspViolations = []
      document.addEventListener('securitypolicyviolation', event => {
        globalThis.mermaidCspViolations.push({ directive: event.violatedDirective, blocked: event.blockedURI })
      })
      const resourceAttributes = new Set(['src', 'href', 'srcset', 'poster'])
      globalThis.mermaidResourceObserver = new MutationObserver(records => {
        for (const record of records) {
          if (record.type === 'attributes' && resourceAttributes.has(record.attributeName)) {
            globalThis.mermaidResourceMutations.push({ name: record.attributeName, value: record.target.getAttribute(record.attributeName) })
          }
          for (const node of record.addedNodes) {
            if (!(node instanceof Element)) continue
            for (const element of [node, ...node.querySelectorAll('*')]) {
              for (const name of resourceAttributes) if (element.hasAttribute(name)) {
                globalThis.mermaidResourceMutations.push({ name, value: element.getAttribute(name) })
              }
              if (element.getAttribute('style')?.includes('url(')) globalThis.mermaidResourceMutations.push({ name: 'style', value: element.getAttribute('style') })
            }
          }
        }
      })
      globalThis.mermaidResourceObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true })
    })
    const before = await page.evaluate(() => globalThis.mermaidScenario.snapshot())
    const target = page.locator('.cm-mermaid-block').nth(1)
    await target.evaluate(element => { globalThis.mermaidWidgetIdentity = element })
    await target.locator('.cm-mermaid-overview').evaluate(button => button.click())
    await page.waitForSelector('.cm-mermaid-overlay')
    const opened = await page.evaluate(() => ({
      count: document.querySelectorAll('.cm-mermaid-overlay').length,
      focused: document.activeElement?.className,
      focusedViewport: document.activeElement?.classList.contains('cm-mermaid-overlay-viewport'),
      labels: [...document.querySelectorAll('.cm-mermaid-overlay button')].map(button => button.querySelector('.cm-mermaid-button-label')?.textContent),
      revision: Number(document.querySelector('.cm-mermaid-overlay')?.dataset.viewportRevision),
      transform: document.querySelector('.cm-mermaid-overlay-canvas > svg')?.style.transform,
      commonModal: Boolean(document.querySelector('.perwrite-modal > .perwrite-modal-surface > .perwrite-modal-content')),
      phase: document.querySelector('.cm-mermaid-overlay')?.dataset.phase,
      centers: (() => {
        const viewport = document.querySelector('.cm-mermaid-overlay-viewport')?.getBoundingClientRect()
        const svg = document.querySelector('.cm-mermaid-overlay-canvas > svg')?.getBoundingClientRect()
        return viewport && svg ? {
          x: Math.abs(viewport.left + viewport.width / 2 - (svg.left + svg.width / 2)),
          y: Math.abs(viewport.top + viewport.height / 2 - (svg.top + svg.height / 2)),
        } : null
      })(),
    }))
    check('overlay は一つで focus と五操作を持つ', opened.count === 1 && opened.focusedViewport &&
      JSON.stringify(opened.labels) === JSON.stringify(['編集', '拡大', '縮小', '全体表示', '閉じる']), JSON.stringify(opened))
    check('Mermaid プレビューは配置完了後の共通 modal 内でグラフを縦横中央に表示する', opened.commonModal && opened.phase === 'presented' && opened.centers &&
      opened.centers.x < 1 && opened.centers.y < 1, JSON.stringify(opened))
    await page.locator('.cm-mermaid-overlay-viewport').press('Shift+Tab')
    const reverseFocus = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
    await page.keyboard.press('Tab')
    const wrappedFocus = await page.evaluate(() => document.activeElement?.classList.contains('cm-mermaid-overlay-viewport'))
    check('共通 modal は focus を末尾から viewport へ循環させる', reverseFocus === '閉じる' && wrappedFocus, JSON.stringify({ reverseFocus, wrappedFocus }))
    const iconGeometry = await page.evaluate(() => [...document.querySelectorAll('.cm-mermaid-overlay button')].map(button => {
      const svg = button.querySelector('svg')
      const box = svg?.getBBox()
      return {
        label: button.getAttribute('aria-label'),
        box: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null,
      }
    }))
    check('操作アイコンは 24px viewBox 内に欠けずに描画される', iconGeometry.every(({ box }) => box &&
      box.x >= 0 && box.y >= 0 && box.x + box.width <= 24 && box.y + box.height <= 24 &&
      Math.abs(box.x + box.width / 2 - 12) < 1 && Math.abs(box.y + box.height / 2 - 12) < 1), JSON.stringify(iconGeometry))
    await page.getByRole('button', { name: '拡大', exact: true }).click()
    const zoomed = await page.evaluate(() => ({
      revision: Number(document.querySelector('.cm-mermaid-overlay')?.dataset.viewportRevision),
      transform: document.querySelector('.cm-mermaid-overlay-canvas > svg')?.style.transform,
    }))
    check('拡大は revision と transform を一回更新する', zoomed.revision === opened.revision + 1 && zoomed.transform !== opened.transform, JSON.stringify({ opened, zoomed }))
    const viewport = page.locator('.cm-mermaid-overlay-viewport')
    const viewportBox = await viewport.boundingBox()
    await page.mouse.move(viewportBox.x + viewportBox.width / 2, viewportBox.y + viewportBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(viewportBox.x + viewportBox.width / 2 - 80, viewportBox.y + viewportBox.height / 2 - 30)
    await page.mouse.up()
    const dragged = await page.evaluate(() => ({
      revision: Number(document.querySelector('.cm-mermaid-overlay')?.dataset.viewportRevision),
      left: Number(document.querySelector('.cm-mermaid-overlay')?.dataset.viewportScrollLeft),
      top: Number(document.querySelector('.cm-mermaid-overlay')?.dataset.viewportScrollTop),
      scale: Number(document.querySelector('.cm-mermaid-overlay')?.dataset.viewportScale),
    }))
    check('drag は pan を一回以上更新する', dragged.revision > zoomed.revision && (dragged.left > 0 || dragged.top > 0), JSON.stringify(dragged))
    await page.mouse.wheel(25, 55)
    const wheelPanned = await page.evaluate(() => ({
      revision: Number(document.querySelector('.cm-mermaid-overlay')?.dataset.viewportRevision),
      scale: Number(document.querySelector('.cm-mermaid-overlay')?.dataset.viewportScale),
    }))
    check('通常 wheel は scale を保って pan する', wheelPanned.revision === dragged.revision + 1 &&
      wheelPanned.scale === dragged.scale, JSON.stringify(wheelPanned))
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -120)
    await page.keyboard.up('Control')
    const wheelZoomed = await page.evaluate(() => ({
      revision: Number(document.querySelector('.cm-mermaid-overlay')?.dataset.viewportRevision),
      scale: Number(document.querySelector('.cm-mermaid-overlay')?.dataset.viewportScale),
    }))
    check('Ctrl wheel は pointer を中心に zoom する', wheelZoomed.revision === wheelPanned.revision + 1 && wheelZoomed.scale > wheelPanned.scale, JSON.stringify(wheelZoomed))
    await viewport.press('-')
    const minus = await page.evaluate(() => ({
      revision: Number(document.querySelector('.cm-mermaid-overlay')?.dataset.viewportRevision),
      scale: Number(document.querySelector('.cm-mermaid-overlay')?.dataset.viewportScale),
    }))
    check('- key は縮小する', minus.revision === wheelZoomed.revision + 1 && minus.scale < wheelZoomed.scale, JSON.stringify(minus))
    await viewport.press('0')
    const reset = await page.evaluate(() => ({
      revision: Number(document.querySelector('.cm-mermaid-overlay')?.dataset.viewportRevision),
      left: Number(document.querySelector('.cm-mermaid-overlay')?.dataset.viewportScrollLeft),
      top: Number(document.querySelector('.cm-mermaid-overlay')?.dataset.viewportScrollTop),
    }))
    check('0 key は全体表示へ戻す', reset.revision === minus.revision + 1 && reset.left === 0 && reset.top === 0, JSON.stringify(reset))
    await page.locator('.cm-mermaid-overlay-viewport').press('ArrowRight')
    const panned = await page.evaluate(() => ({
      revision: Number(document.querySelector('.cm-mermaid-overlay')?.dataset.viewportRevision),
      left: Number(document.querySelector('.cm-mermaid-overlay')?.dataset.viewportScrollLeft),
    }))
    check('矢印 key は一回 pan を更新する', panned.revision === reset.revision + 1 && panned.left >= 0, JSON.stringify(panned))
    await page.locator('.cm-mermaid-overlay-viewport').press('Escape')
    const after = await page.evaluate(() => globalThis.mermaidScenario.snapshot())
    check('Escape は文書・selection・scroll・widget range を保存する',
      !await page.locator('.cm-mermaid-overlay').count() && JSON.stringify(before) === JSON.stringify(after), JSON.stringify({ before, after }))
    check('widget DOM identity を保存する', await target.evaluate(element => element === globalThis.mermaidWidgetIdentity), '')

    await target.locator('.cm-mermaid-overview').click()
    await page.getByRole('button', { name: '拡大', exact: true }).click()
    await viewport.press('ArrowRight')
    const centerBefore = await page.evaluate(() => ({
      x: Number(document.querySelector('.cm-mermaid-overlay')?.dataset.viewportCenterGraphX),
      y: Number(document.querySelector('.cm-mermaid-overlay')?.dataset.viewportCenterGraphY),
    }))
    await page.evaluate(() => new Promise(resolve => {
      globalThis.mermaidWidgetIdentity.addEventListener('mermaid-rendered', resolve, { once: true })
      globalThis.mermaidScenario.setTheme('light')
    }))
    const centerAfterTheme = await page.evaluate(() => ({
      x: Number(document.querySelector('.cm-mermaid-overlay')?.dataset.viewportCenterGraphX),
      y: Number(document.querySelector('.cm-mermaid-overlay')?.dataset.viewportCenterGraphY),
    }))
    await page.evaluate(() => new Promise(resolve => {
      globalThis.mermaidWidgetIdentity.addEventListener('mermaid-rendered', resolve, { once: true })
      globalThis.mermaidScenario.setLayout('elk')
    }))
    const centerAfter = await page.evaluate(() => ({
      x: Number(document.querySelector('.cm-mermaid-overlay')?.dataset.viewportCenterGraphX),
      y: Number(document.querySelector('.cm-mermaid-overlay')?.dataset.viewportCenterGraphY),
      sameWidget: globalThis.mermaidWidgetIdentity.isConnected,
    }))
    check('theme 再描画は viewport 中心の graph 座標を保存する',
      Math.abs(centerAfterTheme.x - centerBefore.x) < 1 && Math.abs(centerAfterTheme.y - centerBefore.y) < 1,
      JSON.stringify({ centerBefore, centerAfterTheme }))
    check('layout 再描画は同じ widget へ有限の graph 座標を再投影する', centerAfter.sameWidget &&
      Number.isFinite(centerAfter.x) && Number.isFinite(centerAfter.y), JSON.stringify(centerAfter))
    await page.evaluate(() => globalThis.mermaidScenario.setLargeContent('```mermaid\ngraph TD\n  A -->\n```'))
    await page.waitForSelector('.cm-mermaid-block .cm-mermaid-error')
    const failure = await page.evaluate(() => {
      const failures = [...document.querySelectorAll('.cm-mermaid-error')].map(element => ({
        kind: element.dataset.failureKind,
        reason: element.querySelector('.cm-render-error-reason')?.textContent,
      }))
      return { failures, overlay: document.querySelector('.cm-mermaid-overlay')?.dataset.failureKind ?? null }
    })
    check('render failure は inline と開いた overlay に同じ kind/reason を表示する', failure.failures.length === 2 &&
      failure.overlay === failure.failures[0].kind && JSON.stringify(failure.failures[0]) === JSON.stringify(failure.failures[1]), JSON.stringify(failure))
    await page.evaluate(() => globalThis.mermaidScenario.setLargeContent(globalThis.mermaidScenario.large))
    await page.waitForFunction(() => document.querySelector('.cm-mermaid-overview > svg') && document.querySelector('.cm-mermaid-overlay-canvas > svg'))
    const recovered = await page.evaluate(() => ({
      inlineFailures: document.querySelectorAll('.cm-mermaid-block .cm-mermaid-error').length,
      overlayFailures: document.querySelectorAll('.cm-mermaid-overlay .cm-mermaid-error').length,
      overlay: document.querySelectorAll('.cm-mermaid-overlay').length,
      sameWidget: globalThis.mermaidWidgetIdentity.isConnected,
    }))
    check('render recovery は同じ widget と開いた overlay を SVG へ戻す', recovered.inlineFailures === 0 && recovered.overlayFailures === 0 &&
      recovered.overlay === 1 && recovered.sameWidget, JSON.stringify(recovered))
    await page.locator('.cm-mermaid-overlay-viewport').press('Escape')
    const edgeLimit = await page.evaluate(() => new Promise(resolve => {
      const root = document.querySelector('.mermaid-normal')
      root.addEventListener('mermaid-rendered', () => resolve({
        failures: root.querySelectorAll('.cm-mermaid-error').length,
        diagrams: root.querySelectorAll('.cm-mermaid-overview > svg').length,
      }), { once: true })
      const edges = Array.from({ length: 501 }, (_, index) => `  A -->|${index}| B`).join('\n')
      globalThis.mermaidScenario.setLargeContent(`\`\`\`mermaid\ngraph LR\n${edges}\n\`\`\``)
    }))
    check('既定値 1024 は 501 edge の Mermaid を描画する', edgeLimit.failures === 0 && edgeLimit.diagrams === 2, JSON.stringify(edgeLimit))
    await page.evaluate(() => new Promise(resolve => {
      document.querySelector('.mermaid-normal').addEventListener('mermaid-rendered', resolve, { once: true })
      globalThis.mermaidScenario.setLargeContent(globalThis.mermaidScenario.large)
    }))
    await target.locator('.cm-mermaid-overview svg').evaluate(svg => {
      const rect = svg.getBoundingClientRect()
      for (const type of ['mousedown', 'mouseup', 'click']) svg.dispatchEvent(new MouseEvent(type, {
        bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
      }))
    })
    await page.waitForSelector('.cm-mermaid-overlay')
    check('SVG 本体のクリックは overlay を開く', await page.locator('.cm-mermaid-overlay').count() === 1)
    await page.getByRole('button', { name: '編集' }).click()
    await page.waitForFunction(() => document.querySelector('.mermaid-normal .cm-codeblock-line'))
    check('編集ボタンは overlay を閉じ Mermaid source を表示する', await page.locator('.cm-mermaid-overlay').count() === 0 &&
      await page.locator('.mermaid-normal .cm-codeblock-line').count() > 0)

    await page.locator('.mermaid-original .cm-mermaid-overview').click()
    check('readonly side でも overlay を開ける', await page.locator('.cm-mermaid-overlay').count() === 1)
    await page.getByRole('button', { name: '閉じる' }).click()
    await page.locator('.mermaid-modified .cm-mermaid-overview').click()
    check('比較 side は順番に独立した overlay を開ける', await page.locator('.cm-mermaid-overlay').count() === 1)
    await page.locator('.cm-mermaid-overlay').click({ position: { x: 2, y: 2 } })
    check('backdrop click は overlay を閉じる', await page.locator('.cm-mermaid-overlay').count() === 0)
    const finalRenderObservations = await page.evaluate(() => globalThis.mermaidScenario.renderObservations())
    check('theme/layout/failure/recovery を含む全描画で未確定 SVG を公開しない',
      finalRenderObservations.every(value => value.location !== 'unprepared' &&
        (value.location !== 'preparation' || value.visibility === 'hidden') &&
        (value.location === 'preparation' || value.configured)),
      JSON.stringify(finalRenderObservations))
    const resourceWitness = await page.evaluate(() => ({
      mutations: globalThis.mermaidResourceMutations,
      performance: performance.getEntriesByType('resource').map(entry => entry.name),
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? null,
      cspViolations: globalThis.mermaidCspViolations,
    }))
    check('theme/layout/source/failure/recovery の全区間は CSP 違反・資源要求・資源属性を追加しない',
      requests.length === 0 && resourceWitness.mutations.length === 0 && resourceWitness.cspViolations.length === 0 &&
      !resourceWitness.csp.includes('unsafe-eval'),
      JSON.stringify({ requests, mutations: resourceWitness.mutations, performanceCount: resourceWitness.performance.length }))
  },
})
