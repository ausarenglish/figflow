import { loadConfig, requireRoot, requireToken } from '../config.ts'
import { deltaIsEmpty, runSync } from '../sync-core.ts'
import { frameLabel, type Delta, type State } from '../state.ts'
import { dim, green, yellow } from '../term.ts'

export async function sync(args: string[]): Promise<void> {
  const root = requireRoot()
  const config = loadConfig(root)
  const token = requireToken(root)

  const { state, delta, threads } = await runSync(root, config, token, { write: !args.includes('--dry-run') })

  if (args.includes('--dry-run')) console.log(dim('\n  --dry-run: state not written'))
  report(state, delta, threads.length)
}

export function report(state: State, delta: Delta, total: number): void {
  const open = Object.values(state.threads).filter((t) => t.status === 'open').length
  console.log(`\n  ${total} threads in file  ${dim('·')}  ${open} open`)

  if (deltaIsEmpty(delta)) {
    console.log(dim('  no changes since last sync\n'))
    return
  }

  const lines: string[] = []
  if (delta.added.length) lines.push(green(`  + ${delta.added.length} new`))
  if (delta.resolved.length) lines.push(green(`  ✓ ${delta.resolved.length} newly resolved`))
  if (delta.reopened.length) lines.push(yellow(`  ↺ ${delta.reopened.length} reopened`))
  if (delta.edited.length) lines.push(yellow(`  ✎ ${delta.edited.length} edited`))
  if (delta.gone.length) lines.push(yellow(`  ⚠ ${delta.gone.length} deleted from file`))
  if (delta.staleWork.length) {
    lines.push(yellow(`  ⚠ ${delta.staleWork.length} edited after you started work — re-check before reporting`))
  }

  console.log('')
  console.log(lines.join('\n'))

  const highlight = [...new Set([...delta.added, ...delta.reopened, ...delta.staleWork])]
  if (highlight.length > 0) {
    console.log('')
    for (const id of highlight) {
      const record = state.threads[id]
      if (!record) continue
      const first = record.message.split('\n')[0] ?? ''
      console.log(`    ${id}  ${dim(frameLabel(state, record.nodeId))}  ${dim(`@${record.author}`)}`)
      console.log(`      ${first.length <= 88 ? first : first.slice(0, 87) + '…'}`)
    }
  }

  console.log(`\n  ${dim('figflow context --open')}  to build a work packet\n`)
}
