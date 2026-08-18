import { chromium } from 'playwright-core'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { tmpdir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)))

export function resolveChromiumPath({
  envPath = process.env.CHROMIUM_PATH,
  playwrightPath = chromium.executablePath(),
  cacheRoot = join(homedir(), '.cache', 'ms-playwright'),
  platform = process.platform,
  architecture = process.arch,
} = {}) {
  const cacheRelativePaths = platform === 'darwin'
    ? [
        `chrome-mac-${architecture}/Chromium.app/Contents/MacOS/Chromium`,
        'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
        `chrome-mac-${architecture}/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
        'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      ]
    : platform === 'win32'
      ? ['chrome-win/chrome.exe', 'chrome-win64/chrome.exe']
      : ['chrome-linux/chrome']
  const cacheCandidates = existsSync(cacheRoot)
    ? readdirSync(cacheRoot)
      .filter(name => name.startsWith('chromium-'))
      .sort()
      .reverse()
      .flatMap(name => cacheRelativePaths.map(relative => join(cacheRoot, name, relative)))
    : []
  const candidates = [envPath, playwrightPath, ...cacheCandidates].filter((candidate, index, values) =>
    candidate && values.indexOf(candidate) === index)
  const executable = candidates.find(candidate => existsSync(candidate))
  if (executable) return executable
  throw new Error(`Chromium executable not found. Searched: ${candidates.length ? candidates.join(', ') : '(no candidates)'}`)
}

function createChecks(log) {
  const failures = []
  const check = (name, condition, detail = '') => {
    if (log) console.log(`  ${condition ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
    if (!condition) failures.push({ name, detail })
    return condition
  }
  return { check, failures }
}

function serve(root) {
  const types = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript' }
  const server = createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://browser-test').pathname)
      if (pathname === '/favicon.ico') {
        response.writeHead(204).end()
        return
      }
      const file = resolve(root, pathname === '/' ? 'index.html' : pathname.slice(1))
      if (file !== root && !file.startsWith(root + sep)) throw new Error('path outside browser test root')
      const content = readFileSync(file)
      response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
      response.end(content)
    } catch {
      response.writeHead(404).end()
    }
  })
  return new Promise((resolveServer, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolveServer({ server, url: `http://127.0.0.1:${address.port}` })
    })
  })
}

function closeServer(server) {
  if (!server) return Promise.resolve()
  return new Promise((resolveClose, reject) => {
    server.close(error => error ? reject(error) : resolveClose())
  })
}

export async function runBrowserTest({
  prefix,
  entryPoint,
  outfile,
  html,
  format = 'iife',
  target,
  viewport,
  run,
  log = true,
  setExitCode = true,
  chromiumPath,
}) {
  const output = mkdtempSync(join(tmpdir(), prefix))
  const { check, failures } = createChecks(log)
  let browser
  let host
  const cleanup = { browser: false, server: false, output: false }

  try {
    if (entryPoint) {
      await build({
        entryPoints: [join(repoRoot, entryPoint)],
        bundle: true,
        outfile: join(output, outfile),
        platform: 'browser',
        format,
        target,
        loader: { '.css': 'css', '.woff': 'file', '.woff2': 'file', '.ttf': 'file', '.svg': 'text' },
        define: { 'process.env.NODE_ENV': '"production"', '__DEV__': 'false' },
      })
    }
    writeFileSync(join(output, 'index.html'), html)
    host = await serve(output)
    browser = await chromium.launch({ executablePath: chromiumPath ?? resolveChromiumPath() })
    const page = await browser.newPage({ viewport })
    page.on('pageerror', error => check('page error がない', false, error.message))
    page.on('console', message => {
      if (message.type() === 'error') check('console error がない', false, message.text())
    })
    await page.goto(host.url, { waitUntil: 'networkidle' })
    await run(page, { check })
  } catch (error) {
    check('Browser 検査を完了する', false, error instanceof Error ? error.stack ?? error.message : String(error))
  } finally {
    if (browser) {
      try {
        await browser.close()
        cleanup.browser = true
      } catch (error) {
        check('browser を解放する', false, String(error))
      }
    }
    if (host) {
      try {
        await closeServer(host.server)
        cleanup.server = true
      } catch (error) {
        check('server を解放する', false, String(error))
      }
    }
    try {
      rmSync(output, { recursive: true, force: true })
      cleanup.output = !existsSync(output)
    } catch (error) {
      check('一時ディレクトリを解放する', false, String(error))
    }
  }

  if (setExitCode && failures.length) process.exitCode = 1
  return { failures, cleanup, output }
}
