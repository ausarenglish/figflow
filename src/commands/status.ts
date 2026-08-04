import { loadConfig, requireRoot } from '../config.ts'
import { fmtTime } from '../packet.ts'
import { loadRoutes } from '../routes.ts'
import { groupByFrame, isStale, loadState, type State, type ThreadRecord } from '../state.ts'
import { dim, green, yellow } from '../term.ts'

const ACTIVE: ThreadRecord['status'][] = ['open', 'in_progress', 'reported']

export function status(args: string[]): void {
  const root = requireRoot()
  const config = loadConfig(root)
  const state = loadState(root, config.fileKey)
  const routes = loadRoutes(root)

  const all = Object.entries(state.threads)
  if (all.length === 0) {
    console.log(`\n  no threads yet — run ${dim('figflow sync')}\n`)
    return
  }

  const count = (status: ThreadRecord['status']) => all.filter(([, t]) => t.status === status).length

  console.log(`\n  ${config.fileName ?? config.fileKey}`)
  console.log(
    `  ${count('open')} open  ${dim('·')}  ${count('in_progress')} in progress  ${dim('·')}  ` +
      `${count('reported')} awaiting review  ${dim('·')}  ${count('resolved')} resolved` +
      (state.lastSyncAt ? `\n  ${dim(`synced ${fmtTime(state.lastSyncAt)}`)}` : ''),
  )

  const stale = all.filter(([, t]) => isStale(t) && ACTIVE.includes(t.status))
  if (stale.length > 0) {
    console.log(yellow(`\n  ⚠ ${stale.length} comment${stale.length === 1 ? '' : 's'} edited after you started work:`))
    for (const [id] of stale) console.log(yellow(`      ${id}`))
  }

  const showAll = args.includes('--all')
  const visible = all.filter(([, t]) => (showAll ? t.status !== 'gone' : ACTIVE.includes(t.status)))
  if (visible.length === 0) {
    console.log(green('\n  nothing open — all caught up\n'))
    return
  }

  for (const [frame, group] of groupByFrame(state, visible)) {
    const route = group[0]?.[1].nodeId ? routes[group[0][1].nodeId as string] : undefined
    console.log(`\n  ${frame}  ${dim(`(${group.length})`)}${route ? dim(`  ${route}`) : ''}`)
    for (const [id, record] of group) {
      console.log(`    ${mark(record)} ${id}  ${dim(`@${record.author}`)}  ${summarize(state, record)}`)
    }
  }

  console.log(`\n  ${dim('figflow context <id>')}  ${dim('·')}  ${dim('figflow start <id>')}\n`)
}

function mark(record: ThreadRecord): string {
  switch (record.status) {
    case 'resolved':
      return green('✓')
    case 'reported':
      return green('◉')
    case 'in_progress':
      return '◐'
    case 'gone':
      return yellow('⚠')
    default:
      return '○'
  }
}

function summarize(_state: State, record: ThreadRecord): string {
  const first = (record.message.split('\n')[0] ?? '').trim()
  const head = first.length <= 66 ? first : first.slice(0, 65) + '…'
  const parts: string[] = []
  if (record.replies.length > 0) {
    parts.push(`${record.replies.length} ${record.replies.length === 1 ? 'reply' : 'replies'}`)
  }
  if (record.work) parts.push(record.work.branch)
  if (isStale(record)) parts.push('edited since')
  return head + (parts.length > 0 ? dim(`  (${parts.join(', ')})`) : '')
}
