import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseTrailers, resolveRange, threadsFromTrailers } from '../src/trailers.ts'

// --- parsing (pure) -------------------------------------------------------

test('reads a trailer off its own line', () => {
  assert.deepEqual(parseTrailers('body text\n\nFigma: 1858203401'), ['1858203401'])
})

test('accepts Review: and Figflow: so the convention is not Figma-specific', () => {
  assert.deepEqual(parseTrailers('Review: 12'), ['12'])
  assert.deepEqual(parseTrailers('Figflow: 12'), ['12'])
})

test('is case-insensitive on the key', () => {
  assert.deepEqual(parseTrailers('figma: 7'), ['7'])
  assert.deepEqual(parseTrailers('FIGMA: 7'), ['7'])
})

test('takes several ids from one trailer, comma or space separated', () => {
  assert.deepEqual(parseTrailers('Figma: 1, 2 3'), ['1', '2', '3'])
})

test('takes several trailers from one message, de-duplicated', () => {
  assert.deepEqual(parseTrailers('Figma: 1\nFigma: 2\nFigma: 1'), ['1', '2'])
})

// The distinction that matters: a commit that *mentions* a thread is not a
// commit that *claims* it. Only a whole-line trailer is a claim.
test('ignores a thread id mentioned mid-sentence', () => {
  assert.deepEqual(parseTrailers('this relates to Figma: 123 somehow but is not a claim'), [])
})

test('ignores unrelated trailers', () => {
  assert.deepEqual(parseTrailers('Signed-off-by: A\nCo-Authored-By: B <b@c>'), [])
})

test('ignores non-numeric values', () => {
  assert.deepEqual(parseTrailers('Figma: https://figma.com/board/x'), [])
})

test('an empty message yields nothing', () => {
  assert.deepEqual(parseTrailers(''), [])
})

// --- git integration ------------------------------------------------------

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'figflow-tr-'))
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'ignore', 'ignore'] })
  git('init', '-b', 'main')
  git('config', 'user.email', 't@t.t')
  git('config', 'user.name', 'T')
  return dir
}

function commit(dir: string, message: string, file = 'f.txt'): void {
  writeFileSync(join(dir, file), Math.random().toString(36))
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: ['ignore', 'ignore', 'ignore'] })
  execFileSync('git', ['commit', '-m', message], { cwd: dir, stdio: ['ignore', 'ignore', 'ignore'] })
}

test('collects trailers from commits on a branch, not from the base', () => {
  const dir = repo()
  commit(dir, 'base work\n\nFigma: 111')
  execFileSync('git', ['checkout', '-b', 'feat/x'], { cwd: dir, stdio: ['ignore', 'ignore', 'ignore'] })
  commit(dir, 'feat: a thing\n\nFigma: 222')
  commit(dir, 'feat: another\n\nFigma: 333')

  const found = threadsFromTrailers(dir, 'main').map((r) => r.threadId)
  assert.deepEqual(found.sort(), ['222', '333'], 'the base commit’s trailer is out of range')
})

test('carries the commit that claimed each thread, for auditability', () => {
  const dir = repo()
  commit(dir, 'base')
  execFileSync('git', ['checkout', '-b', 'feat/y'], { cwd: dir, stdio: ['ignore', 'ignore', 'ignore'] })
  commit(dir, 'fix(bookings): let a rider cancel\n\nFigma: 1858203401')

  const [ref] = threadsFromTrailers(dir, 'main')
  assert.equal(ref?.threadId, '1858203401')
  assert.equal(ref?.subject, 'fix(bookings): let a rider cancel')
  assert.match(ref?.sha ?? '', /^[0-9a-f]{8}$/)
})

// A subject containing the field separator would corrupt naive parsing.
test('survives subjects with punctuation, quotes and colons', () => {
  const dir = repo()
  commit(dir, 'base')
  execFileSync('git', ['checkout', '-b', 'feat/z'], { cwd: dir, stdio: ['ignore', 'ignore', 'ignore'] })
  commit(dir, 'fix: "quoted", colon: yes — dash\n\nFigma: 42')

  const [ref] = threadsFromTrailers(dir, 'main')
  assert.equal(ref?.threadId, '42')
  assert.equal(ref?.subject, 'fix: "quoted", colon: yes — dash')
})

test('on the base branch it still finds recent trailers via the fallback window', () => {
  const dir = repo()
  commit(dir, 'chore: setup')
  commit(dir, 'feat: something\n\nFigma: 999')

  // base..HEAD is empty here, so this only works via the bounded fallback.
  assert.deepEqual(
    threadsFromTrailers(dir, 'main').map((r) => r.threadId),
    ['999'],
  )
})

test('--since bounds the range explicitly', () => {
  const dir = repo()
  commit(dir, 'one\n\nFigma: 1')
  const cut = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
  commit(dir, 'two\n\nFigma: 2')

  assert.deepEqual(
    threadsFromTrailers(dir, 'main', cut).map((r) => r.threadId),
    ['2'],
  )
})

test('a repo with no commits yields nothing rather than throwing', () => {
  assert.deepEqual(threadsFromTrailers(repo(), 'main'), [])
})

test('a directory that is not a repo yields nothing rather than throwing', () => {
  assert.deepEqual(threadsFromTrailers(mkdtempSync(join(tmpdir(), 'figflow-nr-')), 'main'), [])
})

test('an explicit since always wins over branch detection', () => {
  assert.equal(resolveRange(repo(), 'main', 'abc123'), 'abc123..HEAD')
})
