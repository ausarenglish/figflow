import { relative } from 'node:path'
import { loadConfig, requireRoot } from '../config.ts'
import { loadRoutes, routesPath, writeStub } from '../routes.ts'
import { frameLabel, loadState } from '../state.ts'
import { dim, green, yellow } from '../term.ts'

export function routes(argv: string[]): void {
  const root = requireRoot()
  const config = loadConfig(root)
  const state = loadState(root, config.fileKey)

  if (argv.includes('--init')) {
    const { total, filled } = writeStub(root, state)
    console.log(`\n  wrote ${relative(root, routesPath(root))}  ${dim(`— ${total} frames, ${filled} already mapped`)}`)
    console.log(dim('\n  fill in the app path for each frame, e.g. "/services". Frames you leave'))
    console.log(dim('  blank still get reported, they just link to the preview root.\n'))
    return
  }

  const map = loadRoutes(root)
  const anchored = [
    ...new Set(
      Object.values(state.threads)
        .filter((t) => t.status !== 'gone' && t.nodeId)
        .map((t) => t.nodeId as string),
    ),
  ].sort((a, b) => frameLabel(state, a).localeCompare(frameLabel(state, b)))

  if (anchored.length === 0) {
    console.log(`\n  no frames with comments yet — run ${dim('figflow sync')}\n`)
    return
  }

  console.log('')
  for (const nodeId of anchored) {
    const path = map[nodeId]
    console.log(`  ${path ? green('✓') : yellow('·')} ${frameLabel(state, nodeId).padEnd(32)} ${path ?? dim('unmapped')}`)
  }
  const missing = anchored.filter((id) => !map[id]).length
  console.log(missing > 0 ? `\n  ${missing} unmapped  ${dim('· figflow routes --init')}\n` : '\n')
}
