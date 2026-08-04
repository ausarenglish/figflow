import { context } from './commands/context.ts'
import { init } from './commands/init.ts'
import { status } from './commands/status.ts'
import { sync } from './commands/sync.ts'
import { bold, dim } from './term.ts'

const HELP = `
  ${bold('figflow')} — pull Figma comments into local state, emit work packets

  ${bold('figflow init')} <figma-url|key> [--name "Project"]
      Write .figflow/config.json in the current directory.

  ${bold('figflow sync')} [--dry-run]
      Fetch comments from Figma, fold them into .figflow/state.json,
      print what changed. Read-only against Figma.

  ${bold('figflow status')} [--all]
      Open threads grouped by frame. Reads local state, no network.

  ${bold('figflow context')} <id...> | --open [--json]
      Print a Markdown work packet for an agent. Reads local state.

  ${dim('Requires FIGMA_TOKEN (scopes: file_comments:read, file_content:read).')}
  ${dim('figflow never writes to Figma. Resolving a comment stays a human action —')}
  ${dim('Figma exposes no API to resolve one.')}
`

export async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv

  switch (command) {
    case 'init':
      return init(args)
    case 'sync':
      return sync(args)
    case 'status':
      return status(args)
    case 'context':
      return context(args)
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      console.log(HELP)
      return
    case '-v':
    case '--version':
      console.log('0.0.1')
      return
    default:
      throw new Error(`Unknown command: ${command}\n  Run \`figflow help\`.`)
  }
}
