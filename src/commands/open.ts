import { execFileSync } from 'node:child_process'
import { parseArgs, str } from '../args.ts'
import { loadConfig, requireRoot } from '../config.ts'
import { currentBranch, joinUrl, previewBase } from '../project.ts'
import { loadRoutes } from '../routes.ts'
import { frameLabel, loadState } from '../state.ts'
import { dim } from '../term.ts'

export function open(argv: string[]): void {
  const args = parseArgs(argv)
  const root = requireRoot()
  const config = loadConfig(root)
  const state = loadState(root, config.fileKey)

  const id = args.positionals[0]
  if (!id) throw new Error('Usage: figflow open <thread-id> [--preview]')

  const record = state.threads[id]
  if (!record) throw new Error(`No thread ${id} in state. Run \`figflow sync\` first.`)

  let url = record.url
  if (args.flags['--preview']) {
    const template = str(args, '--preview') ?? config.preview?.baseUrl
    if (!template || template === 'true') {
      if (!config.preview?.baseUrl) throw new Error('No preview URL configured. See `figflow init --preview`.')
    }
    const branch = currentBranch(root)
    if (!branch) throw new Error('Not on a git branch.')
    const routes = loadRoutes(root)
    url = joinUrl(previewBase(config.preview?.baseUrl ?? '', branch), record.nodeId ? (routes[record.nodeId] ?? null) : null)
  }

  console.log(`\n  ${frameLabel(state, record.nodeId)}  ${dim(url)}\n`)
  launch(url)
}

function launch(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  try {
    execFileSync(cmd, [url], { stdio: 'ignore' })
  } catch {
    // Printing the URL above is the fallback.
  }
}
