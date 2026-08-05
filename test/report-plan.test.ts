import assert from 'node:assert/strict'
import { test } from 'node:test'
import { branchSlug, previewBase, type PullRequest } from '../src/project.ts'
import { planReport, type PlanInput } from '../src/report-plan.ts'
import { emptyState, type State, type ThreadRecord } from '../src/state.ts'

const KEY = 'abc123'
const PR: PullRequest = { number: 84, title: 'Fix card padding', url: 'https://github.com/o/r/pull/84' }

function stateWith(threads: Record<string, Partial<ThreadRecord>>): State {
  const state = emptyState(KEY)
  state.nodes['1:234'] = { name: 'Service Card', type: 'FRAME' }
  for (const [id, over] of Object.entries(threads)) {
    state.threads[id] = {
      status: 'in_progress',
      hash: 'h1',
      nodeId: '1:234',
      author: 'sara',
      createdAt: '2026-07-28T09:00:00Z',
      resolvedAt: null,
      firstSeenAt: '2026-08-01T00:00:00Z',
      lastSeenAt: '2026-08-03T00:00:00Z',
      message: 'padding feels tight',
      replies: [],
      url: `https://www.figma.com/design/${KEY}/#${id}`,
      ...over,
    }
  }
  return state
}

function plan(state: State, over: Partial<PlanInput> = {}) {
  return planReport({
    state,
    routes: { '1:234': '/services' },
    previewBase: 'https://app-git-fix-cards.vercel.app',
    branch: 'fix/cards',
    pr: PR,
    note: null,
    threadIds: Object.keys(state.threads),
    ...over,
  })
}

