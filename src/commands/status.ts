import { loadConfig, requireRoot } from '../config.ts'
import { fmtTime } from '../packet.ts'
import { groupByFrame, loadState, type ThreadRecord } from '../state.ts'
import { dim, green, yellow } from '../term.ts'

export function status(args: string[]): void {
  const root = requireRoot()
  const config = loadConfig(root)
  const state = loadState(root, config.fileKey)

  const all = Object.entries(state.threads)
  if (all.length === 0) {
    console.log(`\n  no threads yet — run ${dim('figflow sync')}\n`)
    return
  }

  const showAll = args.includes('--all')
  const counts = {
    open: all.filter(([, t]) => t.status === 'open').length,
    resolved: all.filter(([, t]) => t.status === 'resolved').length,
    gone: all.filter(([, t]) => t.status === 'gone').length,
  }

  console.log(`\n  ${config.fileName ?? config.fileKey}`)
  console.log(
    `  ${counts.open} open  ${dim('·')}  ${counts.resolved} resolved` +
      (counts.gone ? `  ${dim('·')}  ${counts.gone} deleted` : '') +
      (state.lastSyncAt ? `  ${dim(`· synced ${fmtTime(state.lastSyncAt)}`)}` : ''),
  )

  const visible = all.filter(([, t]) => (showAll ? t.status !== 'gone' : t.status === 'open'))
  if (visible.length === 0) {
    console.log(green('\n  nothing open — all caught up\n'))
    return
  }

  for (const [frame, group] of groupByFrame(state, visible)) {
    console.log(`\n  ${frame}  ${dim(`(${group.length})`)}`)
    for (const [id, record] of group) {
      console.log(`    ${mark(record)} ${id}  ${dim(`@${record.author}`)}  ${summarize(record)}`)
    }
  }

  console.log(`\n  ${dim('figflow context <id>')}  or  ${dim('figflow context --open')}\n`)
}

function mark(record: ThreadRecord): string {
  if (record.status === 'resolved') return green('✓')
  if (record.status === 'gone') return yellow('⚠')
  return '○'
}

function summarize(record: ThreadRecord): string {
  const first = (record.message.split('\n')[0] ?? '').trim()
  const replies = record.replies.length > 0 ? dim(`  (${record.replies.length} ${record.replies.length === 1 ? 'reply' : 'replies'})`) : ''
  return (first.length <= 70 ? first : first.slice(0, 69) + '…') + replies
}
