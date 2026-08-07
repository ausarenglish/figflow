import { openWriter } from '../adapters/index.ts'
import { has, parseArgs, str } from '../args.ts'
import { DEFAULT_BASE_BRANCH, loadConfig, requireRoot, requireToken } from '../config.ts'
import { buildMessage, planReport, type PlannedReport } from '../report-plan.ts'
import { threadsFromTrailers } from '../trailers.ts'
import { checkPreview } from '../preview.ts'
import { currentBranch, findPullRequest, previewBase, pullRequestByNumber, type PullRequest } from '../project.ts'
import { loadRoutes } from '../routes.ts'
import { loadShots } from '../shots.ts'
import { loadState, saveState } from '../state.ts'
import { bold, dim, green, yellow } from '../term.ts'

export async function report(argv: string[]): Promise<void> {
  const args = parseArgs(argv)
  const root = requireRoot()
  const config = loadConfig(root)
  const state = loadState(root, config.fileKey)
  const routes = loadRoutes(root)
  const shots = loadShots(root)

  const shouldPost = has(args, '--post')
  const branch = str(args, '--branch') ?? currentBranch(root)
  if (!branch) throw new Error('Not on a git branch, and no --branch given.')

  // Three ways a thread gets into a report, in order of explicitness:
  // named on the command line, marked by `start`, or claimed by a commit
  // trailer. The last needs no ceremony before the work, which is why it
  // exists — but it never overrides an explicit argument.
  const started = Object.entries(state.threads)
    .filter(([, t]) => t.work?.branch === branch && t.status !== 'resolved' && t.status !== 'gone')
    .map(([id]) => id)

  const trailers = has(args, '--no-trailers')
    ? []
    : threadsFromTrailers(root, config.baseBranch ?? DEFAULT_BASE_BRANCH, str(args, '--since'))

  const fromTrailers = trailers
    .map((t) => t.threadId)
    .filter((id) => {
      const record = state.threads[id]
      return record && record.status !== 'resolved' && record.status !== 'gone'
    })

  const threadIds =
    args.positionals.length > 0
      ? args.positionals
      : [...new Set([...started, ...fromTrailers])]

  if (args.positionals.length === 0 && fromTrailers.length > 0) {
    for (const ref of trailers) {
      if (!fromTrailers.includes(ref.threadId)) continue
      console.log(dim(`  trailer ${ref.sha}  ${ref.threadId}  ${ref.subject}`))
    }
  }

  const unknownTrailers = trailers.filter((t) => !state.threads[t.threadId])
  for (const ref of unknownTrailers) {
    console.log(yellow(`  ⚠ commit ${ref.sha} claims thread ${ref.threadId}, which is not in state — run figflow sync`))
  }

  if (threadIds.length === 0) {
    // Interactively this means you mistyped and want to know. On a deploy hook
    // it just means this push had nothing to do with design feedback, which is
    // most pushes — failing there would turn the workflow red until it is
    // switched off.
    if (has(args, '--allow-empty')) {
      console.log(`\n  ${dim(`no threads marked as work on "${branch}" — nothing to report.`)}\n`)
      return
    }
    throw new Error(
      `No threads marked as work on "${branch}".\n` +
        '  Name them:        figflow report <id...>\n' +
        '  Or mark them:     figflow start <id...>\n' +
        '  Or add a trailer to the commit:  Figma: <id>\n' +
        '  In automation:    pass --allow-empty to exit quietly instead.',
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
    shots,
    previewBase: override ? override.replace(/\/+$/, '') : previewBase(template, branch),
    branch,
    pr,
    note: str(args, '--note'),
    threadIds,
  })

  const actionable = plan.filter((item) => item.skip === null)
  if (actionable.length === 0) {
    printPlan(plan, branch, pr, shouldPost)
    console.log(`  ${dim('nothing to post.')}\n`)
    return
  }

  // Never send the designer to a dead link — one bad notification and they stop
  // opening them.
  if (!has(args, '--skip-check')) {
    const urls = [...new Set(actionable.map((item) => item.previewUrl))]
    const verdicts = new Map<string, Awaited<ReturnType<typeof checkPreview>>>()
    for (const url of urls) verdicts.set(url, await checkPreview(url))

    let blocked = false
    for (const item of actionable) {
      const check = verdicts.get(item.previewUrl)
      if (!check) continue

      // A sign-in wall is not fatal IF a screenshot of this screen exists: the
      // reviewer has something they can actually open. Without one, it is the
      // same failure as a dead link — worse, because the page looks healthy.
      const gated = check.redirectedTo !== undefined && !check.ok
      if (gated && item.shotUrl) {
        item.previewGated = true
        item.message = buildMessage({
          pr, branch, note: str(args, '--note'),
          previewUrl: item.previewUrl, shotUrl: item.shotUrl, previewGated: true,
          issue: state.threads[item.threadId]?.issue ?? null,
        })
        continue
      }
      if (!check.ok) blocked = true
    }

    for (const [url, check] of verdicts) {
      const covered = actionable.filter((i) => i.previewUrl === url).every((i) => i.previewGated || check.ok)
      const mark = check.ok ? green('✓') : covered ? yellow('!') : yellow('✗')
      const extra = !check.ok && covered ? dim('  — screenshot supplied instead') : ''
      console.log(`    ${mark} ${url}  ${dim(check.reason)}${extra}`)
    }
    console.log('')

    if (blocked) {
      throw new Error(
        'The preview is not usable, so nothing was posted.\n' +
          '  If it redirects to a sign-in page, a reviewer without an account sees a login\n' +
          '  form rather than the screen. Add an image of it to .figflow/shots.json:\n' +
          '      { "/bookings": "https://…/bookings.png" }\n' +
          '  Or wait for the deploy, pass --preview <url>, or --skip-check to post anyway.',
      )
    }
  }

  // Printed only now: the preview check can rewrite a message (to mark the
  // preview as needing a sign-in), and a dry run that shows different text
  // from what gets posted is worse than no dry run at all.
  printPlan(plan, branch, pr, shouldPost)

  if (!shouldPost) {
    console.log(`  ${bold('nothing was posted.')} re-run with ${bold('--post')} to send it.\n`)
    return
  }

  const token = requireToken(root)
  const writer = openWriter(config, token)
  const now = new Date().toISOString()

  // Dev resources are all-or-nothing per plan, so one refusal settles it.
  let pinning = true
  const stopPinning = (): boolean => {
    console.log(dim('      (not attempting to pin links on the remaining threads)'))
    return false
  }

  for (const item of actionable) {
    await writer.postReply(item.threadId, item.message)
    try {
      await writer.postReaction(item.threadId)
    } catch {
      // A duplicate or rejected reaction is not worth failing the run over.
    }
    if (item.devResources.length > 0 && pinning) {
      // Pinned links are a bonus, not the point — the designer already has the
      // reply. Dev resources need Dev Mode, so this fails on a free plan; that
      // must not abort the run or lose the reports already recorded below.
      //
      // And once it has failed, it will fail identically for every remaining
      // thread. Retrying anyway spent a third of the run's request budget on
      // calls that could not succeed, which is what pushed a 13-thread batch
      // into Figma's write rate limit. Give up after the first refusal.
      try {
        const res = await writer.pinResources(item.devResources)
        const errors = res.errors ?? []
        for (const err of errors) console.log(yellow(`      dev resource: ${err.error}`))
        if (errors.length > 0) pinning = stopPinning()
      } catch (err) {
        console.log(yellow(`      dev resources not pinned: ${err instanceof Error ? err.message.split('\n')[0] : err}`))
        pinning = stopPinning()
      }
    }

    const record = state.threads[item.threadId]
    if (record) {
      state.threads[item.threadId] = {
        ...record,
        status: 'reported',
        reported: { at: now, hash: record.hash, pr: pr?.number ?? null, url: item.previewUrl, branch },
      }
    }
    // Persist per thread: a failure on thread 3 must not lose that 1 and 2 were
    // already told to the designer. Losing that is what causes duplicate pings.
    saveState(root, state)
    console.log(green(`      posted to ${item.threadId}`))
  }

  console.log(`\n  ${green(`posted to ${actionable.length} thread${actionable.length === 1 ? '' : 's'}`)}`)
  console.log(`  ${dim('Figma has notified the designer. `figflow sync` picks up their resolve.')}\n`)
}

function printPlan(plan: PlannedReport[], branch: string, pr: PullRequest | null, posting: boolean): void {
  // Finding a PR automatically needs `gh`, which is optional. Say what to do
  // about it rather than just noting the absence.
  const prLabel = pr ? `PR #${pr.number}` : dim('no PR found — pass --pr N to link one')
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
