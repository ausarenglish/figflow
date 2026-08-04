import { loadConfig, requireRoot } from '../config.ts'
import { renderJson, renderPacket } from '../packet.ts'
import { loadState, type ThreadRecord } from '../state.ts'

export function context(args: string[]): void {
  const root = requireRoot()
  const config = loadConfig(root)
  const state = loadState(root, config.fileKey)

  const wantOpen = args.includes('--open')
  const asJson = args.includes('--json')
  const ids = args.filter((a) => !a.startsWith('-'))

  let entries: [string, ThreadRecord][]
  let heading: string | undefined

  if (wantOpen) {
    entries = Object.entries(state.threads).filter(([, t]) => t.status === 'open')
    heading = `Figma design feedback — ${entries.length} open thread${entries.length === 1 ? '' : 's'}`
  } else if (ids.length > 0) {
    entries = ids.map((id) => {
      const record = state.threads[id]
      if (!record) throw new Error(`No thread ${id} in state. Run \`figflow sync\`, or check \`figflow status\`.`)
      return [id, record] as [string, ThreadRecord]
    })
  } else {
    throw new Error('Usage: figflow context <thread-id...>  |  figflow context --open  [--json]')
  }

  if (entries.length === 0) {
    console.error('  nothing to build a packet from — no open threads')
    return
  }

  entries.sort(([, a], [, b]) => a.createdAt.localeCompare(b.createdAt))

  process.stdout.write(asJson ? renderJson(state, entries) + '\n' : renderPacket(state, config, entries, { heading }) + '\n')
}
