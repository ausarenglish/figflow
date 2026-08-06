import { openSource } from './adapters/index.ts'
import type { ReviewSource, ReviewThread } from './adapters/types.ts'
import type { Config } from './config.ts'
import { loadState, reconcile, saveState, type Delta, type State } from './state.ts'

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
  const names = unknown.length > 0 ? await source.fetchAnchors(unknown) : new Map()

  const withNodes: State = {
    ...prior,
    fileKey: config.fileKey,
    nodes: { ...prior.nodes, ...Object.fromEntries(names) },
  }

  const { state, delta } = reconcile(withNodes, threads, opts.now ?? new Date().toISOString())
  if (opts.write !== false) saveState(root, state)

  return { state, delta, threads }
}

export function deltaIsEmpty(delta: Delta): boolean {
  return Object.values(delta).every((list) => list.length === 0)
}
