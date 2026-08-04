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
