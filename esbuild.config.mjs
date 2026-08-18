import * as esbuild from 'esbuild'

const isWatch = process.argv.includes('--watch')
const isProduction = process.argv.includes('--production')

// Extension Host bundle (Node.js, CommonJS)
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  format: 'cjs',
  platform: 'node',
  external: ['vscode'],
  sourcemap: true,
  minify: isProduction,
  target: 'node18',
}

// Webview bundle (Browser, IIFE)
const webviewConfig = {
  entryPoints: ['webview/index.ts'],
  bundle: true,
  outfile: 'dist/webview.js',
  format: 'iife',
  platform: 'browser',
  sourcemap: true,
  minify: isProduction,
  target: 'es2022',
  loader: {
    '.css': 'css',
    '.woff': 'file',
    '.woff2': 'file',
    '.ttf': 'file',
    '.svg': 'text',
  },
  define: {
    'process.env.NODE_ENV': '"production"',
    '__DEV__': String(!isProduction),
  },
}

if (isWatch) {
  const extCtx = await esbuild.context(extensionConfig)
  const webCtx = await esbuild.context(webviewConfig)
  await Promise.all([extCtx.watch(), webCtx.watch()])
  console.log('Watching for changes...')
} else {
  await Promise.all([
    esbuild.build(extensionConfig),
    esbuild.build(webviewConfig),
  ])
  console.log('Build complete.')
}
