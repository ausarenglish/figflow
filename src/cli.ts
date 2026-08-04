import { context } from './commands/context.ts'
import { init } from './commands/init.ts'
import { issue } from './commands/issue.ts'
import { open } from './commands/open.ts'
import { report } from './commands/report.ts'
import { routes } from './commands/routes.ts'
import { start } from './commands/start.ts'
import { status } from './commands/status.ts'
import { sync } from './commands/sync.ts'
import { watch } from './commands/watch.ts'
import { bold, dim } from './term.ts'

const HELP = `
  ${bold('figflow')} — carry Figma comments into your repo, and the result back

  ${bold('setup')}
    figflow init <figma-url> [--name "…"] [--preview "https://app-git-{branch}.vercel.app"]
    figflow routes [--init]          map each commented frame to an app path

  ${bold('daily')}
    figflow sync                     pull comments, show what changed
    figflow watch [--interval 300]   poll, and ping you when a comment lands
    figflow status [--all]           threads grouped by frame
    figflow context <id…> | --open   work packet for an agent  [--json]
    figflow open <id> [--preview]    open the thread (or its preview) in a browser

  ${bold('closing the loop')}
    figflow issue <id…>              GitHub issue from one or more threads
                                     [--title "…"] [--label x] [--each] [--dry-run]
    figflow start <id…>              tie threads to the current branch
    figflow report [id…] [--post]    reply + ✅ + pin PR/preview to the frame
                                     dry run unless --post; checks the preview is up
                                     [--note "…"] [--pr N] [--preview URL] [--skip-check]

  ${dim('FIGMA_TOKEN scopes: file_comments:read, file_content:read')}
  ${dim('                    file_comments:write, file_dev_resources:write  (report only)')}

  ${dim("Figma has no API to resolve a comment — that click stays the designer's.")}
`

export async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv

  switch (command) {
    case 'init':
      return init(args)
    case 'sync':
      return sync(args)
    case 'watch':
      return watch(args)
    case 'status':
      return status(args)
    case 'context':
      return context(args)
    case 'routes':
      return routes(args)
    case 'open':
      return open(args)
    case 'issue':
      return issue(args)
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
      console.log('0.2.0')
      return
    default:
      throw new Error(`Unknown command: ${command}\n  Run \`figflow help\`.`)
  }
}
