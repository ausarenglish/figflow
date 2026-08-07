import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * app path → a URL showing that screen. Hand-written, like routes.json.
 *
 * Exists because a preview URL is worthless to a reviewer who cannot sign in,
 * and most real apps put every interesting screen behind a login. A screenshot
 * needs no account, no VPN and no seat on the plan.
 *
 * The URL can be anything a browser opens — an image on a CDN, a file served by
 * the app itself, or a deep link to an image placed on the review board.
 * figflow does not capture screenshots and never will: that would mean a
 * browser, a headless runtime and a login flow inside a tool whose whole value
 * is being small and deterministic. Point it at images something else produced.
 */
export type Shot = {
  url: string
  /** When the image was captured, ISO. Absent means "unknown, assume stale". */
  capturedAt?: string
}

export type Shots = Record<string, Shot>

export function shotsPath(root: string): string {
  return join(root, '.figflow', 'shots.json')
}

export function loadShots(root: string): Shots {
  const path = shotsPath(root)
  if (!existsSync(path)) return {}

  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch (err) {
    throw new Error(
      `${path} is not valid JSON (${err instanceof Error ? err.message : err}).\n` +
        '  Expected { "/bookings": "https://…/bookings.png" }.',
    )
  }

  const out: Shots = {}
  for (const [route, value] of Object.entries(raw)) {
    // `// note` keys are decoration, matching routes.json.
    if (route.startsWith('//')) continue

    // A bare string is still valid; it simply carries no capture date, and an
    // undated screenshot is treated as stale rather than trusted.
    if (typeof value === 'string' && value.trim()) {
      out[normalise(route)] = { url: value.trim() }
      continue
    }
    if (value && typeof value === 'object') {
      const v = value as { url?: unknown; capturedAt?: unknown }
      if (typeof v.url === 'string' && v.url.trim()) {
        out[normalise(route)] = {
          url: v.url.trim(),
          ...(typeof v.capturedAt === 'string' && v.capturedAt.trim()
            ? { capturedAt: v.capturedAt.trim() }
            : {}),
        }
      }
    }
  }
  return out
}

/** Routes are compared ignoring a trailing slash, so "/places/" finds "/places". */
function normalise(route: string): string {
  const trimmed = route.trim().replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

export function shotFor(shots: Shots, route: string | null): Shot | null {
  if (!route) return shots['/'] ?? null
  return shots[normalise(route)] ?? null
}

/**
 * A screenshot taken before the work it is meant to show proves nothing — it is
 * a picture of the old screen, presented as evidence of the new one. Undated
 * screenshots count as stale: figflow cannot verify what it cannot date.
 */
export function isStaleShot(shot: Shot | null, workCommittedAt: string | null): boolean {
  if (!shot) return false
  if (!shot.capturedAt) return true
  if (!workCommittedAt) return false
  const captured = Date.parse(shot.capturedAt)
  const committed = Date.parse(workCommittedAt)
  if (Number.isNaN(captured) || Number.isNaN(committed)) return true
  return captured < committed
}
