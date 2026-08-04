export type PreviewCheck = { ok: boolean; status: number | null; reason: string }

/** Pure status → verdict, so the policy is testable without a network. */
export function classify(status: number): PreviewCheck {
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
  return { ok: true, status, reason: 'up' }
}

/**
 * Confirm the preview is actually up before telling the designer to look at it.
 * Sending someone to a 404 is the fastest way to make them stop opening the
 * notifications, so `report` blocks on this by default.
 */
export async function checkPreview(url: string): Promise<PreviewCheck> {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'figflow' } })
    return classify(res.status)
  } catch (err) {
    return { ok: false, status: null, reason: `unreachable (${err instanceof Error ? err.message : err})` }
  }
}
