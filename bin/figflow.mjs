#!/usr/bin/env node
// Node 24 strips TypeScript types on import, so the repo runs straight from
// src with no build step. It refuses to do that under node_modules, though —
// so an installed copy runs the JavaScript that `prepare` compiled to dist.
import { fileURLToPath } from 'node:url'

const installed = /[/\\]node_modules[/\\]/.test(fileURLToPath(import.meta.url))
const { main } = await import(installed ? '../dist/cli.js' : '../src/cli.ts')

main(process.argv.slice(2)).catch((err) => {
  console.error(`\n  error: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
