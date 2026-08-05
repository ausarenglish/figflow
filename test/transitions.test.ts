import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toThreads, type FigmaComment } from '../src/adapters/figma/read.ts'
import { emptyState, reconcile, type Delta, type State } from '../src/state.ts'
import { FIXTURE_ANCHORS, FIXTURE_COMMENTS, FIXTURE_KEY } from './fixtures.ts'

/**
 * The full life of a review file, folded one sync at a time. Each step records
 * the delta the CLI would have printed, so the whole sequence can be asserted
 * as one shape — that is what makes an unintended extra notification visible.
 */
function replay(steps: FigmaComment[][]): { deltas: Delta[]; final: State } {
  let state: State = Object.assign(emptyState(FIXTURE_KEY), { nodes: { ...FIXTURE_ANCHORS } })
  const deltas: Delta[] = []
  steps.forEach((comments, i) => {
    const result = reconcile(state, toThreads(FIXTURE_KEY, comments, 'board'), `2026-08-0${i + 1}T00:00:00Z`)
    state = result.state
    deltas.push(result.delta)
  })
  return { deltas, final: state }
}

const shape = (d: Delta) =>
  Object.fromEntries(Object.entries(d).filter(([, v]) => v.length > 0)) as Record<string, string[]>

const BASE = FIXTURE_COMMENTS.filter((c) => c.id === '1858203401')
const edited = (over: Partial<FigmaComment>) => [{ ...(BASE[0] as FigmaComment), ...over }]

test('a comment appearing, changing, being replied to, resolved, then deleted', () => {
  const { deltas } = replay([
    [], // empty file
    BASE, // the designer comments
    BASE, // nothing happens
    edited({ message: 'Add an option to cancel a booking, with a confirm.' }),
    [
      ...edited({ message: 'Add an option to cancel a booking, with a confirm.' }),
      {
        ...(BASE[0] as FigmaComment),
        id: '9100',
        parent_id: '1858203401',
        message: 'and tell them refunds are handled by the shop',
      },
    ],
    [
      ...edited({
        message: 'Add an option to cancel a booking, with a confirm.',
        resolved_at: '2026-08-06T00:00:00Z',
      }),
      {
        ...(BASE[0] as FigmaComment),
        id: '9100',
        parent_id: '1858203401',
        message: 'and tell them refunds are handled by the shop',
      },
    ],
    [], // deleted from the file
  ])

  assert.deepEqual(deltas.map(shape), [
    {},
    { added: ['1858203401'] },
    {},
    { edited: ['1858203401'] },
    { edited: ['1858203401'] },
    { resolved: ['1858203401'] },
    { gone: ['1858203401'] },
  ])
})

test('resolving is reported once, not on every subsequent sync', () => {
  const resolved = edited({ resolved_at: '2026-08-06T00:00:00Z' })
  const { deltas } = replay([BASE, resolved, resolved, resolved])
  assert.deepEqual(deltas.map(shape), [{ added: ['1858203401'] }, { resolved: ['1858203401'] }, {}, {}])
})

test('a deleted comment is reported once and then stays gone', () => {
  const { deltas, final } = replay([BASE, [], [], BASE])
  assert.deepEqual(deltas.map(shape), [
    { added: ['1858203401'] },
    { gone: ['1858203401'] },
    {},
    // A comment that comes back produces NO delta: the record already exists
    // and its hash is unchanged, so nothing looks new. The status quietly
    // returns to open and it reappears in `figflow status`, but no ping fires.
    // Figma has no undelete, so in practice this only happens if a sync saw a
    // partial comment list — worth knowing, not worth a notification.
    {},
  ])
  assert.equal(final.threads['1858203401']?.status, 'open')
})

test('unresolving reopens, and is reported once', () => {
  const { deltas } = replay([BASE, edited({ resolved_at: '2026-08-06T00:00:00Z' }), BASE, BASE])
  assert.deepEqual(deltas.map(shape), [
    { added: ['1858203401'] },
    { resolved: ['1858203401'] },
    { reopened: ['1858203401'] },
    {},
  ])
})

// The dangerous case: the ask changes while someone is mid-implementation.
test('an edit after work started is flagged as stale work, not merely edited', () => {
  let state: State = Object.assign(emptyState(FIXTURE_KEY), { nodes: { ...FIXTURE_ANCHORS } })
  state = reconcile(state, toThreads(FIXTURE_KEY, BASE, 'board'), '2026-08-01T00:00:00Z').state

  const record = state.threads['1858203401']
  assert.ok(record)
  state.threads['1858203401'] = {
    ...record,
    work: { branch: 'feat/cancel', startedAt: '2026-08-02T00:00:00Z', hashAtStart: record.hash },
  }

  const { delta } = reconcile(
    state,
    toThreads(FIXTURE_KEY, edited({ message: 'actually, make it archive not cancel' }), 'board'),
    '2026-08-03T00:00:00Z',
  )
  assert.deepEqual(shape(delta), {
    edited: ['1858203401'],
    staleWork: ['1858203401'],
  })
})

test('the whole fixture file folds to a stable set of statuses', () => {
  const { final } = replay([FIXTURE_COMMENTS])
  assert.deepEqual(
    Object.fromEntries(Object.entries(final.threads).map(([id, t]) => [id, t.status])),
    {
      '1858203401': 'open',
      '1858203148': 'open',
      '1858204600': 'open',
      '1858199014': 'open',
    },
  )
  assert.equal(Object.keys(final.threads).length, 4, 'replies are folded in, not counted as threads')
})
