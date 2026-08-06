import { openSource } from './adapters/index.ts'
import type { ReviewSource, ReviewThread } from './adapters/types.ts'
import type { Config } from './config.ts'
import { loadState, reconcile, saveState, type Delta, type State } from './state.ts'

/** Six hours: the quota resets in days, so retrying often is pure waste. */
export const ANCHOR_RETRY_BACKOFF_MS = 6 * 60 * 60 * 1000

export type SyncResult = { state: State; delta: Delta; threads: ReviewThread[] }

/** One pull-and-fold. Shared by `sync` and `watch`, and source-agnostic. */
export async function runSync(
  root: string,
  config: Config,
  token: string,
  /** `source` is injectable so this can be tested without a network. */
  opts: { write?: boolean; now?: string; source?: ReviewSource } = {},
): Promise<SyncResult> {
  const source = opts.source ?? openSource(config, token)
  const threads = await source.fetchThreads()

  const prior = loadState(root, config.fileKey)

  // Only look up anchors we cannot already name. Re-resolving all of them on
  // every sync is what exhausts Figma's file-content quota — 24 lookups per
  // poll against a budget that resets in days, spent almost entirely on names
  // that had not changed. Anchor names are effectively immutable; a rename is
  // worth missing to keep polling cheap enough to be frequent.
  const anchored = new Set(
    threads.map((t) => t.anchorId).filter((id): id is string => id !== null),
  )
  const unknown = [...anchored].filter((id) => !prior.nodes[id])

  const now = opts.now ?? new Date().toISOString()
  const blocked = prior.anchorsBlockedUntil !== undefined && prior.anchorsBlockedUntil > now
  const shouldLookUp = unknown.length > 0 && !blocked

  const names = shouldLookUp ? await source.fetchAnchors(unknown) : new Map()

  // A lookup that returned nothing means the quota is spent (fetchAnchors
  // degrades rather than throwing). Stop asking for a while, or a watcher
  // polling every 30s keeps it spent forever.
  const failed = shouldLookUp && names.size === 0
  const blockedUntil = failed
    ? new Date(Date.parse(now) + ANCHOR_RETRY_BACKOFF_MS).toISOString()
    : blocked
      ? prior.anchorsBlockedUntil
      : undefined

  const withNodes: State = {
    ...prior,
    fileKey: config.fileKey,
    nodes: { ...prior.nodes, ...Object.fromEntries(names) },
    // Assigned unconditionally: a conditional spread would leave a stale block
    // from `prior` in place after a lookup finally succeeds. JSON.stringify
    // drops the key when it is undefined.
    anchorsBlockedUntil: blockedUntil,
  }

  const { state, delta } = reconcile(withNodes, threads, now)
  if (opts.write !== false) saveState(root, state)

  return { state, delta, threads }
}

export function deltaIsEmpty(delta: Delta): boolean {
  return Object.values(delta).every((list) => list.length === 0)
}
