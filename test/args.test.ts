import assert from 'node:assert/strict'
import { test } from 'node:test'
import { has, parseArgs, str } from '../src/args.ts'

test('positionals and boolean flags', () => {
  const a = parseArgs(['1382', '1383', '--post'])
  assert.deepEqual(a.positionals, ['1382', '1383'])
  assert.equal(has(a, '--post'), true)
})

test('a value flag takes the next token', () => {
  assert.equal(str(parseArgs(['--branch', 'feat/x']), '--branch'), 'feat/x')
})

test('--flag=value works too', () => {
  assert.equal(str(parseArgs(['--branch=feat/x']), '--branch'), 'feat/x')
})

// Each of these was a real bug: the flag was missing from the value list, so
// its argument silently became a positional — and positionals are thread ids.
for (const [flag, value] of [
  ['--interval', '30'],
  ['--title', 'Fix the cards'],
  ['--label', 'design'],
  ['--since', 'abc123'],
  ['--base-branch', 'develop'],
  ['--token-expires', '2026-11-03'],
] as const) {
  test(`${flag} consumes its value instead of leaking it into positionals`, () => {
    const a = parseArgs(['1382', flag, value])
    assert.equal(str(a, flag), value)
    assert.deepEqual(a.positionals, ['1382'], 'the value must not be read as a thread id')
  })
}

test('a title with spaces stays one value, not several thread ids', () => {
  const a = parseArgs(['1382', '--title', 'Remove the profile card'])
  assert.equal(str(a, '--title'), 'Remove the profile card')
  assert.deepEqual(a.positionals, ['1382'])
})

// --preview is a value for `report` and a bare switch for `open`.
test('a value flag with nothing after it is a switch', () => {
  const a = parseArgs(['1382', '--preview'])
  assert.equal(has(a, '--preview'), true)
  assert.equal(str(a, '--preview'), null)
  assert.deepEqual(a.positionals, ['1382'])
})

test('a value flag does not swallow the flag that follows it', () => {
  const a = parseArgs(['--preview', '--post'])
  assert.equal(has(a, '--post'), true, '--post must survive')
  assert.equal(str(a, '--preview'), null)
})

test('a value flag followed by another flag keeps both', () => {
  const a = parseArgs(['--note', 'done', '--post'])
  assert.equal(str(a, '--note'), 'done')
  assert.equal(has(a, '--post'), true)
})

// A typo in a deploy hook must fail the job, not quietly change behaviour.
test('an unknown flag is rejected rather than ignored', () => {
  assert.throws(() => parseArgs(['--allow-emty']), /Unknown flag: --allow-emty/)
})

test('the rejection points at help', () => {
  assert.throws(() => parseArgs(['--nope']), /figflow help/)
})

test('every documented flag in the help text parses', () => {
  const known = [
    '--all', '--allow-empty', '--dry-run', '--each', '--force', '--init', '--json',
    '--no-trailers', '--offline', '--once', '--open', '--post', '--skip-check',
  ]
  for (const flag of known) assert.doesNotThrow(() => parseArgs([flag]), flag)
})
