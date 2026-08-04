import { context } from './commands/context.ts'
import { init } from './commands/init.ts'
import { report } from './commands/report.ts'
import { routes } from './commands/routes.ts'
import { start } from './commands/start.ts'
import { status } from './commands/status.ts'
import { sync } from './commands/sync.ts'
import { bold, dim } from './term.ts'

const HELP = `
  ${bold('figflow')} — carry Figma comments into your repo, and the result back

  ${bold('setup')}
    figflow init <figma-url> [--name "…"] [--preview "https://app-git-{branch}.vercel.app"]
    figflow routes [--init]        map each commented frame to an app path

  ${bold('daily')}
    figflow sync                   pull comments from Figma, show what changed
    figflow status [--all]         open threads, grouped by frame
    figflow context <id…> | --open work packet for an agent  [--json]

  ${bold('closing the loop')}
    figflow start <id…>            mark threads as work on the current branch
    figflow report [id…] [--post]  reply + ✅ + pin PR/preview to the frame
                                   dry run unless you pass --post
                                   [--note "…"] [--pr N] [--preview URL]

  ${dim('FIGMA_TOKEN scopes: file_comments:read, file_content:read')}
  ${dim('                    file_comments:write, file_dev_resources:write  (report only)')}

  ${dim('Figma has no API to resolve a comment — that click stays the designer\'s.')}
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
    case 'routes':
      return routes(args)
    case 'start':
      return start(args)
    case 'report':
      return report(args)
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      console.log(HELP)
      return
    case '-v':
    case '--version':
      console.log('0.1.0')
      return
    default:
      throw new Error(`Unknown command: ${command}\n  Run \`figflow help\`.`)
  }
}
