import { has, parseArgs, str } from '../args.ts'
import { loadConfig, requireRoot, requireToken } from '../config.ts'
import { postDevResources, postReaction, postReply } from '../figma-write.ts'
import { planReport, type PlannedReport } from '../report-plan.ts'
import { currentBranch, findPullRequest, previewBase, pullRequestByNumber, type PullRequest } from '../project.ts'
import { loadRoutes } from '../routes.ts'
import { loadState, saveState } from '../state.ts'
import { bold, dim, green, yellow } from '../term.ts'

export async function report(argv: string[]): Promise<void> {
  const args = parseArgs(argv)
  const root = requireRoot()
  const config = loadConfig(root)
  const state = loadState(root, config.fileKey)
  const routes = loadRoutes(root)

  const shouldPost = has(args, '--post')
  const branch = str(args, '--branch') ?? currentBranch(root)
  if (!branch) throw new Error('Not on a git branch, and no --branch given.')

  const threadIds =
    args.positionals.length > 0
      ? args.positionals
      : Object.entries(state.threads)
          .filter(([, t]) => t.work?.branch === branch && t.status !== 'resolved' && t.status !== 'gone')
          .map(([id]) => id)

  if (threadIds.length === 0) {
    throw new Error(
      `No threads marked as work on "${branch}".\n` +
        '  Mark them first:  figflow start <id...>\n' +
        '  Or name them:     figflow report <id...>',
    )
  }

  const override = str(args, '--preview')
  const template = override ?? config.preview?.baseUrl
  if (!template) {
    throw new Error(
      'No preview URL configured. Add one to .figflow/config.json:\n' +
        '    "preview": { "baseUrl": "https://oonee-mvp-git-{branch}.vercel.app" }\n' +
        '  or pass --preview <url>.',
    )
  }

  const prFlag = str(args, '--pr')
  const pr: PullRequest | null = prFlag
    ? pullRequestByNumber(root, Number(prFlag))
    : findPullRequest(root, branch)

  const plan = planReport({
    state,
    routes,
    fileKey: config.fileKey,
    previewBase: override ? override.replace(/\/+$/, '') : previewBase(template, branch),
    branch,
    pr,
    note: str(args, '--note'),
    threadIds,
  })

  printPlan(plan, branch, pr, shouldPost)

  const actionable = plan.filter((item) => item.skip === null)
  if (actionable.length === 0) {
    console.log(`  ${dim('nothing to post.')}\n`)
    return
  }

  if (!shouldPost) {
    console.log(`  ${bold('nothing was posted.')} re-run with ${bold('--post')} to send it.\n`)
    return
  }

  const token = requireToken()
  const now = new Date().toISOString()

  for (const item of actionable) {
    await postReply(config.fileKey, item.threadId, item.message, token)
    try {
      await postReaction(config.fileKey, item.threadId, token)
    } catch {
      // A duplicate or rejected reaction is not worth failing the run over.
    }
    if (item.devResources.length > 0) {
      const res = await postDevResources(item.devResources, token)
      for (const err of res.errors ?? []) console.log(yellow(`      dev resource: ${err.error}`))
    }

    const record = state.threads[item.threadId]
    if (record) {
      state.threads[item.threadId] = {
        ...record,
        status: 'reported',
        reported: { at: now, hash: record.hash, pr: pr?.number ?? null, url: item.previewUrl, branch },
      }
    }
    console.log(green(`      posted to ${item.threadId}`))
  }

  saveState(root, state)
  console.log(`\n  ${green(`posted to ${actionable.length} thread${actionable.length === 1 ? '' : 's'}`)}`)
  console.log(`  ${dim('Figma has notified the designer. `figflow sync` picks up their resolve.')}\n`)
}

function printPlan(plan: PlannedReport[], branch: string, pr: PullRequest | null, posting: boolean): void {
  const prLabel = pr ? `PR #${pr.number}` : dim('no PR found')
  console.log(`\n  ${posting ? bold('posting') : bold('dry run')}  ${dim('·')}  ${branch}  ${dim('·')}  ${prLabel}\n`)

  for (const item of plan) {
    const head = `    ${item.threadId}  ${dim(item.frame)}`
    if (item.skip !== null) {
      console.log(`${head}  ${dim(`skipped — ${item.skip}`)}`)
      continue
    }
    console.log(head + (item.stale ? yellow('  ⚠ edited since you started') : ''))
    console.log(
      item.route
        ? `      → ${item.previewUrl}`
        : yellow(`      → ${item.previewUrl}   (no route mapped for this frame)`),
    )
    if (item.devResources.length > 0) {
      console.log(dim(`      pins to frame: ${item.devResources.map((d) => d.name).join(', ')}`))
    }
  }

  const first = plan.find((item) => item.skip === null)
  if (first) {
    console.log(`\n  ${dim('reply the designer will receive:')}`)
    console.log(dim('      ┌'))
    for (const line of first.message.split('\n')) console.log(dim(`      │ ${line}`))
    console.log(dim('      └'))
    console.log('')
  }
}
