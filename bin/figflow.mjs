#!/usr/bin/env node
// No build step: Node 24 strips TypeScript types on import.
import { main } from '../src/cli.ts'

main(process.argv.slice(2)).catch((err) => {
  console.error(`\n  error: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
