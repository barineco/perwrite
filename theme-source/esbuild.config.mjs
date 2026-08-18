import { spawn } from 'node:child_process'

const args = [
  '--bundle',
  'src/extension.ts',
  '--outfile=dist/extension.js',
  '--format=cjs',
  '--platform=node',
  '--external:vscode',
  '--sourcemap',
  '--target=node18',
]
if (process.argv.includes('--production')) args.push('--minify')
if (process.argv.includes('--watch')) args.push('--watch')

const child = spawn('esbuild', args, { stdio: 'inherit', shell: false })
child.on('error', error => {
  console.error(`esbuild could not be started: ${error.message}`)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`esbuild stopped by ${signal}`)
    process.exitCode = 1
  } else {
    process.exitCode = code ?? 1
  }
})
