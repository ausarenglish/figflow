import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Anchor, ReviewReply, ReviewThread } from './adapters/types.ts'

/**
 * Figma owns `resolved` — it is the designer's call and we only read it.
 * `in_progress` and `reported` are ours, set by `start` and `report`.
 * `gone` means the comment was deleted from the file.
 */
export type ThreadStatus = 'open' | 'in_progress' | 'reported' | 'resolved' | 'gone'

export type WorkRef = {
  branch: string
  startedAt: string
  /** Thread hash when work began, so a later edit is detectable. */
  hashAtStart: string
}

export type ReportRef = {
  at: string
  /** Thread hash when we posted, so we know if the ask has changed since. */
  hash: string
  pr: number | null
  /** The preview URL we told the designer to look at. */
  url: string
  branch: string
}

export type ThreadRecord = {
  status: ThreadStatus
  hash: string
  nodeId: string | null
  author: string
  createdAt: string
  resolvedAt: string | null
  firstSeenAt: string
  lastSeenAt: string
  message: string
  replies: ReviewReply[]
  url: string
  work?: WorkRef
  reported?: ReportRef
  issue?: { number: number; url: string; title: string }
}

export type State = {
  version: 1
  fileKey: string
  lastSyncAt: string | null
  /**
   * When anchor-name lookups may be attempted again. Figma's file-content
   * quota resets in days, and a watcher polling every 30s would otherwise
   * retry a doomed request 2,880 times a day — keeping the quota permanently
   * exhausted, which is what made it fail in the first place.
   */
  anchorsBlockedUntil?: string
  /**
   * Anchor id → its human name. Persisted as `nodes` because that is what the
   * first adapter called them and the file is committed in real repos; the
   * core treats them as opaque anchors.
   */
  nodes: Record<string, Anchor>
  threads: Record<string, ThreadRecord>
}

export type Delta = {
  added: string[]
  resolved: string[]
  reopened: string[]
  edited: string[]
  gone: string[]
  /** Edited after we started or reported — the dangerous ones. */
  staleWork: string[]
}

export function emptyState(fileKey: string): State {
  return { version: 1, fileKey, lastSyncAt: null, nodes: {}, threads: {} }
}

export function statePath(root: string): string {
  return join(root, '.figflow', 'state.json')
}

export function loadState(root: string, fileKey: string): State {
  const path = statePath(root)
  if (!existsSync(path)) return emptyState(fileKey)
  return JSON.parse(readFileSync(path, 'utf8')) as State
}

export function saveState(root: string, state: State): void {
  mkdirSync(join(root, '.figflow'), { recursive: true })
  writeFileSync(statePath(root), stableStringify(state) + '\n')
}

/** Sorted keys so the file produces clean, reviewable git diffs. */
function stableStringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, val) => {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        return Object.fromEntries(Object.entries(val as object).sort(([a], [b]) => a.localeCompare(b)))
      }
      return val
    },
    2,
  )
}

export function hashThread(thread: ReviewThread): string {
  const payload = [
    thread.anchorId ?? '',
    thread.message,
    ...thread.replies.map((r) => `${r.id}:${r.message}`),
  ].join(' ')
  return createHash('sha256').update(payload).digest('hex').slice(0, 16)
}

/** The ask changed after we started work or told the designer it was done. */
export function isStale(record: ThreadRecord): boolean {
  if (record.reported && record.reported.hash !== record.hash) return true
  if (record.work && record.work.hashAtStart !== record.hash) return true
  return false
}

function deriveStatus(resolvedAt: string | null, prev: ThreadRecord | undefined): ThreadStatus {
  if (resolvedAt) return 'resolved'
  if (prev?.reported) return 'reported'
  if (prev?.work) return 'in_progress'
  return 'open'
}

/**
 * Fold freshly-fetched threads into existing state. Pure: takes and returns
 * plain data so it can be tested without touching the network or disk.
 */
export function reconcile(
  state: State,
  threads: ReviewThread[],
  now: string,
): { state: State; delta: Delta } {
  const next: State = { ...state, lastSyncAt: now, threads: { ...state.threads } }
  const delta: Delta = { added: [], resolved: [], reopened: [], edited: [], gone: [], staleWork: [] }
  const seen = new Set<string>()

  for (const thread of threads) {
    seen.add(thread.id)
    const hash = hashThread(thread)
    const prev = next.threads[thread.id]
    const status = deriveStatus(thread.resolvedAt, prev)

    if (!prev) {
      delta.added.push(thread.id)
    } else {
      if (prev.hash !== hash) {
        delta.edited.push(thread.id)
        if (prev.work || prev.reported) delta.staleWork.push(thread.id)
      }
      if (status === 'resolved' && prev.status !== 'resolved') delta.resolved.push(thread.id)
      if (status !== 'resolved' && prev.status === 'resolved') delta.reopened.push(thread.id)
    }

    next.threads[thread.id] = {
      ...(prev ?? {}),
      status,
      hash,
      // The adapter speaks of anchors; the store has always called them nodes.
      nodeId: thread.anchorId,
      author: thread.author,
      createdAt: thread.createdAt,
      resolvedAt: thread.resolvedAt,
      firstSeenAt: prev?.firstSeenAt ?? now,
      lastSeenAt: now,
      message: thread.message,
      replies: thread.replies,
      url: thread.url,
    }
  }

  for (const [id, record] of Object.entries(next.threads)) {
    if (seen.has(id) || record.status === 'gone') continue
    next.threads[id] = { ...record, status: 'gone' }
    delta.gone.push(id)
  }

  return { state: next, delta }
}

export function frameLabel(state: State, nodeId: string | null): string {
  if (!nodeId) return 'Unanchored'
  const info = state.nodes[nodeId]
  return info ? info.name : nodeId
}

/** Group thread ids by the frame they are pinned to, ordered by frame name. */
export function groupByFrame(
  state: State,
  records: [string, ThreadRecord][],
): Map<string, [string, ThreadRecord][]> {
  const groups = new Map<string, [string, ThreadRecord][]>()
  for (const entry of records) {
    const key = frameLabel(state, entry[1].nodeId)
    const list = groups.get(key) ?? []
    list.push(entry)
    groups.set(key, list)
  }
  return new Map(
    [...groups].sort(([a], [b]) => (a === 'Unanchored' ? 1 : b === 'Unanchored' ? -1 : a.localeCompare(b))),
  )
}
