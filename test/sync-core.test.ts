import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Anchor, ReviewSource, ReviewThread } from '../src/adapters/types.ts'
import type { Config } from '../src/config.ts'
import { saveState, emptyState, loadState } from '../src/state.ts'
import { runSync } from '../src/sync-core.ts'

const KEY = 'k'
const CONFIG: Config = { fileKey: KEY }

function thread(id: string, anchorId: string | null): ReviewThread {
  return {
    id,
    author: 'sara',
    createdAt: '2026-08-01T00:00:00Z',
    resolvedAt: null,
    message: `comment ${id}`,
    replies: [],
    anchorId,
    orderId: '1',
    url: `https://figma/${id}`,
  }
}

/** Records exactly which anchors were asked for, so waste is measurable. */
function spySource(threads: ReviewThread[]): { source: ReviewSource; asked: string[][] } {
  const asked: string[][] = []
  return {
    asked,
    source: {
      kind: 'test',
      label: 'test',
      async fetchThreads() {
        return threads
      },
      async fetchAnchors(ids: string[]) {
        asked.push([...ids])
        return new Map<string, Anchor>(ids.map((id) => [id, { name: `frame ${id}`, type: 'FRAME' }]))
      },
    },
  }
}

// Injecting the source keeps this offline; in production runSync resolves it
// from config. The behaviour under test is which anchors it asks for.
function sync(root: string, source: ReviewSource) {
  return runSync(root, CONFIG, 'token', { now: '2026-08-05T00:00:00Z', source })
}

function root(): string {
  return mkdtempSync(join(tmpdir(), 'figflow-sync-'))
}

test('the first sync resolves every anchor it has never seen', async () => {
  const dir = root()
  const { source, asked } = spySource([thread('1', '2:1'), thread('2', '2:2')])
  await sync(dir, source)
  assert.deepEqual(asked, [['2:1', '2:2']])
})

// This is the bug that exhausted Figma's file-content quota: 24 lookups per
// poll, spent almost entirely on names that had not changed.
test('a later sync asks for nothing when every anchor is already named', async () => {
  const dir = root()
  const threads = [thread('1', '2:1'), thread('2', '2:2')]
  const first = spySource(threads)
  await sync(dir, first.source)

  const second = spySource(threads)
  await sync(dir, second.source)
  assert.deepEqual(second.asked, [], 'no anchor lookups at all on an unchanged file')
})

test('only genuinely new anchors are looked up', async () => {
  const dir = root()
  const first = spySource([thread('1', '2:1')])
  await sync(dir, first.source)

  const second = spySource([thread('1', '2:1'), thread('2', '2:2')])
  await sync(dir, second.source)
  assert.deepEqual(second.asked, [['2:2']], 'the already-known anchor is not re-fetched')
})

test('duplicate anchors across threads are asked for once', async () => {
  const dir = root()
  const { source, asked } = spySource([thread('1', '2:1'), thread('2', '2:1'), thread('3', '2:1')])
  await sync(dir, source)
  assert.deepEqual(asked, [['2:1']])
})

test('unanchored comments trigger no lookup', async () => {
  const dir = root()
  const { source, asked } = spySource([thread('1', null)])
  await sync(dir, source)
  assert.deepEqual(asked, [], 'nothing to resolve, so nothing is requested')
})

test('names already in state survive a sync that resolves nothing', async () => {
  const dir = root()
  const seeded = emptyState(KEY)
  seeded.nodes['2:1'] = { name: 'image 3', type: 'RECTANGLE' }
  saveState(dir, seeded)

  const { source, asked } = spySource([thread('1', '2:1')])
  await sync(dir, source)

  assert.deepEqual(asked, [])
  assert.equal(loadState(dir, KEY).nodes['2:1']?.name, 'image 3')
})

// --- anchor lookup backoff ------------------------------------------------
//
// Figma's file-content quota resets in days. A watcher polling every 30s that
// retries a doomed lookup keeps the quota permanently spent — which is exactly
// how it got spent in the first place.

function deadSource(threads: ReviewThread[]): { source: ReviewSource; calls: number[] } {
  const calls: number[] = []
  return {
    calls,
    source: {
      kind: 'test',
      label: 'test',
      async fetchThreads() {
        return threads
      },
      async fetchAnchors(ids: string[]) {
        calls.push(ids.length)
        return new Map<string, Anchor>() // quota spent: degrades to empty
      },
    },
  }
}

test('a failed anchor lookup is not retried on the next poll', async () => {
  const dir = root()
  const threads = [thread('1', '2:1')]
  const { source, calls } = deadSource(threads)

  await runSync(dir, CONFIG, 'tok', { now: '2026-08-05T00:00:00Z', source })
  await runSync(dir, CONFIG, 'tok', { now: '2026-08-05T00:00:30Z', source })
  await runSync(dir, CONFIG, 'tok', { now: '2026-08-05T00:01:00Z', source })

  assert.deepEqual(calls, [1], 'tried once, then stayed quiet')
})

test('it retries once the backoff has elapsed', async () => {
  const dir = root()
  const threads = [thread('1', '2:1')]
  const { source, calls } = deadSource(threads)

  await runSync(dir, CONFIG, 'tok', { now: '2026-08-05T00:00:00Z', source })
  await runSync(dir, CONFIG, 'tok', { now: '2026-08-05T07:00:00Z', source })

  assert.deepEqual(calls, [1, 1], 'seven hours later it is worth another try')
})

test('a successful lookup clears any block', async () => {
  const dir = root()
  const threads = [thread('1', '2:1')]
  const dead = deadSource(threads)
  await runSync(dir, CONFIG, 'tok', { now: '2026-08-05T00:00:00Z', source: dead.source })

  const alive = spySource([...threads, thread('2', '2:2')])
  await runSync(dir, CONFIG, 'tok', { now: '2026-08-05T07:00:00Z', source: alive.source })
  const after = loadState(dir, KEY)
  assert.equal(after.anchorsBlockedUntil, undefined, 'no lingering block once it works')
  assert.equal(after.nodes['2:1']?.name, 'frame 2:1')
})

test('polling never stops just because names cannot be resolved', async () => {
  const dir = root()
  const { source } = deadSource([thread('1', '2:1')])
  const result = await runSync(dir, CONFIG, 'tok', { now: '2026-08-05T00:00:00Z', source })
  assert.equal(result.delta.added.length, 1, 'the comment is still detected')
})
