import { existsSync } from 'node:fs'
import { relative } from 'node:path'
import { has, parseArgs, str } from '../args.ts'
import { configPath, saveConfig, type Config } from '../config.ts'
import { parseFileUrl } from '../figma.ts'
import { dim } from '../term.ts'

export function init(argv: string[]): void {
  const args = parseArgs(argv)
  const target = args.positionals[0]
  if (!target) {
    throw new Error(
      'Usage: figflow init <figma-file-url-or-key> [--name "Project"] [--preview "https://app-git-{branch}.vercel.app"]',
    )
  }

  const root = process.cwd()
  const path = configPath(root)
  if (existsSync(path) && !has(args, '--force')) {
    throw new Error(`${relative(root, path)} already exists. Pass --force to overwrite.`)
  }

  const fileName = str(args, '--name')
  const preview = str(args, '--preview')
  const { fileKey, fileType } = parseFileUrl(target)
  const config: Config = {
    fileKey,
    ...(fileName ? { fileName } : {}),
    ...(fileType !== 'design' ? { fileType } : {}),
    ...(preview ? { preview: { baseUrl: preview } } : {}),
  }

  saveConfig(root, config)

  console.log(`\n  wrote ${relative(root, path)}`)
  console.log(`  file key: ${config.fileKey}${fileType !== 'design' ? dim(`  (${fileType})`) : ''}`)
  if (!preview) {
    console.log(dim('\n  no preview URL set — add one before using `figflow report`:'))
    console.log(dim('    "preview": { "baseUrl": "https://your-app-git-{branch}.vercel.app" }'))
  }
  console.log(`\n  next: export FIGMA_TOKEN=figd_… && figflow sync\n`)
}
