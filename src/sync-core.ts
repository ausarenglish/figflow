import type { Config } from './config.ts'
import { fetchComments, fetchNodeNames, toThreads, type Thread } from './figma.ts'
import { loadState, reconcile, saveState, type Delta, type State } from './state.ts'

export type SyncResult = { state: State; delta: Delta; threads: Thread[] }

/** One pull-and-fold. Shared by `sync` and `watch`. */
export async function runSync(
  root: string,
  config: Config,
  token: string,
  opts: { write?: boolean } = {},
): Promise<SyncResult> {
  const comments = await fetchComments(config.fileKey, token)
  const threads = toThreads(config.fileKey, comments)

  const prior = loadState(root, config.fileKey)
  const anchored = threads.map((t) => t.nodeId).filter((id): id is string => id !== null)
  const names = await fetchNodeNames(config.fileKey, anchored, token)

  const withNodes: State = {
    ...prior,
    fileKey: config.fileKey,
    nodes: { ...prior.nodes, ...Object.fromEntries(names) },
  }

  const { state, delta } = reconcile(withNodes, threads, new Date().toISOString())
  if (opts.write !== false) saveState(root, state)

  return { state, delta, threads }
}

export function deltaIsEmpty(delta: Delta): boolean {
  return Object.values(delta).every((list) => list.length === 0)
}
