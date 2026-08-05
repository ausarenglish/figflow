import type { DevResource } from './figma-write.ts'
import type { PullRequest } from './project.ts'
import { joinUrl } from './project.ts'
import type { Routes } from './routes.ts'
import { frameLabel, isStale, type State, type ThreadRecord } from './state.ts'

export type PlannedReport = {
  threadId: string
  frame: string
  nodeId: string | null
  route: string | null
  previewUrl: string
  message: string
  devResources: DevResource[]
  /** Set when this thread will be left alone, with the reason why. */
  skip: string | null
  stale: boolean
}

export type PlanInput = {
  state: State
  routes: Routes
  fileKey: string
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
  const { state, routes, fileKey, previewBase, branch, pr, note } = input
  const nodesSeen = new Set<string>()

  return input.threadIds.map((threadId): PlannedReport => {
    const record = state.threads[threadId]
    const frame = record ? frameLabel(state, record.nodeId) : threadId
    const route = record?.nodeId ? (routes[record.nodeId] ?? null) : null
    const previewUrl = joinUrl(previewBase, route)

    const base: PlannedReport = {
      threadId,
      frame,
      nodeId: record?.nodeId ?? null,
      route,
      previewUrl,
      message: buildMessage({ pr, branch, note, previewUrl, issue: record?.issue ?? null }),
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
    const devResources: DevResource[] = []
    if (record.nodeId && !nodesSeen.has(record.nodeId)) {
      nodesSeen.add(record.nodeId)
      devResources.push({ name: 'Preview', url: previewUrl, file_key: fileKey, node_id: record.nodeId })
      if (pr?.url) {
        devResources.push({ name: `PR #${pr.number}`, url: pr.url, file_key: fileKey, node_id: record.nodeId })
      }
      if (record.issue) {
        devResources.push({
          name: `Issue #${record.issue.number}`,
          url: record.issue.url,
          file_key: fileKey,
          node_id: record.nodeId,
        })
      }
    }

    return { ...base, devResources }
  })
}

/**
 * Two independent guards against notifying the designer twice: our own state,
 * and — in case state was lost or reset — the thread's existing replies.
 */
function alreadyReported(record: ThreadRecord, previewUrl: string, pr: PullRequest | null): string | null {
  const prior = record.reported
  if (prior && prior.hash === record.hash && prior.pr === (pr?.number ?? null) && prior.url === previewUrl) {
    return 'already reported — nothing changed since'
  }
  const marker = pr?.url ?? previewUrl
  if (record.replies.some((reply) => reply.message.includes(marker))) {
    return 'a reply already links this PR/preview'
  }
  return null
}

function buildMessage(args: {
  pr: PullRequest | null
  branch: string
  note: string | null
  previewUrl: string
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
  lines.push(`Preview: ${args.previewUrl}`)
  if (args.pr?.url) lines.push(`PR: ${args.pr.url}`)
  if (args.issue) lines.push(`Issue: ${args.issue.url}`)
  lines.push('')
  lines.push('Ready for your review — resolve this comment if it looks right.')

  return lines.join('\n')
}
