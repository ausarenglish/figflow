export type PreviewCheck = {
  ok: boolean
  status: number | null
  reason: string
  /** Set when the request did not end where it was aimed. */
  redirectedTo?: string
}

/**
 * Paths that mean "sign in first". Matched against the path the request
 * actually landed on, not the one we asked for.
 */
const AUTH_PATH =
  /^\/(login|log-in|signin|sign-in|signup|sign-up|auth|authenticate|session|account\/login|users\/sign_in)(\/|$)/i

/** Two paths are the same screen if they differ only by case or a trailing slash. */
function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\/+$/, '').toLowerCase() || '/'
  return norm(a) === norm(b)
}

/**
 * Pure status → verdict, so the policy is testable without a network.
 *
 * `requestedPath` and `finalPath` matter as much as the status code. A login
 * wall answers 200 OK — it is a perfectly healthy page, just not the one the
 * designer was promised. Checking only the status is how thirteen designers
 * were sent to a sign-in form and told their work was ready to review.
 */
export function classify(status: number, requestedPath?: string, finalPath?: string): PreviewCheck {
  if (status === 401 || status === 403) {
    // Vercel deployment protection: the deploy exists, we just cannot see it.
    return { ok: true, status, reason: 'protected — assuming it is up' }
  }
  if (status === 404) {
    return { ok: false, status, reason: 'not found — has this branch deployed yet?' }
  }
  if (status >= 400) {
    return { ok: false, status, reason: `returned ${status}` }
  }

  if (requestedPath !== undefined && finalPath !== undefined && !samePath(requestedPath, finalPath)) {
    if (AUTH_PATH.test(finalPath)) {
      return {
        ok: false,
        status,
        reason: `redirects to ${finalPath} — a reviewer without an account sees a sign-in form, not this screen`,
        redirectedTo: finalPath,
      }
    }
    // Some other redirect. The designer still does not land where we aimed, so
    // say so — but it is not necessarily a wall, so it does not block.
    return {
      ok: true,
      status,
      reason: `up, but redirects to ${finalPath}`,
      redirectedTo: finalPath,
    }
  }

  return { ok: true, status, reason: 'up' }
}

/**
 * Confirm the preview is actually up — and actually shows the screen — before
 * telling the designer to look at it. Sending someone to a dead link, or to a
 * login form, is the fastest way to make them stop opening the notifications,
 * so `report` blocks on this by default.
 */
export async function checkPreview(url: string): Promise<PreviewCheck> {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'figflow' } })
    const requestedPath = safePath(url)
    const finalPath = safePath(res.url) ?? requestedPath
    return classify(res.status, requestedPath, finalPath)
  } catch (err) {
    return { ok: false, status: null, reason: `unreachable (${err instanceof Error ? err.message : err})` }
  }
}

function safePath(url: string): string | undefined {
  try {
    return new URL(url).pathname
  } catch {
    return undefined
  }
}
