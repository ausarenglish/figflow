import { loadConfig, requireRoot, requireToken } from '../config.ts'
import { fetchComments, fetchNodeNames, toThreads } from '../figma.ts'
import { frameLabel, loadState, reconcile, saveState, type Delta, type State } from '../state.ts'
import { dim, green, yellow } from '../term.ts'

export async function sync(args: string[]): Promise<void> {
  const root = requireRoot()
  const config = loadConfig(root)
  const token = requireToken()

  const comments = await fetchComments(config.fileKey, token)
  const threads = toThreads(config.fileKey, comments)

  const state = loadState(root, config.fileKey)
  const anchored = threads.map((t) => t.nodeId).filter((id): id is string => id !== null)
  const names = await fetchNodeNames(config.fileKey, anchored, token)

  const withNodes: State = {
    ...state,
    fileKey: config.fileKey,
    nodes: { ...state.nodes, ...Object.fromEntries(names) },
  }

  const { state: next, delta } = reconcile(withNodes, threads, new Date().toISOString())

  if (args.includes('--dry-run')) {
    console.log(dim('\n  --dry-run: state not written'))
  } else {
    saveState(root, next)
  }

  report(next, delta, threads.length)
}

function report(state: State, delta: Delta, total: number): void {
  const open = Object.values(state.threads).filter((t) => t.status === 'open').length
  console.log(`\n  ${total} threads in file  ${dim('·')}  ${open} open`)

  const lines: string[] = []
  if (delta.added.length) lines.push(green(`  + ${delta.added.length} new`))
  if (delta.resolved.length) lines.push(green(`  ✓ ${delta.resolved.length} newly resolved`))
  if (delta.reopened.length) lines.push(yellow(`  ↺ ${delta.reopened.length} reopened`))
  if (delta.edited.length) lines.push(yellow(`  ✎ ${delta.edited.length} edited`))
  if (delta.gone.length) lines.push(yellow(`  ⚠ ${delta.gone.length} deleted from file`))

  if (lines.length === 0) {
    console.log(dim('  no changes since last sync\n'))
    return
  }

  console.log('')
  console.log(lines.join('\n'))

  const highlight = [...delta.added, ...delta.reopened]
  if (highlight.length > 0) {
    console.log('')
    for (const id of highlight) {
      const record = state.threads[id]
      if (!record) continue
      const first = record.message.split('\n')[0] ?? ''
      console.log(`    ${id}  ${dim(frameLabel(state, record.nodeId))}  @${record.author}`)
      console.log(`      ${truncate(first, 88)}`)
    }
  }

  console.log(`\n  ${dim('figflow context --open')}  to build a work packet\n`)
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…'
}
