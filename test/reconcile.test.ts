import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toThreads, type FigmaComment } from '../src/figma.ts'
import { emptyState, reconcile, type State } from '../src/state.ts'

const KEY = 'abc123'
const T1 = '2026-08-01T10:00:00Z'
const T2 = '2026-08-02T10:00:00Z'

function comment(over: Partial<FigmaComment> & { id: string }): FigmaComment {
  return {
    file_key: KEY,
    parent_id: '',
    user: { id: 'u1', handle: 'sara' },
    created_at: T1,
    resolved_at: null,
    message: 'padding feels tight',
    order_id: '1',
    client_meta: { node_id: '1:234', node_offset: { x: 0, y: 0 } },
    ...over,
  }
}

function sync(state: State, comments: FigmaComment[], now: string) {
  return reconcile(state, toThreads(KEY, comments), now)
}

test('groups replies under their root thread', () => {
  const threads = toThreads(KEY, [
    comment({ id: '1' }),
    comment({ id: '2', parent_id: '1', message: 'agree', user: { id: 'u2', handle: 'marco' } }),
    comment({ id: '3', parent_id: '1', message: 'and the icon', created_at: T2 }),
  ])

  assert.equal(threads.length, 1)
  assert.equal(threads[0]?.replies.length, 2)
  assert.equal(threads[0]?.replies[0]?.author, 'marco')
  assert.equal(threads[0]?.nodeId, '1:234')
})

test('a pin on bare canvas has no node anchor', () => {
  const threads = toThreads(KEY, [comment({ id: '1', client_meta: { x: 10, y: 20 } })])
  assert.equal(threads[0]?.nodeId, null)
})

test('first sync reports every thread as new', () => {
  const { state, delta } = sync(emptyState(KEY), [comment({ id: '1' }), comment({ id: '2' })], T1)
  assert.deepEqual(delta.added, ['1', '2'])
  assert.equal(state.threads['1']?.status, 'open')
  assert.equal(state.threads['1']?.firstSeenAt, T1)
})

test('an unchanged re-sync reports nothing', () => {
  const first = sync(emptyState(KEY), [comment({ id: '1' })], T1)
  const second = sync(first.state, [comment({ id: '1' })], T2)

  assert.deepEqual(second.delta, { added: [], resolved: [], reopened: [], edited: [], gone: [], staleWork: [] })
  assert.equal(second.state.threads['1']?.firstSeenAt, T1, 'firstSeenAt is preserved')
  assert.equal(second.state.threads['1']?.lastSeenAt, T2)
})

test('resolving in Figma flips status once, not on every sync', () => {
  const first = sync(emptyState(KEY), [comment({ id: '1' })], T1)
  const second = sync(first.state, [comment({ id: '1', resolved_at: T2 })], T2)
  assert.deepEqual(second.delta.resolved, ['1'])
  assert.equal(second.state.threads['1']?.status, 'resolved')

  const third = sync(second.state, [comment({ id: '1', resolved_at: T2 })], T2)
  assert.deepEqual(third.delta.resolved, [], 'already-resolved threads are not re-reported')
})

test('unresolving in Figma reopens the thread', () => {
  const a = sync(emptyState(KEY), [comment({ id: '1', resolved_at: T1 })], T1)
  const b = sync(a.state, [comment({ id: '1', resolved_at: null })], T2)
  assert.deepEqual(b.delta.reopened, ['1'])
  assert.equal(b.state.threads['1']?.status, 'open')
})

test('editing a comment marks it edited so stale work is detectable', () => {
  const a = sync(emptyState(KEY), [comment({ id: '1' })], T1)
  const b = sync(a.state, [comment({ id: '1', message: 'actually make it 20px' })], T2)
  assert.deepEqual(b.delta.edited, ['1'])
  assert.notEqual(a.state.threads['1']?.hash, b.state.threads['1']?.hash)
})

test('a new reply counts as an edit to the thread', () => {
  const a = sync(emptyState(KEY), [comment({ id: '1' })], T1)
  const b = sync(a.state, [comment({ id: '1' }), comment({ id: '2', parent_id: '1', message: 'bump' })], T2)
  assert.deepEqual(b.delta.edited, ['1'])
})

test('a deleted comment becomes gone and is reported once, never dropped', () => {
  const a = sync(emptyState(KEY), [comment({ id: '1' }), comment({ id: '2' })], T1)
  const b = sync(a.state, [comment({ id: '1' })], T2)

  assert.deepEqual(b.delta.gone, ['2'])
  assert.equal(b.state.threads['2']?.status, 'gone')
  assert.equal(b.state.threads['2']?.message, 'padding feels tight', 'history is retained')

  const c = sync(b.state, [comment({ id: '1' })], T2)
  assert.deepEqual(c.delta.gone, [], 'gone threads are not re-reported')
})
