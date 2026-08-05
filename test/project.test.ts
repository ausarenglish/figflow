import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pullRequestByNumber, repoWebUrl } from '../src/project.ts'

/** A throwaway repo with one remote, so this stays offline and hermetic. */
function repoWith(remote: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'figflow-'))
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'ignore', 'ignore'] })
  git('init')
  git('remote', 'add', 'origin', remote)
  return dir
}

test('an https remote becomes a web url', () => {
  assert.equal(
    repoWebUrl(repoWith('https://github.com/ausarenglish/oonee-mvp.git')),
    'https://github.com/ausarenglish/oonee-mvp',
  )
})

test('an ssh remote becomes a web url', () => {
  assert.equal(
    repoWebUrl(repoWith('git@github.com:ausarenglish/oonee-mvp.git')),
    'https://github.com/ausarenglish/oonee-mvp',
  )
})

test('an ssh:// remote becomes a web url', () => {
  assert.equal(
    repoWebUrl(repoWith('ssh://git@github.com/ausarenglish/oonee-mvp.git')),
    'https://github.com/ausarenglish/oonee-mvp',
  )
})

test('a remote without the .git suffix is left alone', () => {
  assert.equal(
    repoWebUrl(repoWith('https://github.com/ausarenglish/oonee-mvp')),
    'https://github.com/ausarenglish/oonee-mvp',
  )
})

test('a non-GitHub host works too — nothing here is GitHub-specific', () => {
  assert.equal(
    repoWebUrl(repoWith('git@bitbucket.org:team/repo.git')),
    'https://bitbucket.org/team/repo',
  )
})

test('no remote means no url, not a crash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'figflow-'))
  execFileSync('git', ['init'], { cwd: dir, stdio: ['ignore', 'ignore', 'ignore'] })
  assert.equal(repoWebUrl(dir), null)
})

// This is the whole point of the change: --pr N must produce a clickable link
// for the designer without the GitHub CLI being installed.
test('--pr N builds a PR link from the git remote alone', () => {
  const dir = repoWith('git@github.com:ausarenglish/oonee-mvp.git')
  assert.deepEqual(pullRequestByNumber(dir, 42), {
    number: 42,
    // No title: inventing one produces "Addressed in PR #42 (#42)".
    title: '',
    url: 'https://github.com/ausarenglish/oonee-mvp/pull/42',
  })
})

test('with no remote, --pr N still reports the number and simply has no link', () => {
  const dir = mkdtempSync(join(tmpdir(), 'figflow-'))
  execFileSync('git', ['init'], { cwd: dir, stdio: ['ignore', 'ignore', 'ignore'] })
  assert.equal(pullRequestByNumber(dir, 42).url, '')
})
