import { loadConfig, requireRoot } from '../config.ts'
import { currentBranch } from '../project.ts'
import { frameLabel, loadState, saveState } from '../state.ts'
import { dim, yellow } from '../term.ts'

export function start(args: string[]): void {
  const root = requireRoot()
  const config = loadConfig(root)
  const state = loadState(root, config.fileKey)

  const ids = args.filter((a) => !a.startsWith('-'))
  if (ids.length === 0) {
    throw new Error('Usage: figflow start <thread-id...>   (marks threads as being worked on this branch)')
  }

  const branch = currentBranch(root)
  if (!branch) throw new Error('Not on a git branch — figflow start ties work to the current branch.')

  const now = new Date().toISOString()
  console.log(`\n  branch ${branch}\n`)

  for (const id of ids) {
    const record = state.threads[id]
    if (!record) throw new Error(`No thread ${id} in state. Run \`figflow sync\` first.`)

    state.threads[id] = {
      ...record,
      status: record.status === 'resolved' ? record.status : 'in_progress',
      work: { branch, startedAt: now, hashAtStart: record.hash },
    }

    const flag = record.status === 'resolved' ? yellow('  (already resolved in Figma)') : ''
    console.log(`    ${id}  ${dim(frameLabel(state, record.nodeId))}${flag}`)
  }

  saveState(root, state)
  console.log(`\n  ${dim('when the preview is up:')} figflow report\n`)
}
