import { execFileSync } from 'node:child_process'

export type PullRequest = { number: number; title: string; url: string }

function run(cmd: string, args: string[], cwd: string): string | null {
  try {
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

/**
 * When the application last changed, for judging whether a screenshot is out of
 * date. Deliberately ignores .figflow/ — recording a report or a route mapping
 * changes no screen, and comparing against plain HEAD would mark every
 * screenshot stale the moment figflow wrote its own bookkeeping.
 */
export function lastAppChangeAt(cwd: string): string | null {
  return (
    run('git', ['log', '-1', '--format=%cI', '--', '.', ':(exclude).figflow'], cwd) ||
    run('git', ['log', '-1', '--format=%cI'], cwd)
  )
}

export function currentBranch(cwd: string): string | null {
  // symbolic-ref works on a branch with no commits yet; rev-parse does not.
  const branch = run('git', ['symbolic-ref', '--short', 'HEAD'], cwd)
    ?? run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
  return branch && branch !== 'HEAD' ? branch : null
}

/**
 * Look up the PR for a branch via `gh`. Absent gh, an unauthenticated gh, or a
 * branch with no PR all degrade to null — report() still works, it just links
 * the preview instead of the PR.
 */
export function findPullRequest(cwd: string, branch: string): PullRequest | null {
  const json = run('gh', ['pr', 'view', branch, '--json', 'number,title,url'], cwd)
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as PullRequest
    return parsed.number ? parsed : null
  } catch {
    return null
  }
}

/**
 * The repo's web URL, derived from the git remote rather than `gh`. Works with
 * SSH and HTTPS remotes, and without the GitHub CLI installed at all — which
 * matters because `gh` is optional here and plain git access is not.
 */
export function repoWebUrl(cwd: string, remote = 'origin'): string | null {
  const raw = run('git', ['remote', 'get-url', remote], cwd)
  if (!raw) return null

  // git@host:owner/repo.git  →  https://host/owner/repo
  const ssh = raw.match(/^[^@]+@([^:]+):(.+?)(?:\.git)?$/)
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`

  // ssh://git@host/owner/repo.git  or  https://host/owner/repo.git
  try {
    const url = new URL(raw)
    return `https://${url.host}${url.pathname.replace(/\.git$/, '')}`
  } catch {
    return null
  }
}

/**
 * Build a PR reference from a number the user supplied by hand. The title is
 * left empty on purpose — we have no way to look it up without `gh`, and an
 * invented one would read as "Addressed in PR #128 (#128)".
 */
export function pullRequestByNumber(cwd: string, number: number): PullRequest {
  const base = repoWebUrl(cwd)
  return { number, title: '', url: base ? `${base}/pull/${number}` : '' }
}

/**
 * Vercel derives a branch subdomain by lowercasing and replacing anything that
 * isn't alphanumeric with a hyphen. Long branch names get truncated and hashed
 * by Vercel, which we cannot reproduce — hence the --preview override.
 */
export function branchSlug(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function previewBase(template: string, branch: string): string {
  return template.replace(/\{branch\}/g, branchSlug(branch)).replace(/\/+$/, '')
}

export function joinUrl(base: string, path: string | null): string {
  if (!path) return base
  return `${base}/${path.replace(/^\/+/, '')}`
}
