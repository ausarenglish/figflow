import type { PinnedResource } from './adapters/types.ts'
import type { PullRequest } from './project.ts'
import { joinUrl } from './project.ts'
import type { Routes } from './routes.ts'
import { shotFor, type Shots } from './shots.ts'
import { frameLabel, isStale, type State, type ThreadRecord } from './state.ts'

export type PlannedReport = {
  threadId: string
  frame: string
  nodeId: string | null
  route: string | null
  previewUrl: string
  /** An image of this screen, for reviewers who cannot sign in. */
  shotUrl: string | null
  /** True when the preview redirects to a sign-in page. Set by `report`. */
  previewGated: boolean
  message: string
  devResources: PinnedResource[]
  /** Set when this thread will be left alone, with the reason why. */
  skip: string | null
  stale: boolean
}

export type PlanInput = {
  state: State
  routes: Routes
  shots?: Shots
  previewBase: string
  branch: string
  pr: PullRequest | null
  note: string | null
  threadIds: string[]
}

/**
 * Decide what would be posted, without posting. Pure, so the interesting
 * behaviour — idempotency, staleness, missing routes — is testable offline and
 * `--post` executes a plan that has already been printed.
 */
export function planReport(input: PlanInput): PlannedReport[] {
  const { state, routes, previewBase, branch, pr, note } = input
  const shots = input.shots ?? {}
  const nodesSeen = new Set<string>()

  return input.threadIds.map((threadId): PlannedReport => {
    const record = state.threads[threadId]
    const frame = record ? frameLabel(state, record.nodeId) : threadId
    const route = record?.nodeId ? (routes[record.nodeId] ?? null) : null
    const previewUrl = joinUrl(previewBase, route)
    const shotUrl = shotFor(shots, route)

    const base: PlannedReport = {
      threadId,
      frame,
      nodeId: record?.nodeId ?? null,
      route,
      previewUrl,
      shotUrl,
      previewGated: false,
      message: buildMessage({ pr, branch, note, previewUrl, shotUrl, previewGated: false, issue: record?.issue ?? null }),
      devResources: [],
      skip: null,
      stale: record ? isStale(record) : false,
    }

    if (!record) return { ...base, skip: 'not in state — run figflow sync' }
    if (record.status === 'gone') return { ...base, skip: 'comment was deleted from the file' }
    if (record.status === 'resolved') return { ...base, skip: 'already resolved by the designer' }

    const already = alreadyReported(record, previewUrl, pr)
    if (already) return { ...base, skip: already }

    // One dev resource set per frame, not per thread — several comments on the
    // same frame must not pin the same link three times.
    const devResources: PinnedResource[] = []
    if (record.nodeId && !nodesSeen.has(record.nodeId)) {
      nodesSeen.add(record.nodeId)
      devResources.push({ name: 'Preview', url: previewUrl, anchorId: record.nodeId })
      if (pr?.url) {
        devResources.push({ name: `PR #${pr.number}`, url: pr.url, anchorId: record.nodeId })
      }
      if (record.issue) {
        devResources.push({
          name: `Issue #${record.issue.number}`,
          url: record.issue.url,
          anchorId: record.nodeId,
        })
      }
    }

    return { ...base, devResources }
  })
}

/**
 * Two independent guards against notifying the designer twice: our own state,
 * and — in case state was lost or reset — the thread's existing replies.
 *
 * The state guard keys on the thread hash ALONE, deliberately. It used to also
 * require the PR and preview URL to match, which meant the same unchanged ask
 * was reported again the moment the URL changed — exactly what happens when a
 * branch preview is followed by a production deploy of the same work. With no
 * PR to fall back on, the reply scan missed it too, and the designer got two
 * notifications for one piece of work.
 *
 * What earns a designer's attention is the ask changing, not the URL changing.
 */
function alreadyReported(record: ThreadRecord, previewUrl: string, pr: PullRequest | null): string | null {
  const prior = record.reported
  if (prior && prior.hash === record.hash) {
    return 'already reported — the comment has not changed since'
  }
  // State can be lost, reset, or arrive from another machine mid-rebase. Any
  // URL we have ever pointed at this thread is evidence we have already spoken.
  const markers = [previewUrl, pr?.url, prior?.url].filter((m): m is string => Boolean(m))
  if (record.replies.some((reply) => markers.some((m) => reply.message.includes(m)))) {
    return 'a reply already links this PR/preview'
  }
  return null
}

export function buildMessage(args: {
  pr: PullRequest | null
  branch: string
  note: string | null
  previewUrl: string
  shotUrl?: string | null
  previewGated?: boolean
  issue: { number: number; url: string } | null
}): string {
  const lines: string[] = []

  if (args.pr) {
    // A title only exists when `gh` found the PR for us; --pr N has none.
    lines.push(
      args.pr.title
        ? `✅ Addressed in ${args.pr.title} (#${args.pr.number})`
        : `✅ Addressed in PR #${args.pr.number}`,
    )
  } else {
    lines.push(`✅ Addressed on branch ${args.branch}`)
  }
  if (args.note) {
    lines.push('')
    lines.push(args.note)
  }
  lines.push('')
  // The screenshot comes first when the preview needs an account: it is the
  // thing the reviewer can actually open.
  if (args.shotUrl) lines.push(`Screenshot: ${args.shotUrl}`)
  lines.push(
    args.previewGated
      ? `Preview (needs a sign-in): ${args.previewUrl}`
      : `Preview: ${args.previewUrl}`,
  )
  if (args.pr?.url) lines.push(`PR: ${args.pr.url}`)
  if (args.issue) lines.push(`Issue: ${args.issue.url}`)
  lines.push('')
  lines.push('Ready for your review — resolve this comment if it looks right.')

  return lines.join('\n')
}
