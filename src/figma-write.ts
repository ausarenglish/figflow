// Writes to Figma. Deliberately a separate module from figma.ts so that
// "does this code path touch the designer's file?" is answerable by grep.
//
// Every caller must pass an explicit `post: true`. Nothing here runs during
// sync, status, or context.

const API = 'https://api.figma.com'

async function post<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'X-Figma-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    if (res.status === 403) {
      throw new Error(
        'Figma returned 403 on a write. FIGMA_TOKEN needs the "file_comments:write"\n' +
          '  and "file_dev_resources:write" scopes (read-only tokens cannot post).',
      )
    }
    throw new Error(`Figma API ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }

  return (await res.json()) as T
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
