import { execFileSync } from 'node:child_process'
import { openSource, sourceKind } from '../adapters/index.ts'
import { SOURCE_KINDS } from '../adapters/types.ts'
import { has, parseArgs } from '../args.ts'
import {
  DEFAULT_BASE_BRANCH,
  configPath,
  findRoot,
  findToken,
  loadConfig,
  type Config,
} from '../config.ts'
import {
  checkPreviewTemplate,
  checkRoutes,
  checkStateAgreesWithConfig,
  checkTokenExpiry,
  checkTracked,
  exitCode,
  fail,
  ok,
  summarize,
  warn,
  type Check,
} from '../doctor.ts'
import { checkPreview } from '../preview.ts'
import { currentBranch, previewBase } from '../project.ts'
import { loadRoutes } from '../routes.ts'
import { loadState } from '../state.ts'
import { bold, dim, green, yellow } from '../term.ts'

/**
 * Everything that has to be true for the loop to work, checked in one place.
 * Network checks are read-only; `doctor` cannot write to anyone's file.
 */
export async function doctor(argv: string[]): Promise<void> {
  const args = parseArgs(argv)
  const offline = has(args, '--offline')
  const checks: Check[] = []

  const root = findRoot()
  if (!root) {
    checks.push(
      fail(
        'config',
        'no .figflow/config.json here or in any parent',
        'Run `figflow init <figma-url>`. If you have run it before, check you are on\n' +
          '      a branch where .figflow is committed — merge your base branch in.',
      ),
    )
    return finish(checks, has(args, '--json'))
  }
  checks.push(ok('config', configPath(root).replace(`${root}/`, '')))

  let config: Config
  try {
    config = loadConfig(root)
  } catch (err) {
    checks.push(fail('config', err instanceof Error ? err.message.split('\n')[0] ?? 'unreadable' : 'unreadable'))
    return finish(checks, has(args, '--json'))
  }

  checks.push(
    SOURCE_KINDS.includes(sourceKind(config))
      ? ok('source', `${sourceKind(config)} · ${config.fileType ?? 'design'} · ${config.fileKey}`)
      : fail('source', `unknown source "${sourceKind(config)}"`, `Known: ${SOURCE_KINDS.join(', ')}.`),
  )

  // --- git ---------------------------------------------------------------
  const branch = currentBranch(root)
  checks.push(
    branch
      ? ok('git', `on ${branch}`)
      : warn('git', 'not on a branch', 'report needs one, or pass --branch.'),
  )
  checks.push(checkTracked(gitTracked(root)))

  const base = config.baseBranch ?? DEFAULT_BASE_BRANCH
  checks.push(
    gitHasRef(root, base) || gitHasRef(root, `origin/${base}`)
      ? ok('base branch', base)
      : warn(
          'base branch',
          `"${base}" does not exist`,
          'Trailer scanning falls back to a fixed window of recent commits.',
        ),
  )

  // --- token -------------------------------------------------------------
  const token = findToken(root)
  checks.push(
    token
      ? ok('token', `found (${token.length} chars)`)
      : fail(
          'token',
          'FIGMA_TOKEN is not set',
          'export FIGMA_TOKEN=figd_… or add it to .env.local in the project root.',
        ),
  )
  checks.push(checkTokenExpiry(config, new Date()))

  // --- local files -------------------------------------------------------
  const state = loadState(root, config.fileKey)
  checks.push(checkStateAgreesWithConfig(config, state))
  checks.push(checkRoutes(state, loadRoutes(root)))
  checks.push(checkPreviewTemplate(config))

  // --- network (read-only) -----------------------------------------------
  if (offline) {
    checks.push(ok('network', 'skipped (--offline)'))
  } else if (token) {
    checks.push(await checkFileReadable(config, token))
    if (branch && config.preview?.baseUrl) {
      const url = previewBase(config.preview.baseUrl, branch)
      const res = await checkPreview(url)
      checks.push(
        res.ok
          ? ok('preview reachable', `${url} — ${res.reason}`)
          : warn('preview reachable', `${url} — ${res.reason}`, 'report will refuse to post until this resolves.'),
      )
    }
  }

  finish(checks, has(args, '--json'))
}

/**
 * Reading the configured file is the only capability figflow needs, so it is
 * also the only auth check worth making. /v1/me would be the obvious probe but
 * it demands current_user:read — a scope this tool never uses — and so reports
 * a correctly-scoped token as broken.
 */
async function checkFileReadable(config: Config, token: string): Promise<Check> {
  try {
    const threads = await openSource(config, token).fetchThreads()
    const open = threads.filter((t) => !t.resolvedAt).length
    return ok('auth + file', `${threads.length} threads, ${open} unresolved`)
  } catch (err) {
    const msg = err instanceof Error ? (err.message.split('\n')[0] ?? '') : String(err)
    return fail('auth + file', msg, 'Check the file key, and that this token can see that file.')
  }
}

function gitTracked(root: string): string[] {
  try {
    const out = execFileSync('git', ['ls-files', '.figflow'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.split('\n').filter(Boolean)
  } catch {
    return []
  }
}

function gitHasRef(root: string, ref: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    return true
  } catch {
    return false
  }
}

function finish(checks: Check[], asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify({ checks, summary: summarize(checks) }, null, 2))
  } else {
    console.log('')
    for (const c of checks) {
      const mark = c.level === 'ok' ? green('✓') : c.level === 'warn' ? yellow('!') : yellow('✗')
      console.log(`  ${mark} ${bold(c.name.padEnd(18))} ${c.detail}`)
      if (c.fix) for (const line of c.fix.split('\n')) console.log(dim(`      ${line}`))
    }
    const s = summarize(checks)
    console.log(
      `\n  ${s.fail > 0 ? yellow(`${s.fail} failing`) : green('nothing failing')}` +
        `${s.warn > 0 ? dim(`  ·  ${s.warn} warning${s.warn === 1 ? '' : 's'}`) : ''}` +
        dim(`  ·  ${s.ok} ok`) +
        '\n',
    )
  }
  process.exitCode = exitCode(checks)
}