test('builds a reply with the mapped route, and pins PR + preview to the frame', () => {
  const [item] = plan(stateWith({ '1382': {} }))

  assert.equal(item?.skip, null)
  assert.equal(item?.previewUrl, 'https://app-git-fix-cards.vercel.app/services')
  assert.match(item?.message ?? '', /Fix card padding \(#84\)/)
  assert.match(item?.message ?? '', /https:\/\/app-git-fix-cards\.vercel\.app\/services/)
  assert.deepEqual(
    item?.devResources.map((d) => d.name),
    ['Preview', 'PR #84'],
  )
})

test('several comments on one frame pin the links once, not once each', () => {
  const items = plan(stateWith({ '1382': {}, '1383': {}, '1384': {} }))

  assert.equal(items.length, 3, 'every thread still gets its own reply')
  assert.equal(items.filter((i) => i.devResources.length > 0).length, 1, 'but the frame is pinned once')
})

test('an unmapped frame still reports, falling back to the preview root', () => {
  const [item] = plan(stateWith({ '1382': {} }), { routes: {} })
  assert.equal(item?.skip, null)
  assert.equal(item?.route, null)
  assert.equal(item?.previewUrl, 'https://app-git-fix-cards.vercel.app')
})

test('an unanchored comment reports but pins nothing', () => {
  const [item] = plan(stateWith({ '1382': { nodeId: null } }))
  assert.equal(item?.skip, null)
  assert.deepEqual(item?.devResources, [])
})

test('never posts twice for the same state — this is what stops designer spam', () => {
  const state = stateWith({
    '1382': {
      status: 'reported',
      reported: {
        at: '2026-08-02T00:00:00Z',
        hash: 'h1',
        pr: 84,
        url: 'https://app-git-fix-cards.vercel.app/services',
        branch: 'fix/cards',
      },
    },
  })
  assert.match(plan(state)[0]?.skip ?? '', /already reported/)
})

test('reports again once the comment itself changes', () => {
  const state = stateWith({
    '1382': {
      status: 'reported',
      hash: 'h2',
      reported: {
        at: '2026-08-02T00:00:00Z',
        hash: 'h1',
        pr: 84,
        url: 'https://app-git-fix-cards.vercel.app/services',
        branch: 'fix/cards',
      },
    },
  })
  const [item] = plan(state)
  assert.equal(item?.skip, null)
  assert.equal(item?.stale, true, 'and it is flagged as changed since we last spoke')
})

test('an existing reply linking the PR blocks a duplicate even if state was lost', () => {
  const state = stateWith({
    '1382': {
      replies: [{ id: '9', author: 'ausar', at: '2026-08-02T00:00:00Z', message: `done: ${PR.url}` }],
    },
  })
  assert.match(plan(state)[0]?.skip ?? '', /already links this PR/)
})

test('skips threads the designer already resolved, and deleted ones', () => {
  const state = stateWith({
    '1382': { status: 'resolved', resolvedAt: '2026-08-02T00:00:00Z' },
    '1383': { status: 'gone' },
  })
  const items = plan(state)
  assert.match(items[0]?.skip ?? '', /already resolved/)
  assert.match(items[1]?.skip ?? '', /deleted/)
})

test('with no PR found, the reply still carries the preview link', () => {
  const [item] = plan(stateWith({ '1382': {} }), { pr: null })
  assert.equal(item?.skip, null)
  assert.match(item?.message ?? '', /branch fix\/cards/)
  assert.match(item?.message ?? '', /app-git-fix-cards\.vercel\.app\/services/)
  assert.deepEqual(item?.devResources.map((d) => d.name), ['Preview'])
})

test('a note from the author is included verbatim', () => {
  const [item] = plan(stateWith({ '1382': {} }), { note: 'Padding 12 → 16px, icon 20px.' })
  assert.match(item?.message ?? '', /Padding 12 → 16px, icon 20px\./)
})

test('branch names become Vercel-style preview subdomains', () => {
  assert.equal(branchSlug('fix/cards'), 'fix-cards')
  assert.equal(branchSlug('feat/Tier_2--Review'), 'feat-tier-2-review')
  assert.equal(
    previewBase('https://oonee-mvp-git-{branch}.vercel.app', 'fix/cards'),
    'https://oonee-mvp-git-fix-cards.vercel.app',
  )
})

// --- duplicate suppression ------------------------------------------------
//
// The tool's central promise is that it cannot notify a designer twice. The
// guard used to require the PR and preview URL to match as well as the hash,
// which meant the same unchanged ask was re-reported the moment the URL moved.
// A branch preview followed by a production deploy of the same work did exactly
// that, and with no PR the reply scan had no marker to catch it either.

test('the same ask on a new URL is not reported again — preview, then production', () => {
  const state = stateWith({
    '1382': {
      status: 'reported',
      reported: {
        at: '2026-08-04T00:00:00Z',
        hash: 'h1',
        pr: null,
        url: 'https://app-git-feat-x.vercel.app/services',
        branch: 'feat/x',
      },
    },
  })
  const [item] = plan(state, { pr: null, previewBase: 'https://app.vercel.app', branch: 'main' })
  assert.match(item?.skip ?? '', /already reported/)
})

test('nor when the PR appears after the fact', () => {
  const state = stateWith({
    '1382': {
      status: 'reported',
      reported: {
        at: '2026-08-04T00:00:00Z',
        hash: 'h1',
        pr: null,
        url: 'https://app-git-fix-cards.vercel.app/services',
        branch: 'fix/cards',
      },
    },
  })
  assert.match(plan(state)[0]?.skip ?? '', /already reported/)
})

test('a reply carrying a URL we previously reported blocks a repeat after state loss', () => {
  const state = stateWith({
    '1382': {
      replies: [
        {
          id: '9',
          author: 'figflow',
          at: '2026-08-02T00:00:00Z',
          message: 'Preview: https://app-git-fix-cards.vercel.app/services',
        },
      ],
    },
  })
  assert.match(plan(state, { pr: null })[0]?.skip ?? '', /already links/)
})

test('but a genuinely changed ask still speaks, even on the same URL', () => {
  const state = stateWith({
    '1382': {
      status: 'reported',
      hash: 'h2',
      reported: {
        at: '2026-08-04T00:00:00Z',
        hash: 'h1',
        pr: null,
        url: 'https://app-git-fix-cards.vercel.app/services',
        branch: 'fix/cards',
      },
    },
  })
  const [item] = plan(state, { pr: null })
  assert.equal(item?.skip, null)
  assert.equal(item?.stale, true)
})
