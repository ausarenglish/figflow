/**
 * Which editor a Figma file opens in. It is part of the URL path, so getting it
 * wrong sends the designer to a link that does not resolve — and every comment
 * link we build is one the designer is meant to click.
 */
export type FileType = 'design' | 'board' | 'slides'

const URL_SEGMENT: Record<string, FileType> = {
  design: 'design',
  file: 'design', // legacy, redirects to /design/
  proto: 'design',
  board: 'board', // FigJam
  slides: 'slides',
}

/** Parse a Figma file key and editor type out of a URL, or take a bare key. */
export function parseFileUrl(input: string): { fileKey: string; fileType: FileType } {
  const m = input.match(/figma\.com\/(file|design|proto|board|slides)\/([A-Za-z0-9]+)/)
  if (m?.[2]) return { fileKey: m[2], fileType: URL_SEGMENT[m[1] as string] ?? 'design' }
  if (/^[A-Za-z0-9]{10,}$/.test(input.trim())) return { fileKey: input.trim(), fileType: 'design' }
  throw new Error(`Could not read a Figma file key from: ${input}`)
}

/** Back-compat shim for callers that only want the key. */
export function parseFileKey(input: string): string {
  return parseFileUrl(input).fileKey
}

export function commentUrl(
  fileKey: string,
  commentId: string,
  nodeId: string | null,
  fileType: FileType = 'design',
): string {
  const base = `https://www.figma.com/${fileType}/${fileKey}/`
  const node = nodeId ? `?node-id=${nodeId.replace(/:/g, '-')}` : ''
  return `${base}${node}#${commentId}`
}
