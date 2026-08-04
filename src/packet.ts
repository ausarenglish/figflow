import type { Config } from './config.ts'
import type { Routes } from './routes.ts'
import { frameLabel, groupByFrame, isStale, type State, type ThreadRecord } from './state.ts'

/**
 * A work packet is deterministic Markdown, built to be pasted straight into an
 * agent. figflow deliberately makes no model calls of its own — it compiles
 * context, the caller supplies the judgement.
 */
export function renderPacket(
  state: State,
  config: Config,
  routes: Routes,
  entries: [string, ThreadRecord][],
  opts: { heading?: string } = {},
): string {
  const out: string[] = []
  const label = config.fileName ?? config.fileKey

  out.push(`# ${opts.heading ?? `Figma design feedback — ${entries.length} thread${entries.length === 1 ? '' : 's'}`}`)
  out.push('')
  out.push(`File: **${label}** \`${config.fileKey}\``)
  if (state.lastSyncAt) out.push(`Last synced: ${fmtTime(state.lastSyncAt)}`)
  out.push('')
  out.push(
    'Verbatim designer feedback, grouped by the Figma frame each comment is pinned to. ' +
      'Nothing here has been written back to Figma.',
  )
  out.push('')
  out.push('When the work is done and a preview is deployed, close the loop with:')
  out.push('')
  out.push('```sh')
  out.push(`figflow start ${entries.map(([id]) => id).join(' ')}   # before you begin`)
  out.push('figflow report                                # dry run, then --post')
  out.push('```')
  out.push('')

  for (const [frame, group] of groupByFrame(state, entries)) {
    const nodeId = group[0]?.[1].nodeId ?? null
    const route = nodeId ? routes[nodeId] : undefined

    out.push('---')
    out.push('')
    out.push(`## ${frame}${nodeId ? ` \`${nodeId}\`` : ''}`)
    if (route) out.push(`App route: \`${route}\``)
    out.push('')

    for (const [id, record] of group) {
      out.push(`### Thread \`${id}\` — @${record.author} — ${fmtTime(record.createdAt)} — **${record.status}**`)
      out.push('')
      out.push(quote(record.message))
      out.push('')

      if (record.replies.length > 0) {
        out.push('Replies:')
        out.push('')
        for (const reply of record.replies) {
          out.push(`- **@${reply.author}** (${fmtTime(reply.at)}): ${reply.message.replace(/\n/g, ' ')}`)
        }
        out.push('')
      }

      if (record.work) {
        out.push(`Work started ${fmtTime(record.work.startedAt)} on branch \`${record.work.branch}\`.`)
        out.push('')
      }
      if (record.reported) {
        out.push(`Already reported ${fmtTime(record.reported.at)} → ${record.reported.url}`)
        out.push('')
      }
      if (isStale(record)) {
        out.push('> ⚠ **This comment changed after work started — re-read it before acting.**')
        out.push('')
      }

      out.push(`[Open in Figma](${record.url})`)
      out.push('')
    }
  }

  return out.join('\n')
}

export function renderJson(state: State, routes: Routes, entries: [string, ThreadRecord][]): string {
  return JSON.stringify(
    entries.map(([id, record]) => ({
      id,
      frame: frameLabel(state, record.nodeId),
      route: record.nodeId ? (routes[record.nodeId] ?? null) : null,
      stale: isStale(record),
      ...record,
    })),
    null,
    2,
  )
}

function quote(message: string): string {
  return message
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}

export function fmtTime(iso: string): string {
  return iso.replace('T', ' ').replace(/(:\d{2})\..*$/, '$1').replace(/Z$/, '')
}
