// The deterministic half of `figflow doctor`.
//
// Every function here is pure: it takes already-loaded values and returns a
// verdict. The command does the I/O and the printing. That split is what makes
// "does doctor catch a bad config?" answerable by a unit test rather than by
// breaking a real project.

import type { Config } from './config.ts'
import type { State } from './state.ts'
import type { Routes } from './routes.ts'

export type Level = 'ok' | 'warn' | 'fail'

export type Check = {
  name: string
  level: Level
  detail: string
  /** What to do about it. Omitted when there is nothing to do. */
  fix?: string
}

export const ok = (name: string, detail: string): Check => ({ name, level: 'ok', detail })
export const warn = (name: string, detail: string, fix?: string): Check => ({ name, level: 'warn', detail, fix })
export const fail = (name: string, detail: string, fix?: string): Check => ({ name, level: 'fail', detail, fix })

/** Days until an ISO date, rounded down. Negative once it has passed. */
export function daysUntil(iso: string, now: Date): number | null {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return null
  return Math.floor((then - now.getTime()) / 86_400_000)
}

export const EXPIRY_WARN_DAYS = 21

/**
 * A token that lapses stops the whole loop, and in CI it fails where nobody is
 * looking. No API exposes the expiry date, so this leans on what init recorded.
 */
export function checkTokenExpiry(config: Config, now: Date): Check {
  if (!config.tokenExpiresAt) {
    return warn(
      'token expiry',
      'not recorded',
      'Figma tokens expire. Record the date so this can warn you:\n' +
        '      figflow init <url> --force --token-expires YYYY-MM-DD',
    )
  }
  const days = daysUntil(config.tokenExpiresAt, now)
  if (days === null) {
    return fail('token expiry', `"${config.tokenExpiresAt}" is not a date`, 'Use YYYY-MM-DD.')
  }
  if (days < 0) {
    // Floor is the conservative rounding for "days left", but negating it
    // over-counts elapsed time: 35.5 days past would read as 36 days ago.
    const elapsed = Math.floor((now.getTime() - Date.parse(config.tokenExpiresAt)) / 86_400_000)
    return fail(
      'token expiry',
      `expired ${elapsed} day${elapsed === 1 ? '' : 's'} ago (${config.tokenExpiresAt})`,
      'Generate a new token, then update .env.local AND the CI secret.',
    )
  }
  if (days <= EXPIRY_WARN_DAYS) {
    return warn(
      'token expiry',
      `${days} day${days === 1 ? '' : 's'} left (${config.tokenExpiresAt})`,
      'Rotate soon, and remember the CI secret as well as .env.local.',
    )
  }
  return ok('token expiry', `${days} days left`)
}

export function checkPreviewTemplate(config: Config): Check {
  const url = config.preview?.baseUrl
  if (!url) {
    return fail(
      'preview url',
      'not configured',
      'report cannot run without one. Add to .figflow/config.json:\n' +
        '      "preview": { "baseUrl": "https://app-git-{branch}-scope.vercel.app" }',
    )
  }
  if (!/^https?:\/\//.test(url)) {
    return fail('preview url', `"${url}" is not an absolute URL`, 'It must start with https://.')
  }
  if (!url.includes('{branch}')) {
    return warn(
      'preview url',
      'has no {branch} placeholder',
      'Every branch will report the same URL. Intended only if you deploy one environment.',
    )
  }
  return ok('preview url', url)
}

export function checkStateAgreesWithConfig(config: Config, state: State): Check {
  if (state.fileKey && state.fileKey !== config.fileKey) {
    return fail(
      'state',
      `state.json is for file ${state.fileKey}, config says ${config.fileKey}`,
      'These must match. Delete .figflow/state.json and re-sync, or fix the config.',
    )
  }
  const counts = Object.values(state.threads).reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1
    return acc
  }, {})
  const total = Object.keys(state.threads).length
  if (total === 0) return warn('state', 'no threads yet', 'Run `figflow sync`.')
  const summary = Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${v} ${k}`)
    .join(', ')
  return ok('state', `${total} threads — ${summary}`)
}

export function checkRoutes(state: State, routes: Routes): Check {
  const anchored = [
    ...new Set(
      Object.values(state.threads)
        .filter((t) => t.status !== 'gone' && t.nodeId)
        .map((t) => t.nodeId as string),
    ),
  ]
  if (anchored.length === 0) return ok('routes', 'nothing anchored yet')
  const mapped = anchored.filter((id) => routes[id]).length
  const detail = `${mapped}/${anchored.length} frames mapped`
  if (mapped === 0) {
    return warn('routes', detail, 'Every reply will link the preview root. `figflow routes --init`.')
  }
  if (mapped < anchored.length) {
    return ok('routes', `${detail} — the rest link the preview root`)
  }
  return ok('routes', detail)
}

/**
 * CI reads .figflow from the checkout. If it is untracked, the deploy hook sees
 * no config and silently reports nothing — the exact failure that is hardest to
 * notice, because the workflow stays green.
 */
export function checkTracked(trackedPaths: string[]): Check {
  const need = ['config.json', 'state.json']
  const missing = need.filter((f) => !trackedPaths.some((p) => p.endsWith(`.figflow/${f}`)))
  if (missing.length === 0) return ok('tracked', '.figflow is committed')
  return warn(
    'tracked',
    `.figflow/${missing.join(', ')} not tracked by git`,
    'CI reads these from the checkout. Commit them, or the deploy hook does nothing.',
  )
}

export function exitCode(checks: Check[]): number {
  return checks.some((c) => c.level === 'fail') ? 1 : 0
}

export function summarize(checks: Check[]): { ok: number; warn: number; fail: number } {
  return {
    ok: checks.filter((c) => c.level === 'ok').length,
    warn: checks.filter((c) => c.level === 'warn').length,
    fail: checks.filter((c) => c.level === 'fail').length,
  }
}
