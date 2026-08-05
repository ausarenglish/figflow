// Read-only Figma client.
//
// SAFETY INVARIANT: this module issues GET requests and nothing else. There is
// no code path here that can create, edit, delete, or react to a comment.
// `request()` asserts the method to make that a runtime guarantee, not a
// convention. Writes live in ./write.ts and nowhere else.

import type { Anchor, ReviewSource, ReviewThread } from '../types.ts'
import { commentUrl, type FileType } from './url.ts'

const API = 'https://api.figma.com'

export type FigmaUser = { id: string; handle: string }

export type FigmaClientMeta =
  | { x: number; y: number }
  | { node_id: string; node_offset?: { x: number; y: number } }

export type FigmaComment = {
  id: string
  file_key: string
  /** Empty string on root comments, the root's id on replies. */
  parent_id: string
  user: FigmaUser
  created_at: string
  resolved_at?: string | null
  message: string
  order_id: string | null
  client_meta: FigmaClientMeta | null
}

async function request<T>(path: string, token: string, method = 'GET'): Promise<T> {
  if (method !== 'GET') throw new Error('figflow is read-only: only GET is permitted')

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method: 'GET',
      headers: { 'X-Figma-Token': token },
    })

    if (res.ok) return (await res.json()) as T

    if (res.status === 429) {
      const wait = Number(res.headers.get('Retry-After') ?? 10)
      process.stderr.write(`  rate limited, waiting ${wait}s…\n`)
      await new Promise((r) => setTimeout(r, wait * 1000))
      continue
    }

    if (res.status === 401) {
      throw new Error(
        'Figma returned 401 — the token is invalid or has expired.\n' +
          '  Personal access tokens expire. Generate a new one and update both\n' +
          '  .env.local and any CI secret. `figflow doctor` checks this ahead of time.',
      )
    }
    if (res.status === 403) {
      throw new Error(
        'Figma returned 403. Check FIGMA_TOKEN is valid and has the "file_comments:read" scope\n' +
          '  (and "file_content:read" for frame names).',
      )
    }
    if (res.status === 404) {
      throw new Error(`Figma returned 404 for ${path}. Wrong file key, or the token cannot see this file.`)
    }

    throw new Error(`Figma API ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }

  throw new Error('Figma API rate limit did not clear after 3 attempts')
}

function anchorOf(meta: FigmaClientMeta | null): string | null {
  if (meta && 'node_id' in meta && meta.node_id) return meta.node_id
  return null
}

export async function fetchComments(fileKey: string, token: string): Promise<FigmaComment[]> {
  const body = await request<{ comments: FigmaComment[] }>(`/v1/files/${fileKey}/comments`, token)
  return body.comments ?? []
}

/** Group the flat comment list into threads, roots sorted oldest-first. */
export function toThreads(
  fileKey: string,
  comments: FigmaComment[],
  fileType: FileType = 'design',
): ReviewThread[] {
  const roots = comments.filter((c) => !c.parent_id)
  const repliesBy = new Map<string, FigmaComment[]>()

  for (const c of comments) {
    if (!c.parent_id) continue
    const list = repliesBy.get(c.parent_id) ?? []
    list.push(c)
    repliesBy.set(c.parent_id, list)
  }

  return roots
    .map((root): ReviewThread => {
      const anchorId = anchorOf(root.client_meta)
      return {
        id: root.id,
        author: root.user?.handle ?? 'unknown',
        createdAt: root.created_at,
        resolvedAt: root.resolved_at ?? null,
        message: root.message,
        anchorId,
        orderId: root.order_id,
        url: commentUrl(fileKey, root.id, anchorId, fileType),
        replies: (repliesBy.get(root.id) ?? [])
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .map((r) => ({
            id: r.id,
            author: r.user?.handle ?? 'unknown',
            at: r.created_at,
            message: r.message,
          })),
      }
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/**
 * Resolve node ids to human names. Best-effort: failures degrade to bare ids.
 *
 * Note the absent `depth` parameter. Passing `depth=1` makes Figma omit
 * absoluteBoundingBox, which silently breaks anything geometric.
 */
export async function fetchNodeNames(
  fileKey: string,
  nodeIds: string[],
  token: string,
): Promise<Map<string, Anchor>> {
  const out = new Map<string, Anchor>()
  const unique = [...new Set(nodeIds)]

  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50)
    const qs = new URLSearchParams({ ids: chunk.join(',') })
    try {
      const body = await request<{
        nodes: Record<string, { document?: { name?: string; type?: string } } | null>
      }>(`/v1/files/${fileKey}/nodes?${qs}`, token)

      for (const [id, entry] of Object.entries(body.nodes ?? {})) {
        const doc = entry?.document
        if (doc?.name) out.set(id, { name: doc.name, type: doc.type ?? 'NODE' })
      }
    } catch (err) {
      process.stderr.write(
        `  note: could not resolve frame names (${err instanceof Error ? err.message : err})\n`,
      )
      break
    }
  }

  return out
}

export function figmaSource(
  fileKey: string,
  fileType: FileType,
  label: string,
  token: string,
): ReviewSource {
  return {
    kind: 'figma',
    label,
    async fetchThreads() {
      return toThreads(fileKey, await fetchComments(fileKey, token), fileType)
    },
    fetchAnchors(anchorIds) {
      return fetchNodeNames(fileKey, anchorIds, token)
    },
  }
}
