import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import type { FileType } from './figma.ts'

export type Config = {
  fileKey: string
  fileName?: string
  /** Editor the file opens in — decides the /design/ vs /board/ URL path. */
  fileType?: FileType
  /** `{branch}` is replaced with the Vercel-style slug of the current branch. */
  preview?: { baseUrl: string }
}

/** Walk up from cwd looking for a .figflow directory. */
export function findRoot(from = process.cwd()): string | null {
  let dir = resolve(from)
  for (;;) {
    if (existsSync(join(dir, '.figflow', 'config.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function requireRoot(): string {
  const root = findRoot()
  if (!root) {
    throw new Error('No .figflow/config.json found here or in any parent. Run `figflow init <figma-url>` first.')
  }
  return root
}

export function configPath(root: string): string {
  return join(root, '.figflow', 'config.json')
}

export function loadConfig(root: string): Config {
  return JSON.parse(readFileSync(configPath(root), 'utf8')) as Config
}

export function saveConfig(root: string, config: Config): void {
  mkdirSync(join(root, '.figflow'), { recursive: true })
  writeFileSync(configPath(root), JSON.stringify(config, null, 2) + '\n')
}

export function requireToken(): string {
  // Node 24 has loadEnvFile built in; pick up a local .env if one exists.
  for (const file of ['.env.local', '.env']) {
    try {
      process.loadEnvFile(file)
    } catch {
      // no such file — fine
    }
  }

  const token = process.env.FIGMA_TOKEN ?? process.env.FIGMA_ACCESS_TOKEN
  if (!token) {
    throw new Error(
      'FIGMA_TOKEN is not set.\n' +
        '  Create a personal access token at figma.com → Settings → Security → Personal access tokens\n' +
        '  with the "file_comments:read" and "file_content:read" scopes, then:\n' +
        '    export FIGMA_TOKEN=figd_...',
    )
  }
  return token
}
