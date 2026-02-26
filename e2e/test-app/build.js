import * as esbuild from 'esbuild'
import { cpSync, mkdirSync, writeFileSync } from 'fs'

const relayMultiaddr = process.env.RELAY_MULTIADDR || ''

// Ensure dist directory exists
mkdirSync('dist', { recursive: true })

// Bundle app.js for the browser
await esbuild.build({
  entryPoints: ['app.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: 'dist/app.js',
  sourcemap: true,
  target: ['chrome120', 'firefox120'],
  define: {
    'process.env.NODE_DEBUG': 'false',
    'global': 'globalThis',
  },
})

// Copy index.html to dist
cpSync('index.html', 'dist/index.html')

// Write config.json
writeFileSync('dist/config.json', JSON.stringify({
  relayMultiaddr,
}, null, 2))

console.log('Build complete. Relay multiaddr:', relayMultiaddr || '(not set)')
