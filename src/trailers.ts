// Deriving "which threads does this branch address?" from git history.
//
// `figflow start` asks you to declare that before you begin, which is the one
// moment you are least sure. A commit trailer is written when you already know:
//
//     fix(bookings): let a rider cancel an upcoming booking
//
//     Figma: 1858203401
//
// It survives rebase and squash, it is reviewable in the diff, and it needs no
// extra file. `start` still works; trailers are simply a second, better source.

import { execFileSync } from 'node:child_process'

/** Recognised trailer keys, lowercased. `Review:` keeps this source-neutral. */
const TRAILER_KEYS = ['figma', 'review', 'figflow']

/** How far back to look when the branch cannot be diffed against a base. */
export const FALLBACK_COMMIT_WINDOW = 50

// ASCII unit/record separators. Referenced by code point rather than written
// literally, so no control character ever ends up embedded in this source file.
const UNIT = String.fromCharCode(31)
const RECORD = String.fromCharCode(30)
const LOG_FORMAT = '--format=%H%x1f%s%x1f%b%x1e'

export type TrailerRef = {
  threadId: string
  sha: string
  subject: string
}

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

/**
 * Pull thread ids out of one commit message body. Only whole-line trailers
 * count: a thread id mentioned in prose is a reference, not a claim that the
 * commit addresses it.
 */
export function parseTrailers(message: string): string[] {
  const out: string[] = []
  for (const line of message.split('\n')) {
    const m = line.match(/^\s*([A-Za-z-]+)\s*:\s*(.+?)\s*$/)
    if (!m) continue
    if (!TRAILER_KEYS.includes((m[1] as string).toLowerCase())) continue
    // "Figma: 123, 456" and "Figma: 123 456" both mean two threads.
    for (const id of (m[2] as string).split(/[,\s]+/)) {
      const trimmed = id.trim()
      if (/^\d+$/.test(trimmed)) out.push(trimmed)
    }
  }
  return [...new Set(out)]
}

/**
 * The commit range to scan. An explicit `since` wins. Otherwise the range is
 * base..HEAD, which is what you want on a feature branch. On the base branch
 * itself that range is empty, so fall back to a bounded window of recent
 * commits — bounded so this can never walk an entire repository's history.
 */
export function resolveRange(cwd: string, baseBranch: string, since: string | null): string {
  if (since) return `${since}..HEAD`

  const head = git(['rev-parse', 'HEAD'], cwd)
  for (const base of [`origin/${baseBranch}`, baseBranch]) {
    const merged = git(['merge-base', base, 'HEAD'], cwd)
    if (!merged) continue
    // On the base branch the merge-base IS head, so the range holds nothing.
    if (merged !== head) return `${merged}..HEAD`
  }

  return `HEAD~${FALLBACK_COMMIT_WINDOW}..HEAD`
}

/**
 * Every thread id claimed by a commit in range, newest first. Returns an empty
 * list rather than throwing when the range is unresolvable — a shallow clone or
 * a repo with three commits in it is not an error.
 */
export function threadsFromTrailers(
  cwd: string,
  baseBranch: string,
  since: string | null = null,
): TrailerRef[] {
  const range = resolveRange(cwd, baseBranch, since)
  const log =
    git(['log', range, LOG_FORMAT], cwd) ??
    // A window deeper than the repo is not an error; scan whatever exists.
    git(['log', LOG_FORMAT], cwd)
  if (!log) return []

  const refs: TrailerRef[] = []
  const seen = new Set<string>()
  for (const entry of log.split(RECORD)) {
    const [sha, subject, body] = entry.split(UNIT)
    if (!sha?.trim()) continue
    for (const threadId of parseTrailers(body ?? '')) {
      if (seen.has(threadId)) continue
      seen.add(threadId)
      refs.push({ threadId, sha: sha.trim().slice(0, 8), subject: (subject ?? '').trim() })
    }
  }
  return refs
}
