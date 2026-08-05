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

test('the real board reads, and looks like a review file', opts, async () => {
  const comments = await fetchComments(KEY, TOKEN)
  assert.ok(comments.length > 20, `expected a populated board, got ${comments.length}`)

  const threads = toThreads(KEY, comments, 'board')
  assert.ok(threads.length > 20)
  assert.ok(threads.every((t) => t.id && t.author && t.createdAt), 'every thread is fully formed')
  assert.ok(
    threads.some((t) => t.replies.length > 0),
    'the fixture assumption that threads carry replies holds against the real file',
  )
})

test('comment links point at /board/, since this file is FigJam', opts, async () => {
  const threads = toThreads(KEY, await fetchComments(KEY, TOKEN), 'board')
  assert.ok(threads.every((t) => t.url.includes('/board/')))
  assert.ok(!threads.some((t) => t.url.includes('/design/')))
})

test('anchors resolve to frame names on a FigJam board', opts, async () => {
  const threads = toThreads(KEY, await fetchComments(KEY, TOKEN), 'board')
  const anchors = threads.map((t) => t.anchorId).filter((id): id is string => id !== null)
  assert.ok(anchors.length > 0)

  const names = await fetchNodeNames(KEY, anchors, TOKEN)
  assert.ok(names.size > 0, 'FigJam nodes resolve — this is what makes routes.json possible')
  for (const [, info] of names) assert.ok(info.name.length > 0)
})

// Two syncs of an unchanged file must produce no delta. If this fails, `watch`
// would ping the user on every poll.
test('a second sync of an unchanged file reports nothing', opts, async () => {
  const threads = toThreads(KEY, await fetchComments(KEY, TOKEN), 'board')
  const first = reconcile(emptyState(KEY), threads, '2026-08-05T00:00:00Z')
  const second = reconcile(first.state, threads, '2026-08-05T01:00:00Z')

  assert.ok(first.delta.added.length > 20, 'first sync sees everything as new')
  for (const [key, list] of Object.entries(second.delta)) {
    assert.deepEqual(list, [], `second sync should be quiet, but ${key} was not empty`)
  }
})

test('fetching twice yields identical threads — the read is deterministic', opts, async () => {
  const a = toThreads(KEY, await fetchComments(KEY, TOKEN), 'board')
  const b = toThreads(KEY, await fetchComments(KEY, TOKEN), 'board')
  assert.deepEqual(
    a.map((t) => ({ id: t.id, hash: t.message, anchor: t.anchorId })),
    b.map((t) => ({ id: t.id, hash: t.message, anchor: t.anchorId })),
  )
})

// The whole point of the tool: nothing above may have changed the file.
test('the board is untouched by this test run', opts, async () => {
  const comments = await fetchComments(KEY, TOKEN)
  const mine = comments.filter((c) => /figflow/i.test(c.message))
  assert.deepEqual(mine, [], 'no figflow-authored comment should exist yet')
})
