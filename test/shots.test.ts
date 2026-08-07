import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildMessage } from '../src/report-plan.ts'
import { isStaleShot, loadShots, shotFor } from '../src/shots.ts'

function project(shots?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'figflow-shots-'))
  mkdirSync(join(dir, '.figflow'), { recursive: true })
  if (shots !== undefined) {
    writeFileSync(join(dir, '.figflow', 'shots.json'), JSON.stringify(shots))
  }
  return dir
}

test('no shots file is not an error', () => {
  assert.deepEqual(loadShots(project()), {})
})

test('routes map to image urls', () => {
  const shots = loadShots(project({ '/bookings': 'https://x/bookings.png' }))
  assert.equal(shots['/bookings']?.url, 'https://x/bookings.png')
})

test('blank entries and comment keys are ignored, like routes.json', () => {
  const shots = loadShots(project({ '// note': 'ignored', '/a': '', '/b': '   ', '/c': 'https://x/c.png' }))
  assert.deepEqual(Object.keys(shots), ['/c'])
})

test('a trailing slash does not hide a screenshot', () => {
  const shots = loadShots(project({ '/places/': 'https://x/places.png' }))
  assert.equal(shotFor(shots, '/places')?.url, 'https://x/places.png')
  assert.equal(shotFor(shots, '/places/')?.url, 'https://x/places.png')
})

test('an unanchored thread falls back to the root screenshot', () => {
  assert.equal(shotFor({ '/': { url: 'https://x/home.png' } }, null)?.url, 'https://x/home.png')
})

test('a route with no screenshot returns null rather than guessing', () => {
  assert.equal(shotFor({ '/a': { url: 'https://x/a.png' } }, '/b'), null)
})

// --- freshness ------------------------------------------------------------
//
// A screenshot taken before the work it claims to show is a picture of the old
// screen presented as proof of the new one — the same lie as a dead link, in a
// form that looks more convincing.

test('a screenshot older than the work is stale', () => {
  const shot = { url: 'https://x/a.png', capturedAt: '2026-08-01T00:00:00Z' }
  assert.equal(isStaleShot(shot, '2026-08-06T00:00:00Z'), true)
})

test('a screenshot taken after the work is fresh', () => {
  const shot = { url: 'https://x/a.png', capturedAt: '2026-08-07T00:00:00Z' }
  assert.equal(isStaleShot(shot, '2026-08-06T00:00:00Z'), false)
})

test('an undated screenshot is treated as stale, not trusted', () => {
  assert.equal(isStaleShot({ url: 'https://x/a.png' }, '2026-08-06T00:00:00Z'), true)
})

test('a plain string entry still loads, and counts as undated', () => {
  const shots = loadShots(project({ '/a': 'https://x/a.png' }))
  assert.equal(shots['/a']?.url, 'https://x/a.png')
  assert.equal(isStaleShot(shots['/a'] ?? null, '2026-08-06T00:00:00Z'), true)
})

test('a dated entry round-trips through the file', () => {
  const shots = loadShots(project({ '/a': { url: 'https://x/a.png', capturedAt: '2026-08-07T10:00:00Z' } }))
  assert.equal(shots['/a']?.capturedAt, '2026-08-07T10:00:00Z')
  assert.equal(isStaleShot(shots['/a'] ?? null, '2026-08-06T00:00:00Z'), false)
})

test('no screenshot at all is not stale — there is nothing to be stale', () => {
  assert.equal(isStaleShot(null, '2026-08-06T00:00:00Z'), false)
})

test('an unknown commit time cannot prove staleness', () => {
  assert.equal(isStaleShot({ url: 'https://x/a.png', capturedAt: '2026-08-01T00:00:00Z' }, null), false)
})

test('a malformed date is stale rather than silently trusted', () => {
  assert.equal(isStaleShot({ url: 'https://x/a.png', capturedAt: 'yesterday' }, '2026-08-06T00:00:00Z'), true)
})

test('malformed JSON says which file and what shape is expected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'figflow-shots-'))
  mkdirSync(join(dir, '.figflow'), { recursive: true })
  writeFileSync(join(dir, '.figflow', 'shots.json'), '{ nope')
  assert.throws(() => loadShots(dir), /not valid JSON/)
})

// --- what the designer reads ---------------------------------------------

const BASE = { pr: null, branch: 'main', note: null, previewUrl: 'https://app/bookings', issue: null }

test('with no screenshot the reply is unchanged', () => {
  const msg = buildMessage(BASE)
  assert.match(msg, /^✅ Addressed on branch main/)
  assert.match(msg, /Preview: https:\/\/app\/bookings/)
  assert.ok(!msg.includes('Screenshot'))
})

// The screenshot leads, because it is the thing a reviewer without an account
// can actually open.
test('a gated preview is labelled, and the screenshot comes first', () => {
  const msg = buildMessage({ ...BASE, shotUrl: 'https://x/bookings.png', previewGated: true })
  assert.match(msg, /Screenshot: https:\/\/x\/bookings\.png/)
  assert.match(msg, /Preview \(needs a sign-in\): https:\/\/app\/bookings/)
  assert.ok(
    msg.indexOf('Screenshot:') < msg.indexOf('Preview'),
    'the openable thing is listed before the one that needs an account',
  )
})

test('an ungated preview with a screenshot still reads as a normal preview', () => {
  const msg = buildMessage({ ...BASE, shotUrl: 'https://x/bookings.png', previewGated: false })
  assert.match(msg, /Screenshot: https:\/\/x\/bookings\.png/)
  assert.match(msg, /Preview: https:\/\/app\/bookings/)
  assert.ok(!msg.includes('needs a sign-in'))
})
