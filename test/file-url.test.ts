import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_RETRY_WAIT_SECONDS, humanDuration, toThreads, type FigmaComment } from '../src/adapters/figma/read.ts'
import { backoffFor } from '../src/adapters/figma/write.ts'
import { commentUrl, parseFileKey, parseFileUrl } from '../src/adapters/figma/url.ts'

const KEY = 'Xm9FF9sYw7npqhFOIi41Ue'

test('reads the key and the editor type out of a FigJam board URL', () => {
  const url = `https://www.figma.com/board/${KEY}/Oonee-WebApp-2026---Flow-review?node-id=0-1&t=abc`
  assert.deepEqual(parseFileUrl(url), { fileKey: KEY, fileType: 'board' })
})

test('a design file URL is a design file', () => {
  assert.deepEqual(parseFileUrl(`https://www.figma.com/design/${KEY}/Oonee`), {
    fileKey: KEY,
    fileType: 'design',
  })
})

test('legacy /file/ and /proto/ links resolve to design', () => {
  assert.equal(parseFileUrl(`https://www.figma.com/file/${KEY}/x`).fileType, 'design')
  assert.equal(parseFileUrl(`https://www.figma.com/proto/${KEY}/x`).fileType, 'design')
})

test('a bare key is assumed to be a design file', () => {
  assert.deepEqual(parseFileUrl(KEY), { fileKey: KEY, fileType: 'design' })
})

test('parseFileKey still returns just the key', () => {
  assert.equal(parseFileKey(`https://www.figma.com/board/${KEY}/x`), KEY)
})

test('a garbage input is rejected rather than guessed at', () => {
  assert.throws(() => parseFileUrl('not a figma url'))
})

// The whole point of the reply is that the designer clicks it. A board comment
// linked under /design/ is a link that does not open the file it belongs to.
test('a comment on a board links to /board/, not /design/', () => {
  assert.equal(
    commentUrl(KEY, '99', '1:2', 'board'),
    `https://www.figma.com/board/${KEY}/?node-id=1-2#99`,
  )
})

test('an unanchored comment carries no node-id fragment', () => {
  assert.equal(commentUrl(KEY, '99', null, 'board'), `https://www.figma.com/board/${KEY}/#99`)
})

test('threads built from a board carry board URLs through to state', () => {
  const raw: FigmaComment[] = [
    {
      id: '7',
      file_key: KEY,
      parent_id: '',
      user: { id: 'u1', handle: 'sara' },
      created_at: '2026-08-01T10:00:00Z',
      resolved_at: null,
      message: 'this flow skips the confirm step',
      order_id: '1',
      client_meta: { node_id: '1:2' },
    },
  ]
  const [thread] = toThreads(KEY, raw, 'board')
  assert.ok(thread?.url.includes('/board/'), thread?.url)
})

// --- rate limiting --------------------------------------------------------
//
// Figma's file-content quota returns a Retry-After measured in days once spent
// (371463 seconds observed on a free plan). Sleeping on that is a hang, and
// `sync` would sit silently until killed.

test('a retry-after beyond the cap is described in human terms', () => {
  assert.equal(humanDuration(30), '30s')
  assert.equal(humanDuration(600), '10 minutes')
  assert.equal(humanDuration(7200), '2 hours')
  assert.equal(humanDuration(371463), '4 days')
})

test('the wait cap is short enough to never look like a hang', () => {
  assert.ok(MAX_RETRY_WAIT_SECONDS <= 60)
})

test('a nonsense retry-after does not become a NaN sleep', () => {
  assert.equal(humanDuration(Number.NaN), 'an unknown time')
})

// --- write-side rate limiting ---------------------------------------------
//
// Figma refuses comment writes in bursts — a 13-thread batch died partway
// through with "Rate limit exceeded", leaving seven designers untold. The read
// client always retried; the write client did not.

test('backoff honours Retry-After when Figma supplies one', () => {
  assert.equal(backoffFor(0, 7), 7)
  assert.equal(backoffFor(3, 12), 12)
})

test('backoff escalates when Figma supplies no header', () => {
  const waits = [0, 1, 2, 3, 4].map((a) => backoffFor(a, null))
  assert.deepEqual(waits, [2, 5, 10, 20, 40])
  for (let i = 1; i < waits.length; i++) {
    assert.ok((waits[i] as number) > (waits[i - 1] as number), 'each wait is longer than the last')
  }
})

test('backoff never exceeds the per-attempt cap', () => {
  assert.equal(backoffFor(0, 3600), 60)
})

test('a nonsense or absent Retry-After falls back to the schedule', () => {
  assert.equal(backoffFor(0, Number.NaN), 2)
  assert.equal(backoffFor(0, 0), 2)
  assert.equal(backoffFor(0, -5), 2)
})

test('backoff is defined for attempts beyond the schedule', () => {
  assert.equal(backoffFor(99, null), 40)
})
