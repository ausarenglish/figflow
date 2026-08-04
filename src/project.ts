import { execFileSync } from 'node:child_process'

export type PullRequest = { number: number; title: string; url: string }

function run(cmd: string, args: string[], cwd: string): string | null {
  try {
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
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

/** Build a PR reference from a number the user supplied by hand. */
export function pullRequestByNumber(cwd: string, number: number): PullRequest {
  const repo = run('gh', ['repo', 'view', '--json', 'url'], cwd)
  let url = ''
  try {
    url = repo ? `${(JSON.parse(repo) as { url: string }).url}/pull/${number}` : ''
  } catch {
    url = ''
  }
  return { number, title: `PR #${number}`, url }
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
