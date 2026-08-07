import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classify } from '../src/preview.ts'

test('a live preview passes', () => {
  assert.equal(classify(200).ok, true)
  assert.equal(classify(304).ok, true)
})

test('a 404 blocks — the branch has not deployed yet', () => {
  const check = classify(404)
  assert.equal(check.ok, false)
  assert.match(check.reason, /deployed yet/)
})

test('deployment protection passes — the deploy exists, we just cannot see it', () => {
  assert.equal(classify(401).ok, true)
  assert.equal(classify(403).ok, true)
})

test('a broken deploy blocks', () => {
  assert.equal(classify(500).ok, false)
  assert.equal(classify(502).ok, false)
})

// --- login walls ----------------------------------------------------------
//
// The bug this exists for: every reviewable screen in the first real project
// sat behind /login. The pages answered 200 OK, the gate passed, and thirteen
// designers were sent to a sign-in form and told their work was ready.

test('a redirect to a sign-in page blocks the post', () => {
  const c = classify(200, '/register-bike', '/login')
  assert.equal(c.ok, false)
  assert.match(c.reason, /sign-in form/)
  assert.equal(c.redirectedTo, '/login')
})

test('every common sign-in path shape is recognised', () => {
  for (const p of ['/login', '/signin', '/sign-in', '/auth', '/signup', '/session', '/users/sign_in', '/account/login']) {
    assert.equal(classify(200, '/bookings', p).ok, false, p)
  }
})

test('a sign-in path with a subpath or query still counts', () => {
  assert.equal(classify(200, '/bookings', '/login/email').ok, false)
})

test('landing where we aimed passes', () => {
  const c = classify(200, '/register-bike', '/register-bike')
  assert.equal(c.ok, true)
  assert.equal(c.reason, 'up')
})

test('a trailing slash or different case is the same screen', () => {
  assert.equal(classify(200, '/places', '/places/').ok, true)
  assert.equal(classify(200, '/Places', '/places').ok, true)
})

// Not every redirect is a wall — flag it without blocking.
test('a non-auth redirect passes but says where it landed', () => {
  const c = classify(200, '/', '/home')
  assert.equal(c.ok, true)
  assert.match(c.reason, /redirects to \/home/)
  assert.equal(c.redirectedTo, '/home')
})

test('a path that merely contains "login" deeper down is not a wall', () => {
  assert.equal(classify(200, '/help', '/help/how-to-login').ok, true)
})

test('deployment protection still passes, and is not confused with a login wall', () => {
  assert.equal(classify(401, '/bookings', '/bookings').ok, true)
  assert.equal(classify(403, '/bookings', '/login').ok, true)
})

test('classify still works when paths are unknown', () => {
  assert.equal(classify(200).ok, true)
  assert.equal(classify(404).ok, false)
})
