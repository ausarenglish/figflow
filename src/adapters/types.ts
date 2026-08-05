// The boundary between figflow's core and whatever system the review lives in.
//
// Everything above this line — state, planning, packets, routes, preview
// checks — is written against these types and knows nothing about Figma.
// Figma is simply the first implementation.
//
// Adapters are plain objects, resolved by a switch. There is no plugin loader,
// no dynamic import, no registry file to keep in sync: adding a source means
// writing one module and adding one case.

export type ReviewReply = {
  id: string
  author: string
  at: string
  message: string
}

/** One comment thread, as any review source would describe it. */
export type ReviewThread = {
  id: string
  author: string
  createdAt: string
  /** Set by the reviewer, never by us — resolution is always their call. */
  resolvedAt: string | null
  message: string
  replies: ReviewReply[]
  /**
   * What the comment is pinned to: a Figma node, a file path, a page. Null when
   * the comment floats free of any anchor.
   */
  anchorId: string | null
  orderId: string | null
  /** Deep link back to the thread in the source system. */
  url: string
}

/** A human-readable name for an anchor — a frame name, a filename. */
export type Anchor = { name: string; type: string }

/** A link the source can display alongside the anchor (Figma dev resources). */
export type PinnedResource = { name: string; url: string; anchorId: string }

/** Read side. Must never mutate the source. */
export type ReviewSource = {
  readonly kind: string
  /** Human label for the thing being reviewed, for CLI output. */
  readonly label: string
  fetchThreads(): Promise<ReviewThread[]>
  /** Best-effort: unresolvable anchors are simply absent from the map. */
  fetchAnchors(anchorIds: string[]): Promise<Map<string, Anchor>>
}

/**
 * Write side, deliberately a separate type from ReviewSource so that "can this
 * code path reach the designer?" is answerable by looking at which one a module
 * imports.
 */
export type ReviewWriter = {
  readonly kind: string
  postReply(threadId: string, message: string): Promise<void>
  /** Best-effort acknowledgement; a rejected reaction must not fail a run. */
  postReaction(threadId: string): Promise<void>
  /** Returns per-resource errors rather than throwing, so a re-run is harmless. */
  pinResources(resources: PinnedResource[]): Promise<{ errors: { error: string }[] }>
}

export type SourceKind = 'figma'

export const SOURCE_KINDS: SourceKind[] = ['figma']
