import { execFileSync } from 'node:child_process'
import { parseArgs, str } from '../args.ts'
import { loadConfig, requireRoot } from '../config.ts'
import { fmtTime } from '../packet.ts'
import { loadRoutes, type Routes } from '../routes.ts'
import { frameLabel, loadState, saveState, type State, type ThreadRecord } from '../state.ts'
import { dim, green, yellow } from '../term.ts'

/**
 * Unlike `report`, this writes to your own repo rather than the designer's file,
 * so it acts immediately — the safety default tracks real risk, not symmetry.
 * `--dry-run` prints the issue body instead.
 */
export function issue(argv: string[]): void {
  const args = parseArgs(argv)
  const root = requireRoot()
  const config = loadConfig(root)
  const state = loadState(root, config.fileKey)
  const routes = loadRoutes(root)

  const ids = args.positionals
  if (ids.length === 0) {
    throw new Error('Usage: figflow issue <thread-id...> [--title "…"] [--label x] [--each] [--dry-run]')
  }

  const records = ids.map((id): [string, ThreadRecord] => {
    const record = state.threads[id]
    if (!record) throw new Error(`No thread ${id} in state. Run \`figflow sync\` first.`)
    if (record.issue) console.log(yellow(`  note: ${id} is already on issue #${record.issue.number}`))
    return [id, record]
  })

  const dryRun = args.flags['--dry-run'] === true
  const groups = args.flags['--each'] ? records.map((entry) => [entry]) : [records]

  for (const group of groups) {
    const title = str(args, '--title') ?? deriveTitle(state, group)
    const body = buildBody(state, routes, group)

    if (dryRun) {
      console.log(`\n  ${dim('title:')} ${title}\n`)
      console.log(body.split('\n').map((line) => `  ${dim('│')} ${line}`).join('\n'))
      console.log('')
      continue
    }

    const url = createIssue(root, title, body, str(args, '--label'))
    const number = Number(url.split('/').pop())
    console.log(`\n  ${green(`#${number}`)}  ${title}\n  ${dim(url)}`)

    for (const [id, record] of group) {
      state.threads[id] = { ...record, issue: { number, url, title } }
    }
  }

  if (!dryRun) {
    saveState(root, state)
    console.log(`\n  ${dim('next:')} figflow start ${ids.join(' ')}\n`)
  }
}

function deriveTitle(state: State, group: [string, ThreadRecord][]): string {
  const frames = [...new Set(group.map(([, record]) => frameLabel(state, record.nodeId)))]
  const scope = frames.length === 1 ? frames[0] : `${frames.length} frames`
  return `Design feedback: ${scope} (${group.length} comment${group.length === 1 ? '' : 's'})`
}

function buildBody(state: State, routes: Routes, group: [string, ThreadRecord][]): string {
  const out: string[] = ['From Figma design review.', '']

  for (const [id, record] of group) {
    const route = record.nodeId ? routes[record.nodeId] : undefined
    out.push(`### ${frameLabel(state, record.nodeId)}${route ? ` — \`${route}\`` : ''}`)
    out.push('')
    out.push(`**@${record.author}** · ${fmtTime(record.createdAt)} · [thread ${id}](${record.url})`)
    out.push('')
    out.push(
      record.message
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n'),
    )
    out.push('')
    for (const reply of record.replies) {
      out.push(`- **@${reply.author}**: ${reply.message.replace(/\n/g, ' ')}`)
    }
    if (record.replies.length > 0) out.push('')
  }

  out.push('---')
  out.push('')
  out.push(`Close the loop with \`figflow report ${group.map(([id]) => id).join(' ')} --post\`.`)

  return out.join('\n')
}

function createIssue(cwd: string, title: string, body: string, label: string | null): string {
  const args = ['issue', 'create', '--title', title, '--body', body]
  if (label) args.push('--label', label)
  try {
    return execFileSync('gh', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (err) {
    throw new Error(
      `gh issue create failed: ${err instanceof Error ? err.message.split('\n')[0] : err}\n` +
        '  figflow uses the gh CLI for issues — check `gh auth status`.',
    )
  }
}
