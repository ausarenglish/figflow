import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Config } from '../src/config.ts'
import {
  EXPIRY_WARN_DAYS,
  checkPreviewTemplate,
  checkRoutes,
  checkStateAgreesWithConfig,
  checkTokenExpiry,
  checkTracked,
  daysUntil,
  exitCode,
  fail,
  ok,
  warn,
} from '../src/doctor.ts'
import { emptyState, type State, type ThreadRecord } from '../src/state.ts'

const NOW = new Date('2026-08-05T12:00:00Z')
const base: Config = { fileKey: 'k' }

function stateWith(threads: Record<string, Partial<ThreadRecord>>): State {
  const s = emptyState('k')
  for (const [id, over] of Object.entries(threads)) {
    s.threads[id] = {
      status: 'open',
      hash: 'h',
      nodeId: '1:1',
      author: 'sara',
      createdAt: NOW.toISOString(),
      resolvedAt: null,
      firstSeenAt: NOW.toISOString(),
      lastSeenAt: NOW.toISOString(),
      message: 'm',
      replies: [],
      url: 'u',
      ...over,
    }
  }
  return s
}

// --- token expiry ---------------------------------------------------------

test('a token expiring soon warns, with the CI secret called out', () => {
  const c = checkTokenExpiry({ ...base, tokenExpiresAt: '2026-08-20' }, NOW)
  assert.equal(c.level, 'warn')
  assert.match(c.fix ?? '', /CI secret/)
})

test('a token with plenty of life left passes', () => {
  assert.equal(checkTokenExpiry({ ...base, tokenExpiresAt: '2026-11-03' }, NOW).level, 'ok')
})

test('an already-expired token fails — this is what stops the loop silently', () => {
  const c = checkTokenExpiry({ ...base, tokenExpiresAt: '2026-07-01' }, NOW)
  assert.equal(c.level, 'fail')
  assert.match(c.detail, /expired 35 days ago/)
})

test('the boundary of the warning window is inclusive', () => {
  const boundary = new Date(NOW.getTime() + EXPIRY_WARN_DAYS * 86_400_000).toISOString().slice(0, 10)
  assert.equal(checkTokenExpiry({ ...base, tokenExpiresAt: boundary }, NOW).level, 'warn')
})

test('no recorded expiry warns rather than passing quietly', () => {
  assert.equal(checkTokenExpiry(base, NOW).level, 'warn')
})

test('a malformed expiry date fails loudly', () => {
  assert.equal(checkTokenExpiry({ ...base, tokenExpiresAt: 'soon' }, NOW).level, 'fail')
})

test('daysUntil rejects nonsense', () => {
  assert.equal(daysUntil('not-a-date', NOW), null)
})

// --- preview template -----------------------------------------------------

test('a missing preview url fails — report cannot run without one', () => {
  assert.equal(checkPreviewTemplate(base).level, 'fail')
})

test('a relative preview url fails', () => {
  assert.equal(checkPreviewTemplate({ ...base, preview: { baseUrl: '/app' } }).level, 'fail')
})

test('a preview url with no {branch} warns but does not fail', () => {
  const c = checkPreviewTemplate({ ...base, preview: { baseUrl: 'https://app.vercel.app' } })
  assert.equal(c.level, 'warn')
})

test('a well-formed preview template passes', () => {
  const c = checkPreviewTemplate({
    ...base,
    preview: { baseUrl: 'https://oonee-mvp-git-{branch}-oonee.vercel.app' },
  })
  assert.equal(c.level, 'ok')
})

// --- state ----------------------------------------------------------------

test('state for a different file fails — the commonest way to report to the wrong place', () => {
  const s = emptyState('other-key')
  const c = checkStateAgreesWithConfig(base, s)
  assert.equal(c.level, 'fail')
  assert.match(c.detail, /other-key/)
})

test('empty state warns and points at sync', () => {
  const c = checkStateAgreesWithConfig(base, emptyState('k'))
  assert.equal(c.level, 'warn')
  assert.match(c.fix ?? '', /sync/)
})

test('populated state summarises by status', () => {
  const c = checkStateAgreesWithConfig(base, stateWith({ a: {}, b: { status: 'reported' } }))
  assert.equal(c.level, 'ok')
  assert.match(c.detail, /1 open/)
  assert.match(c.detail, /1 reported/)
})

// --- routes ---------------------------------------------------------------

test('no frames mapped warns', () => {
  assert.equal(checkRoutes(stateWith({ a: {} }), {}).level, 'warn')
})

test('partially mapped passes, and says the rest fall back', () => {
  const s = stateWith({ a: { nodeId: '1:1' }, b: { nodeId: '2:2' } })
  const c = checkRoutes(s, { '1:1': '/x' })
  assert.equal(c.level, 'ok')
  assert.match(c.detail, /1\/2/)
})

test('deleted threads do not count against the mapping', () => {
  const s = stateWith({ a: { nodeId: '1:1' }, b: { nodeId: '2:2', status: 'gone' } })
  assert.match(checkRoutes(s, { '1:1': '/x' }).detail, /1\/1/)
})

// --- git tracking ---------------------------------------------------------

// The failure this catches is invisible: CI checks out the repo, finds no
// config, reports nothing, and the workflow still goes green.
test('untracked .figflow warns, because CI would silently do nothing', () => {
  const c = checkTracked(['.figflow/routes.json'])
  assert.equal(c.level, 'warn')
  assert.match(c.detail, /config\.json, state\.json/)
})

test('tracked .figflow passes', () => {
  assert.equal(checkTracked(['.figflow/config.json', '.figflow/state.json']).level, 'ok')
})

// --- aggregation ----------------------------------------------------------

test('any failure means a non-zero exit, warnings alone do not', () => {
  assert.equal(exitCode([ok('a', ''), warn('b', '')]), 0)
  assert.equal(exitCode([ok('a', ''), fail('b', '')]), 1)
})
