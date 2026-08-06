// Live, READ-ONLY checks against the real Oonee review board.
//
// Opt-in: `npm run test:live`. The default suite stays offline and hermetic.
//
// This file imports ONLY the read adapter. It has no access to postReply,
// postReaction or pinResources, so it cannot write to anyone's file even if a
// test here were wrong — the import list is the guarantee.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchComments, fetchNodeNames, toThreads } from '../src/adapters/figma/read.ts'
import { emptyState, reconcile } from '../src/state.ts'

const KEY = 'Xm9FF9sYw7npqhFOIi41Ue'
const TOKEN = process.env.FIGMA_TOKEN ?? process.env.FIGMA_ACCESS_TOKEN ?? ''
const RUN = process.env.FIGFLOW_LIVE === '1' && TOKEN !== ''
const opts = { skip: RUN ? false : 'set FIGFLOW_LIVE=1 and FIGMA_TOKEN to run' }

// Figma rate-limits comment reads hard. Fetch once and share: a test suite that
// hammers the designer's file is a test suite nobody runs twice.
let cached: Awaited<ReturnType<typeof fetchComments>> | null = null
async function comments() {
  if (!cached) cached = await fetchComments(KEY, TOKEN)
  return cached
}
const threadsOnce = async () => toThreads(KEY, await comments(), 'board')

test('the real board reads, and looks like a review file', opts, async () => {
  const raw = await comments()
  assert.ok(raw.length > 20, `expected a populated board, got ${raw.length}`)

  const threads = await threadsOnce()
  assert.ok(threads.length > 20)
  assert.ok(threads.every((t) => t.id && t.author && t.createdAt), 'every thread is fully formed')
  assert.ok(
    threads.some((t) => t.replies.length > 0),
    'the fixture assumption that threads carry replies holds against the real file',
  )
})

test('comment links point at /board/, since this file is FigJam', opts, async () => {
  const threads = await threadsOnce()
  assert.ok(threads.every((t) => t.url.includes('/board/')))
  assert.ok(!threads.some((t) => t.url.includes('/design/')))
})

// fetchNodeNames is best-effort by contract: names make routes.json readable,
// but a run without them must still complete. The file-content quota is small
// and shared, so "resolved nothing" is a legitimate outcome here — hanging or
// throwing is not.
test('anchors resolve to frame names, or degrade without throwing', opts, async () => {
  const threads = await threadsOnce()
  const anchors = threads.map((t) => t.anchorId).filter((id): id is string => id !== null)
  assert.ok(anchors.length > 0, 'the board has anchored comments')

  const names = await fetchNodeNames(KEY, anchors, TOKEN)
  for (const [, info] of names) assert.ok(info.name.length > 0, 'any name returned is non-empty')
  if (names.size === 0) {
    console.log('    note: node-name quota is spent; degradation path exercised instead')
  }
})

// Two syncs of an unchanged file must produce no delta. If this fails, `watch`
// would ping the user on every poll.
test('a second sync of an unchanged file reports nothing', opts, async () => {
  const threads = await threadsOnce()
  const first = reconcile(emptyState(KEY), threads, '2026-08-05T00:00:00Z')
  const second = reconcile(first.state, threads, '2026-08-05T01:00:00Z')

  assert.ok(first.delta.added.length > 20, 'first sync sees everything as new')
  for (const [key, list] of Object.entries(second.delta)) {
    assert.deepEqual(list, [], `second sync should be quiet, but ${key} was not empty`)
  }
})

test('fetching twice yields identical threads — the read is deterministic', opts, async () => {
  const a = await threadsOnce()
  const b = toThreads(KEY, await fetchComments(KEY, TOKEN), 'board')
  assert.deepEqual(
    a.map((t) => ({ id: t.id, hash: t.message, anchor: t.anchorId })),
    b.map((t) => ({ id: t.id, hash: t.message, anchor: t.anchorId })),
  )
})

// The whole point of the tool: nothing above may have changed the file.
test('the board is untouched by this test run', opts, async () => {
  const mine = (await comments()).filter((c) => /figflow/i.test(c.message))
  assert.deepEqual(mine, [], 'no figflow-authored comment should exist yet')
})
