import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { FileType } from './adapters/figma/url.ts'
import type { SourceKind } from './adapters/types.ts'

export type Config = {
  /** Which review source this project reads. Absent means figma, the first one. */
  source?: SourceKind
  fileKey: string
  fileName?: string
  /** Editor the file opens in — decides the /design/ vs /board/ URL path. */
  fileType?: FileType
  /** `{branch}` is replaced with the Vercel-style slug of the current branch. */
  preview?: { baseUrl: string }
  /**
   * Branch that feature work is cut from. Used to bound the commit range that
   * `report` scans for review trailers.
   */
  baseBranch?: string
  /**
   * When the access token expires, ISO date. Purely a local reminder — no API
   * exposes this — but a token that lapses silently stops the whole loop, and
   * in CI it fails somewhere nobody is looking. `doctor` warns as it nears.
   */
  tokenExpiresAt?: string
}

export const DEFAULT_BASE_BRANCH = 'main'

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
    throw new Error(
      'No .figflow/config.json found here or in any parent.\n' +
        '  Run `figflow init <figma-url>` first.\n' +
        '  If you have run it before, check you are on a branch that has .figflow/\n' +
        '  committed — merge your base branch in if not.',
    )
  }
  return root
}

export function configPath(root: string): string {
  return join(root, '.figflow', 'config.json')
}

export function loadConfig(root: string): Config {
  const path = configPath(root)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    throw new Error(`Could not read ${path}. Run \`figflow init <figma-url>\`.`)
  }
  try {
    return JSON.parse(raw) as Config
  } catch (err) {
    throw new Error(
      `${path} is not valid JSON (${err instanceof Error ? err.message : err}).\n` +
        '  Fix it by hand, or re-run `figflow init <figma-url> --force`.',
    )
  }
}

export function saveConfig(root: string, config: Config): void {
  mkdirSync(join(root, '.figflow'), { recursive: true })
  writeFileSync(configPath(root), JSON.stringify(config, null, 2) + '\n')
}

/** Load .env.local / .env from the project root, not merely the cwd. */
export function loadEnvFiles(root?: string): void {
  const bases = root ? [root, process.cwd()] : [process.cwd()]
  for (const base of bases) {
    for (const file of ['.env.local', '.env']) {
      try {
        process.loadEnvFile(join(base, file))
      } catch {
        // no such file — fine
      }
    }
  }
}

export function findToken(root?: string): string | null {
  loadEnvFiles(root)
  return process.env.FIGMA_TOKEN ?? process.env.FIGMA_ACCESS_TOKEN ?? null
}

export function requireToken(root?: string): string {
  const token = findToken(root)
  if (!token) {
    throw new Error(
      'FIGMA_TOKEN is not set.\n' +
        '  Create a personal access token at figma.com → Settings → Security → Personal access tokens\n' +
        '  with the "file_comments:read" and "file_content:read" scopes, then either:\n' +
        '    export FIGMA_TOKEN=figd_...\n' +
        '  or add FIGMA_TOKEN=figd_... to .env.local in the project root.',
    )
  }
  return token
}
