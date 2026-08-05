import { existsSync } from 'node:fs'
import { relative } from 'node:path'
import { has, parseArgs, str } from '../args.ts'
import { configPath, saveConfig, type Config } from '../config.ts'
import { parseFileUrl } from '../adapters/figma/url.ts'
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
  const baseBranch = str(args, '--base-branch')
  const tokenExpiresAt = str(args, '--token-expires')
  if (tokenExpiresAt && Number.isNaN(Date.parse(tokenExpiresAt))) {
    throw new Error(`--token-expires "${tokenExpiresAt}" is not a date. Use YYYY-MM-DD.`)
  }

  const { fileKey, fileType } = parseFileUrl(target)
  const config: Config = {
    fileKey,
    ...(fileName ? { fileName } : {}),
    ...(fileType !== 'design' ? { fileType } : {}),
    ...(baseBranch ? { baseBranch } : {}),
    ...(tokenExpiresAt ? { tokenExpiresAt } : {}),
    ...(preview ? { preview: { baseUrl: preview } } : {}),
  }

  saveConfig(root, config)

  console.log(`\n  wrote ${relative(root, path)}`)
  console.log(`  file key: ${config.fileKey}${fileType !== 'design' ? dim(`  (${fileType})`) : ''}`)
  if (!preview) {
    console.log(dim('\n  no preview URL set — add one before using `figflow report`:'))
    console.log(dim('    "preview": { "baseUrl": "https://your-app-git-{branch}.vercel.app" }'))
  }
  if (!tokenExpiresAt) {
    console.log(dim('\n  no token expiry recorded — a lapsed token stops the loop silently:'))
    console.log(dim('    figflow init … --token-expires YYYY-MM-DD'))
  }
  console.log(`\n  next: figflow doctor\n`)
}
