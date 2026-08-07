import { execFileSync } from 'node:child_process'
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

  const onChange = str(args, '--on-change')
  const token = requireToken(root)

  const label = config.fileName ?? config.fileKey
  console.log(
    `\n  watching ${label}  ${dim(`· every ${seconds}s${onChange ? ' · on-change hook set' : ''} · ctrl-c to stop`)}\n`,
  )

  for (;;) {
    try {
      const { state, delta } = await runSync(root, config, token)
      if (!deltaIsEmpty(delta)) {
        console.log(dim(`  ${new Date().toTimeString().slice(0, 8)}`))
        printDelta(state, delta)
        ping(state, delta, label)
        const change = describeChange(state, delta, label)
        if (onChange && change) runHook(onChange, change, config.fileKey)
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

  // Plain edits — usually a designer replying to a thread we have not reported
  // — were detected but never printed, so the log showed a bare timestamp with
  // nothing under it. Show the reply, since that is the part worth reading.
  const stale = new Set(delta.staleWork)
  for (const id of delta.edited) {
    if (stale.has(id)) continue
    const record = state.threads[id]
    if (!record) continue
    const reply = record.replies.at(-1)
    console.log(yellow(`    ✎ ${id}  `) + dim(`${frameLabel(state, record.nodeId)} · @${reply?.author ?? record.author}`))
    console.log(`      ${truncate((reply?.message ?? record.message).split('\n')[0] ?? '', 88)}`)
  }
  for (const id of delta.gone) console.log(yellow(`    ⚠ ${id} deleted from the file`))
  console.log('')
}

export type ChangeSummary = { summary: string; detail: string; context: string }

/**
 * Describe a delta once, for both the desktop notification and the --on-change
 * hook. Any change qualifies, not merely the three that used to: a designer
 * replying to a thread you have not reported yet counted only as `edited` and
 * fired nothing — which is the single most useful thing to hear about, since it
 * is usually a question or a pushback waiting on you.
 */
export function describeChange(state: State, delta: Delta, label: string): ChangeSummary | null {
  // Most actionable first: someone is waiting on you, then something is new,
  // then something merely closed.
  const ORDER: [keyof Delta, string][] = [
    ['staleWork', 'changed after you reported'],
    ['added', 'new'],
    ['edited', 'updated'],
    ['reopened', 'reopened'],
    ['resolved', 'resolved'],
    ['gone', 'deleted'],
  ]

  const counted = ORDER.filter(([key]) => delta[key].length > 0)
  if (counted.length === 0) return null

  // `staleWork` is a subset of `edited`; counting both would double-report.
  const summary = counted
    .filter(([key]) => !(key === 'edited' && delta.staleWork.length >= delta.edited.length))
    .map(([key, word]) => `${delta[key].length} ${word}`)
    .join(' · ')

  const [focusKey] = counted[0] as [keyof Delta, string]
  const focusId = delta[focusKey][0]
  const record = focusId ? state.threads[focusId] : undefined

  return {
    summary,
    detail: record ? truncate(latestText(record), 200) : label,
    context: record ? `${label} · ${frameLabel(state, record.nodeId)} · @${latestAuthor(record)}` : label,
  }
}

function ping(state: State, delta: Delta, label: string): void {
  const change = describeChange(state, delta, label)
  if (change) notify(change.summary, change.detail, change.context)
}

/** What actually changed is usually the newest reply, not the original ask. */
function latestText(record: State['threads'][string]): string {
  const last = record.replies.at(-1)
  const text = last ? last.message : record.message
  return text.split('\n')[0] ?? ''
}

function latestAuthor(record: State['threads'][string]): string {
  return record.replies.at(-1)?.author ?? record.author
}

/**
 * Run an arbitrary command when something changes. figflow stays ignorant of
 * email, Slack, SMS and everything else — it hands the facts to a command and
 * lets the caller route them. A notifier must never be able to kill the loop,
 * so a failing hook is logged and polling continues.
 */
function runHook(command: string, change: ChangeSummary, fileKey: string): void {
  try {
    execFileSync('/bin/sh', ['-c', command], {
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 20_000,
      env: {
        ...process.env,
        FIGFLOW_SUMMARY: change.summary,
        FIGFLOW_DETAIL: change.detail,
        FIGFLOW_CONTEXT: change.context,
        FIGFLOW_FILE_KEY: fileKey,
      },
    })
  } catch (err) {
    console.log(yellow(`    on-change hook failed: ${err instanceof Error ? err.message.split('\n')[0] : err}`))
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…'
}
