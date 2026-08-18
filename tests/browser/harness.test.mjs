import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveChromiumPath, runBrowserTest } from './harness.mjs'

assert.throws(
  () => resolveChromiumPath({
    envPath: '/missing/chromium-a',
    playwrightPath: '/missing/chromium-b',
    cacheRoot: '/missing/playwright-cache',
  }),
  error => error.message.includes('/missing/chromium-a') && error.message.includes('/missing/chromium-b'),
)

const cache = mkdtempSync(join(tmpdir(), 'perwrite-playwright-cache-'))
const macChromium = join(
  cache,
  'chromium-9999',
  'chrome-mac-arm64',
  'Chromium.app',
  'Contents',
  'MacOS',
  'Chromium',
)
mkdirSync(join(macChromium, '..'), { recursive: true })
writeFileSync(macChromium, '')
assert.equal(resolveChromiumPath({
  envPath: undefined,
  playwrightPath: '/missing/playwright-chromium',
  cacheRoot: cache,
  platform: 'darwin',
  architecture: 'arm64',
}), macChromium)
rmSync(cache, { recursive: true, force: true })

const result = await runBrowserTest({
  prefix: 'perwrite-harness-test-',
  html: `<!doctype html><script>
    console.error('injected console failure')
    setTimeout(() => { throw new Error('injected page failure') }, 0)
  </script>`,
  viewport: { width: 320, height: 240 },
  log: false,
  setExitCode: false,
  async run(page, { check }) {
    check('injected expectation', false, 'injected mismatch')
    await page.waitForTimeout(50)
  },
})

assert(result.failures.some(failure => failure.name === 'injected expectation'))
assert(result.failures.some(failure => failure.name === 'console error がない'))
assert(result.failures.some(failure => failure.name === 'page error がない'))
assert.deepEqual(result.cleanup, { browser: true, server: true, output: true })
assert.equal(existsSync(result.output), false)
console.log('  PASS Browser harness の失敗集約と資源解放')
