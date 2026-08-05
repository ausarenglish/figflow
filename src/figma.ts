// Read-only Figma client.
//
// SAFETY INVARIANT: this module issues GET requests and nothing else. There is
// no code path here that can create, edit, delete, or react to a comment.
// `request()` asserts the method to make that a runtime guarantee, not a
// convention. Write support must arrive as a separate, explicitly-named module.

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

export type NodeInfo = { name: string; type: string }

export type Reply = {
  id: string
  author: string
  at: string
  message: string
}

export type Thread = {
  id: string
  author: string
  createdAt: string
  resolvedAt: string | null
  message: string
  replies: Reply[]
  /** Node the pin is anchored to. Null for pins dropped on bare canvas. */
  nodeId: string | null
  orderId: string | null
  url: string
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

/**
 * Which editor the file opens in. It is part of the URL path, so getting it
 * wrong sends the designer to a link that does not resolve — and every comment
 * link we build is one the designer is meant to click.
 */
export type FileType = 'design' | 'board' | 'slides'

const URL_SEGMENT: Record<string, FileType> = {
  design: 'design',
  file: 'design', // legacy, redirects to /design/
  proto: 'design',
  board: 'board', // FigJam
  slides: 'slides',
}

/** Parse a Figma file key and editor type out of a URL, or take a bare key. */
export function parseFileUrl(input: string): { fileKey: string; fileType: FileType } {
  const m = input.match(/figma\.com\/(file|design|proto|board|slides)\/([A-Za-z0-9]+)/)
  if (m?.[2]) return { fileKey: m[2], fileType: URL_SEGMENT[m[1] as string] ?? 'design' }
  if (/^[A-Za-z0-9]{10,}$/.test(input.trim())) return { fileKey: input.trim(), fileType: 'design' }
  throw new Error(`Could not read a Figma file key from: ${input}`)
}

/** Back-compat shim for callers that only want the key. */
export function parseFileKey(input: string): string {
  return parseFileUrl(input).fileKey
}

export function commentUrl(
  fileKey: string,
  commentId: string,
  nodeId: string | null,
  fileType: FileType = 'design',
): string {
  const base = `https://www.figma.com/${fileType}/${fileKey}/`
  const node = nodeId ? `?node-id=${nodeId.replace(/:/g, '-')}` : ''
  return `${base}${node}#${commentId}`
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
): Thread[] {
  const roots = comments.filter((c) => !c.parent_id)
  const repliesBy = new Map<string, FigmaComment[]>()

  for (const c of comments) {
    if (!c.parent_id) continue
    const list = repliesBy.get(c.parent_id) ?? []
    list.push(c)
    repliesBy.set(c.parent_id, list)
  }

  return roots
    .map((root): Thread => {
      const nodeId = anchorOf(root.client_meta)
      return {
        id: root.id,
        author: root.user?.handle ?? 'unknown',
        createdAt: root.created_at,
        resolvedAt: root.resolved_at ?? null,
        message: root.message,
        nodeId,
        orderId: root.order_id,
        url: commentUrl(fileKey, root.id, nodeId, fileType),
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

/** Resolve node ids to human names. Best-effort: failures degrade to bare ids. */
export async function fetchNodeNames(
  fileKey: string,
  nodeIds: string[],
  token: string,
): Promise<Map<string, NodeInfo>> {
  const out = new Map<string, NodeInfo>()
  const unique = [...new Set(nodeIds)]

  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50)
    const qs = new URLSearchParams({ ids: chunk.join(','), depth: '1' })
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
