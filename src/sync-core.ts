import { openSource } from './adapters/index.ts'
import type { ReviewThread } from './adapters/types.ts'
import type { Config } from './config.ts'
import { loadState, reconcile, saveState, type Delta, type State } from './state.ts'

export type SyncResult = { state: State; delta: Delta; threads: ReviewThread[] }

/** One pull-and-fold. Shared by `sync` and `watch`, and source-agnostic. */
export async function runSync(
  root: string,
  config: Config,
  token: string,
  opts: { write?: boolean; now?: string } = {},
): Promise<SyncResult> {
  const source = openSource(config, token)
  const threads = await source.fetchThreads()

  const prior = loadState(root, config.fileKey)
  const anchored = threads.map((t) => t.anchorId).filter((id): id is string => id !== null)
  const names = await source.fetchAnchors(anchored)

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
