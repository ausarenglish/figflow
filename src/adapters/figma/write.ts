// Writes to Figma. Deliberately a separate module from ./read.ts so that
// "does this code path touch the designer's file?" is answerable by grep.
//
// Nothing here runs during sync, status, context or a dry-run report.

import type { PinnedResource, ReviewWriter } from '../types.ts'

const API = 'https://api.figma.com'

/**
 * Figma rate-limits comment writes in bursts — roughly five threads' worth
 * before it starts refusing. The read client has always retried on 429; this
 * one did not, so a batch larger than a handful died partway through with
 * "Rate limit exceeded" and the rest of the designers were never told.
 *
 * Backoff is capped per attempt and bounded in total, so a genuinely exhausted
 * quota fails with something actionable rather than hanging. A batch of any
 * size now completes: it simply takes longer.
 */
const MAX_ATTEMPTS = 6
const MAX_BACKOFF_SECONDS = 60
const BACKOFF_SCHEDULE_SECONDS = [2, 5, 10, 20, 40]

export function backoffFor(attempt: number, retryAfter: number | null): number {
  if (retryAfter !== null && Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter, MAX_BACKOFF_SECONDS)
  }
  return BACKOFF_SCHEDULE_SECONDS[Math.min(attempt, BACKOFF_SCHEDULE_SECONDS.length - 1)] as number
}

const sleep = (seconds: number) => new Promise((r) => setTimeout(r, seconds * 1000))

/**
 * Space writes out rather than firing them as fast as the network allows.
 * Backoff recovers from a limit; pacing avoids reaching it. The cost is a few
 * hundred milliseconds per thread, which nobody notices, against a partial
 * batch, which everybody does.
 */
const MIN_GAP_MS = 400
let lastWriteAt = 0

async function pace(): Promise<void> {
  const since = Date.now() - lastWriteAt
  if (lastWriteAt !== 0 && since < MIN_GAP_MS) {
    await new Promise((r) => setTimeout(r, MIN_GAP_MS - since))
  }
  lastWriteAt = Date.now()
}

async function post<T>(path: string, token: string, body: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await pace()
    const result = await attemptPost<T>(path, token, body, attempt)
    if (result.done) return result.value
    await sleep(result.waitSeconds)
  }
}

type Attempt<T> = { done: true; value: T } | { done: false; waitSeconds: number }

async function attemptPost<T>(
  path: string,
  token: string,
  body: unknown,
  attempt: number,
): Promise<Attempt<T>> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'X-Figma-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (res.status === 429) {
    const header = res.headers.get('Retry-After')
    const retryAfter = header === null ? null : Number(header)
    if (retryAfter !== null && retryAfter > MAX_BACKOFF_SECONDS) {
      throw new Error(
        `Figma's write quota is exhausted; it resets in ${Math.round(retryAfter / 60)} minutes.\n` +
          '  Threads already posted are recorded, so re-running later resumes\n' +
          '  where this left off without telling anyone twice.',
      )
    }
    if (attempt + 1 >= MAX_ATTEMPTS) {
      throw new Error(
        'Figma kept rate-limiting writes after several backoffs.\n' +
          '  Threads already posted are recorded — re-run later to finish the rest.',
      )
    }
    const waitSeconds = backoffFor(attempt, retryAfter)
    process.stderr.write(`      rate limited, waiting ${waitSeconds}s…\n`)
    return { done: false, waitSeconds }
  }

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error(
        'Figma returned 401 on a write — the token is invalid or has expired.\n' +
          '  Generate a new one and update .env.local and any CI secret.',
      )
    }
    if (res.status === 403) {
      throw new Error(
        'Figma returned 403 on a write. FIGMA_TOKEN needs the "file_comments:write"\n' +
          '  and "file_dev_resources:write" scopes (read-only tokens cannot post).',
      )
    }
    throw new Error(`Figma API ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }

  return { done: true, value: (await res.json()) as T }
}

/** Reply on a root comment thread. Figma notifies everyone on the thread. */
export async function postReply(
  fileKey: string,
  rootCommentId: string,
  message: string,
  token: string,
): Promise<{ id: string }> {
  return post<{ id: string }>(`/v1/files/${fileKey}/comments`, token, {
    message,
    comment_id: rootCommentId,
  })
}

/** A ✅ on the root comment, so the file scans at a glance. */
export async function postReaction(
  fileKey: string,
  rootCommentId: string,
  token: string,
  emoji = ':white_check_mark:',
): Promise<void> {
  await post(`/v1/files/${fileKey}/comments/${rootCommentId}/reactions`, token, { emoji })
}

export type DevResource = { name: string; url: string; file_key: string; node_id: string }

/**
 * Pin links to a frame, visible in Dev Mode. Figma caps a node at 10, and
 * rejects duplicates — both come back in `errors` rather than as a failure,
 * so a re-run is harmless.
 */
export async function postDevResources(
  resources: DevResource[],
  token: string,
): Promise<{ links_created: unknown[]; errors: { error: string }[] }> {
  if (resources.length === 0) return { links_created: [], errors: [] }
  return post(`/v1/dev_resources`, token, { dev_resources: resources })
}

export function figmaWriter(fileKey: string, token: string): ReviewWriter {
  return {
    kind: 'figma',
    async postReply(threadId, message) {
      await postReply(fileKey, threadId, message, token)
    },
    async postReaction(threadId) {
      await postReaction(fileKey, threadId, token)
    },
    async pinResources(resources: PinnedResource[]) {
      const res = await postDevResources(
        resources.map((r) => ({ name: r.name, url: r.url, file_key: fileKey, node_id: r.anchorId })),
        token,
      )
      return { errors: res.errors ?? [] }
    },
  }
}
