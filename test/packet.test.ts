import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { toThreads } from '../src/adapters/figma/read.ts'
import { renderJson, renderPacket } from '../src/packet.ts'
import { emptyState, reconcile, type State } from '../src/state.ts'
import {
  FIXTURE_ANCHORS,
  FIXTURE_COMMENTS,
  FIXTURE_CONFIG,
  FIXTURE_KEY,
  FIXTURE_NOW,
  FIXTURE_ROUTES,
} from './fixtures.ts'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const SNAPSHOT = join(HERE, '__snapshots__', 'packet.md')

function fixtureState(): State {
  const threads = toThreads(FIXTURE_KEY, FIXTURE_COMMENTS, 'board')
  const seed = emptyState(FIXTURE_KEY)
  seed.nodes = { ...FIXTURE_ANCHORS }
  return reconcile(seed, threads, FIXTURE_NOW).state
}

function entriesOf(state: State) {
  return Object.entries(state.threads).sort(([, a], [, b]) => a.createdAt.localeCompare(b.createdAt))
}

function packet(state: State): string {
  return renderPacket(state, FIXTURE_CONFIG, FIXTURE_ROUTES, entriesOf(state), {
    heading: 'Figma design feedback — 4 open threads',
  })
}

// An agent is handed this text. If it drifts between runs, two agents given
// "the same" packet are not given the same packet.
test('a work packet matches its snapshot exactly', () => {
  assert.equal(packet(fixtureState()), readFileSync(SNAPSHOT, 'utf8').replace(/\n$/, ''))
})

test('rendering the same state twice is byte-identical', () => {
  const state = fixtureState()
  assert.equal(packet(state), packet(state))
})

test('rebuilding state from the same comments produces the same packet', () => {
  assert.equal(packet(fixtureState()), packet(fixtureState()))
})

test('comment order in the API response does not change the packet', () => {
  const forwards = fixtureState()
  const backwards = reconcile(
    Object.assign(emptyState(FIXTURE_KEY), { nodes: { ...FIXTURE_ANCHORS } }),
    toThreads(FIXTURE_KEY, [...FIXTURE_COMMENTS].reverse(), 'board'),
    FIXTURE_NOW,
  ).state
  assert.equal(packet(forwards), packet(backwards))
})

test('the packet carries the designer verbatim, including line breaks', () => {
  const out = packet(fixtureState())
  assert.match(out, /> Add more data to the provider profile:\n> hours, location, phone\./)
})

test('an unanchored comment is grouped last, not dropped', () => {
  const out = packet(fixtureState())
  assert.match(out, /## Unanchored/)
  assert.ok(out.indexOf('## Unanchored') > out.indexOf('## image 6'))
})

test('a board comment links to /board/, not /design/', () => {
  assert.ok(!packet(fixtureState()).includes('figma.com/design/'))
})

test('the JSON packet is deterministic too', () => {
  const state = fixtureState()
  const a = renderJson(state, FIXTURE_ROUTES, entriesOf(state))
  const b = renderJson(state, FIXTURE_ROUTES, entriesOf(state))
  assert.equal(a, b)
  const parsed = JSON.parse(a) as Array<{ id: string; route: string | null; frame: string }>
  assert.equal(parsed.length, 4)
  assert.equal(parsed.find((p) => p.id === '1858203401')?.route, '/bookings')
  assert.equal(parsed.find((p) => p.id === '1858199014')?.frame, 'Unanchored')
})
