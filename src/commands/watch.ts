import { parseArgs, str } from '../args.ts'
import { loadConfig, requireRoot, requireToken } from '../config.ts'
import { notify } from '../notify.ts'
import { deltaIsEmpty, runSync } from '../sync-core.ts'
import { frameLabel, type Delta, type State } from '../state.ts'
import { dim, green, yellow } from '../term.ts'

const DEFAULT_INTERVAL_SECONDS = 300

/**
 * Poll Figma and ping when something lands. Polling is not a shortcut — Figma's
 * FILE_COMMENT webhook fires on creation only and there is no resolve event, so
 * polling is the only way to see a comment get resolved.
 */
export async function watch(argv: string[]): Promise<void> {
  const args = parseArgs(argv)
  const root = requireRoot()
  const config = loadConfig(root)

  // Validate cheap local input before demanding credentials: a bad --interval
  // should say so, not send you hunting for a token you did not need yet.
  const raw = str(args, '--interval')
  const seconds = raw === null ? DEFAULT_INTERVAL_SECONDS : Number(raw)
  if (!Number.isFinite(seconds) || seconds < 30) {
    throw new Error(
      `--interval must be a number of seconds, at least 30 (got ${JSON.stringify(raw)}).\n` +
        '  Figma rate-limits comment reads, and polling faster gets you throttled.',
    )
  }

  const token = requireToken(root)

  const label = config.fileName ?? config.fileKey
  console.log(`\n  watching ${label}  ${dim(`· every ${seconds}s · ctrl-c to stop`)}\n`)

  for (;;) {
    try {
      const { state, delta } = await runSync(root, config, token)
      if (!deltaIsEmpty(delta)) {
        console.log(dim(`  ${new Date().toTimeString().slice(0, 8)}`))
        printDelta(state, delta)
        ping(state, delta, label)
      }
    } catch (err) {
      console.log(yellow(`  ${new Date().toTimeString().slice(0, 8)}  sync failed: ${err instanceof Error ? err.message : err}`))
    }

    if (args.flags['--once']) return
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
  }
}

function printDelta(state: State, delta: Delta): void {
  for (const id of delta.added) {
    const record = state.threads[id]
    if (!record) continue
    console.log(green(`    + ${id}  `) + dim(`${frameLabel(state, record.nodeId)} · @${record.author}`))
    console.log(`      ${truncate(record.message.split('\n')[0] ?? '', 88)}`)
  }
  for (const id of delta.resolved) console.log(green(`    ✓ ${id} resolved`))
  for (const id of delta.reopened) console.log(yellow(`    ↺ ${id} reopened`))
  for (const id of delta.staleWork) console.log(yellow(`    ⚠ ${id} edited after you started work`))
  console.log('')
}

function ping(state: State, delta: Delta, label: string): void {
  if (delta.added.length > 0) {
    const first = state.threads[delta.added[0] as string]
    notify(
      `${delta.added.length} new comment${delta.added.length === 1 ? '' : 's'}`,
      first ? truncate(first.message.split('\n')[0] ?? '', 120) : label,
      first ? `${label} · ${frameLabel(state, first.nodeId)}` : label,
    )
    return
  }
  if (delta.resolved.length > 0) {
    notify(`${delta.resolved.length} resolved`, `The designer signed off in ${label}.`)
    return
  }
  if (delta.staleWork.length > 0) {
    notify('A comment changed', `${delta.staleWork.length} thread(s) edited after you started work.`, label)
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…'
}
