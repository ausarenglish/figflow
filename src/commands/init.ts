import { existsSync } from 'node:fs'
import { relative } from 'node:path'
import { configPath, saveConfig } from '../config.ts'
import { parseFileKey } from '../figma.ts'

export function init(args: string[]): void {
  const target = args.find((a) => !a.startsWith('-'))
  if (!target) {
    throw new Error('Usage: figflow init <figma-file-url-or-key> [--name "Project"]')
  }

  const root = process.cwd()
  const path = configPath(root)
  if (existsSync(path) && !args.includes('--force')) {
    throw new Error(`${relative(root, path)} already exists. Pass --force to overwrite.`)
  }

  const nameIdx = args.indexOf('--name')
  const fileName = nameIdx >= 0 ? args[nameIdx + 1] : undefined
  const fileKey = parseFileKey(target)

  saveConfig(root, { fileKey, ...(fileName ? { fileName } : {}) })

  console.log(`\n  wrote ${relative(root, path)}`)
  console.log(`  file key: ${fileKey}`)
  console.log(`\n  next: export FIGMA_TOKEN=figd_… && figflow sync\n`)
}
