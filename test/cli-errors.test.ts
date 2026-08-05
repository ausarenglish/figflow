import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const BIN = fileURLToPath(new URL('../bin/figflow.mjs', import.meta.url))

type Run = { code: number; out: string }

/**
 * Run the real binary. Env is scrubbed of tokens so a developer's shell cannot
 * make a test pass, and HOME is redirected so no .env is picked up by accident.
 */
function run(args: string[], cwd: string, env: Record<string, string> = {}): Run {
  try {
    const out = execFileSync(process.execPath, [BIN, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '', HOME: cwd, ...env },
    })
    return { code: 0, out }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

function emptyDir(): string {
  return mkdtempSync(join(tmpdir(), 'figflow-cli-'))
}

function project(config: object, extra: Record<string, string> = {}): string {
  const dir = emptyDir()
  mkdirSync(join(dir, '.figflow'), { recursive: true })
  writeFileSync(join(dir, '.figflow', 'config.json'), JSON.stringify(config))
  for (const [name, body] of Object.entries(extra)) {
    writeFileSync(join(dir, '.figflow', name), body)
  }
  return dir
}

/** An actionable error names the problem AND what to do about it. */
function assertActionable(r: Run, mustMention: RegExp): void {
  assert.equal(r.code, 1, `expected a non-zero exit, got:\n${r.out}`)
  assert.match(r.out, /error:/i)
  assert.match(r.out, mustMention)
  assert.ok(r.out.trim().length > 30, `error was too terse to act on:\n${r.out}`)
}

// --- no project -----------------------------------------------------------

for (const cmd of ['sync', 'status', 'routes', 'start', 'report', 'open', 'issue', 'context']) {
  test(`${cmd} outside a project says how to create one`, () => {
    assertActionable(run([cmd, '1'], emptyDir()), /figflow init/)
  })
}

test('the missing-project error also covers the branch-switch case', () => {
  // .figflow committed on main only is a real and confusing failure mode.
  assert.match(run(['sync'], emptyDir()).out, /branch/i)
})

// --- unknown input --------------------------------------------------------

test('an unknown command points at help', () => {
  assertActionable(run(['frobnicate'], emptyDir()), /figflow help/)
})

test('init with no url explains the usage', () => {
  assertActionable(run(['init'], emptyDir()), /Usage: figflow init/)
})

test('init rejects something that is not a figma url', () => {
  assertActionable(run(['init', 'hello'], emptyDir()), /Could not read a Figma file key/)
})

test('init rejects a malformed token expiry rather than storing it', () => {
  assertActionable(run(['init', 'https://figma.com/board/AbCdEfGhIjKlMnOpQrStUv/x', '--token-expires', 'soon'], emptyDir()), /YYYY-MM-DD/)
})

test('init refuses to clobber an existing config without --force', () => {
  const dir = project({ fileKey: 'k' })
  assertActionable(run(['init', 'https://figma.com/board/AbCdEfGhIjKlMnOpQrStUv/x'], dir), /--force/)
})

// --- broken project -------------------------------------------------------

test('an unparseable config says so and how to fix it', () => {
  const dir = emptyDir()
  mkdirSync(join(dir, '.figflow'), { recursive: true })
  writeFileSync(join(dir, '.figflow', 'config.json'), '{ not json')
  assertActionable(run(['status'], dir), /not valid JSON/)
})

test('sync without a token explains where to get one', () => {
  assertActionable(run(['sync'], project({ fileKey: 'k' })), /Personal access token|FIGMA_TOKEN is not set/)
})

// --- report ---------------------------------------------------------------

test('report with nothing marked lists every way to mark something', () => {
  const dir = project({ fileKey: 'k', preview: { baseUrl: 'https://x-{branch}.app' } })
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: ['ignore', 'ignore', 'ignore'] })
  const r = run(['report'], dir)
  assertActionable(r, /figflow start/)
  assert.match(r.out, /Figma: <id>/, 'and mentions the trailer, the least ceremonious option')
  assert.match(r.out, /--allow-empty/, 'and how to make it quiet in CI')
})

test('report with no preview configured says exactly what to add', () => {
  const dir = project({ fileKey: 'k' })
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: ['ignore', 'ignore', 'ignore'] })
  assertActionable(run(['report', '123'], dir), /"preview": \{ "baseUrl"/)
})

test('context with an unknown thread id names the id and the fix', () => {
  const dir = project({ fileKey: 'k' })
  const r = run(['context', '999'], dir)
  assertActionable(r, /figflow sync/)
  assert.match(r.out, /999/)
})

test('open with no id shows its usage', () => {
  assertActionable(run(['open'], project({ fileKey: 'k' })), /Usage: figflow open/)
})

test('watch rejects an interval that would get us rate-limited', () => {
  assertActionable(run(['watch', '--interval', '5'], project({ fileKey: 'k' })), /at least 30/)
})

// --- doctor ---------------------------------------------------------------

test('doctor outside a project fails and explains, rather than crashing', () => {
  const r = run(['doctor', '--offline'], emptyDir())
  assert.equal(r.code, 1)
  assert.match(r.out, /figflow init/)
})

test('doctor exits non-zero when a required piece is missing', () => {
  // No preview URL and no token: report could never run here.
  const r = run(['doctor', '--offline'], project({ fileKey: 'k' }))
  assert.equal(r.code, 1)
  assert.match(r.out, /preview url/)
})

test('doctor --json emits parseable output with a summary', () => {
  const r = run(['doctor', '--offline', '--json'], project({ fileKey: 'k' }))
  const parsed = JSON.parse(r.out) as { checks: { name: string; level: string }[]; summary: Record<string, number> }
  assert.ok(parsed.checks.length > 3)
  assert.ok((parsed.summary.fail ?? 0) >= 1)
})

test('doctor passes offline on a fully configured project', () => {
  const dir = project(
    {
      fileKey: 'k',
      preview: { baseUrl: 'https://x-{branch}.app' },
      tokenExpiresAt: '2099-01-01',
    },
    { 'state.json': JSON.stringify({ version: 1, fileKey: 'k', lastSyncAt: null, nodes: {}, threads: {} }) },
  )
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: ['ignore', 'ignore', 'ignore'] })
  const r = run(['doctor', '--offline'], dir, { FIGMA_TOKEN: 'figd_pretend' })
  assert.equal(r.code, 0, r.out)
})

// --- things that must NOT fail -------------------------------------------

test('help and version work with no project at all', () => {
  assert.equal(run(['help'], emptyDir()).code, 0)
  assert.equal(run(['--version'], emptyDir()).code, 0)
})
