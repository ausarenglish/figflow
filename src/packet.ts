import type { Config } from './config.ts'
import { frameLabel, groupByFrame, type State, type ThreadRecord } from './state.ts'

/**
 * A work packet is deterministic Markdown, built to be pasted straight into an
 * agent. figflow deliberately makes no model calls of its own — it compiles
 * context, the caller supplies the intelligence.
 */
export function renderPacket(
  state: State,
  config: Config,
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
    'Each thread below is verbatim designer feedback anchored to a Figma frame. ' +
      'Figma has no API to resolve a comment, so nothing here has been written back — ' +
      'these are read-only.',
  )
  out.push('')

  for (const [frame, group] of groupByFrame(state, entries)) {
    const nodeId = group[0]?.[1].nodeId
    out.push('---')
    out.push('')
    out.push(`## ${frame}${nodeId ? ` \`${nodeId}\`` : ''}`)
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

      out.push(`[Open in Figma](${record.url})`)
      out.push('')
    }
  }

  return out.join('\n')
}

export function renderJson(state: State, entries: [string, ThreadRecord][]): string {
  return JSON.stringify(
    entries.map(([id, record]) => ({ id, frame: frameLabel(state, record.nodeId), ...record })),
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
