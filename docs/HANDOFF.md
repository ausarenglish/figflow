# figflow — state of play

Handoff for a reviewing agent. Written 2026-08-05. Everything below was verified
by running it, not inferred. Where something is unverified it says so.

## What figflow is

A CLI that carries Figma design comments into a repo and carries the result back
to the designer. It makes no model calls of its own — it compiles context and
posts outcomes; the judgement is the caller's.

The loop:

```
designer comments in Figma
  → figflow sync / watch      pull comments into local state
  → figflow context           work packet → agent implements it
  → figflow start             tie threads to a branch
  → push; preview deploys
  → figflow report --post     reply + ✅ + PR/preview pinned to the frame
  → designer resolves in Figma (no API exists for this; it stays human)
  → figflow sync              closed
```

## Repos

**github.com/ausarenglish/figflow** — public, v0.3.0, 41 tests, no runtime deps,
Node 24+. Published today. Installs via `npm install -g github:ausarenglish/figflow`.

**github.com/ausarenglish/oonee-mvp** — private. Next.js app on Vercel
(project `oonee-mvp`, team scope `oonee`). Design work lives here.

## Wired-up state

| Thing | Value |
|---|---|
| Figma file | `Xm9FF9sYw7npqhFOIi41Ue` — **FigJam board**, "Oonee WebApp 2026 - Flow review" |
| Threads | 37 open, 0 resolved, 49 comments total (Sara Linares, Marco, Ausar) |
| Routes mapped | 21 of 24 commented frames |
| Preview template | `https://oonee-mvp-git-{branch}-oonee.vercel.app` |
| Production | `https://oonee-mvp.vercel.app` |
| CI secret | `FIGMA_TOKEN` set on oonee-mvp |
| Workflow | `.github/workflows/figflow-report.yml`, active on `main` |

`.figflow/{config,routes,state}.json` are committed on oonee-mvp `main`
(`c298b84`, `2ca8fe4`).

## Verified by running it

- Figma read: 49 comments → 37 threads, all node-anchored. Frame names resolve
  on FigJam via `/v1/files/:key/nodes` (needs no `depth` param — `depth=1`
  silently strips `absoluteBoundingBox`).
- All 21 mapped routes return 200 on both the branch preview and production.
- `npm install -g github:ausarenglish/figflow` into a clean dir; the installed
  binary runs and produces correct output.
- The deploy workflow fires on `deployment_status`, resolves the commit, and
  stands down cleanly when there is nothing to do (one real run, green).
- `report` dry run for 13 threads against production: correct per-frame deep
  links, preview reachability gate passes.
- `--allow-empty` exits 0; without it, exit 1.

## NOT verified

- **`report --post` has never run.** Nothing has ever been written to Figma. The
  reply/reaction/dev-resource write path is untested against the live API.
- **Dev resources will probably 403.** The Figma account is on a **free** plan and
  dev resources are a Dev Mode feature. `report` degrades gracefully (warns,
  continues, still posts the reply) but that degradation is untested live.
- The workflow has never executed its reporting steps — only the skip path.

## Bugs found and fixed while wiring this up

Each was found by using the tool against a real file, and each would have reached
the designer:

1. `commentUrl` hardcoded `/design/`. The target is a `/board/` file, so every
   link back to Figma pointed at the wrong editor. `init` now records file type.
2. `report` crashed when `postDevResources` failed — after the reply was posted
   but before state was saved, so the run went unrecorded and remaining threads
   were skipped. Now a warning; state saves per thread.
3. `routes --init` emitted duplicate JSON keys (FigJam frames are routinely all
   named "Shape with text"). Node ids now ride in the label.
4. Installed copies could not run at all: Node refuses to strip TypeScript types
   under `node_modules`. Added a `prepare` build; `bin` runs source in-repo,
   compiled JS once installed.
5. The deploy hook resolved a branch via the commit's **pull request**. oonee-mvp
   has never opened a PR — branches merge directly — so it would have skipped
   every deploy forever, silently, while staying green. Now uses
   `/commits/{sha}/branches-where-head`.
6. `gh` dependency removed from the core loop. `--pr N` builds its link from the
   git remote. Only `figflow issue` still needs `gh`.

## Ready to post, pending human approval

`feat/flow-review-tier-1` is merged into `main` and live in production. Commit
`6453544` is a flow-review pass crediting Sara and Marco per change; claims were
spot-checked against code (`BackLink` in both forms, `ConfirmProvider` at root
layout, `app/api/place-photo/route.ts`, `app/api/bookings/[id]/cancel/route.ts`).

**13 threads map to shipped work:** 1858205157, 1858204600, 1859472632,
1859475621, 1859477965, 1859481094, 1858202720, 1862394270, 1858199124,
1858337842, 1859422652, 1858203401, 1859447108.

**Deliberately excluded:** 1858203148 (asked to *edit* a booking; only
cancellation shipped — reporting it would overclaim) and 1859464227 (arguably
covered by the header account menu; judgement call for the owner).

Command, once approved:

```sh
cd <worktree-or-checkout-of-main>
figflow report <13 ids> --preview https://oonee-mvp.vercel.app --branch main
# then --post
```

## Known gaps and open decisions

1. **Nothing pushes.** `start → implement → push → merge` is entirely manual.
   Deliberate so far; the deploy hook takes over from there.
2. **`figflow start` is ceremony you must remember before you begin.** Proposed
   replacement: a commit trailer (`Figma: 1858205157`) that figflow reads from
   `git log`. Written when you actually know what you addressed; survives rebase
   and squash; reviewable in history. **Not built.**
3. **`.figflow/` exists only on `main`**, so it vanishes on branches created
   before 2026-08-05. Merge main in before running figflow on a branch.
4. **`state.json` write contention.** CI commits it on the deployed branch; the
   human edits it locally. Git is the conflict-resolution story. Untested under
   real concurrency.
5. **The workflow fires on production deploys too**, not just previews. A merge
   could therefore trigger a second report. figflow's duplicate guard catches it
   (it scans existing replies for the PR/preview link before posting), but that
   safety net is doing real work here. Consider restricting to Preview.
6. **Dynamic routes flatten to list pages.** `/places/[slug]` and
   `/providers/[id]` map to `/places` and `/providers` because a literal `[slug]`
   404s. Deep-linking to a real instance would be better if stable ids exist.
7. **3 frames intentionally unmapped** — `Menú` (2:89), `Pop ups` (2:195),
   `Services` (2:75). Global nav concerns with no single route; they link the
   preview root, which is correct.
8. **The Figma token expires 2026-11-03** (90-day expiry). It is in
   `oonee-mvp/.env.local` and as the `FIGMA_TOKEN` CI secret. Both need rotating
   then, or the loop goes quiet — and it will fail silently in CI.

## Questions for the reviewer

- Is the commit-trailer design (gap 2) the right replacement for `start`, or is
  there a reason to keep an explicit pre-work marking step?
- Should the deploy hook be restricted to Preview environments (gap 5), or is
  relying on the duplicate guard acceptable?
- Is there a sane way to test the `--post` path without notifying real designers?
  Figma has no sandbox; a scratch file owned by the author is the obvious option
  but has not been tried.
- Anything in the safety model that looks thinner than it reads? The claims are:
  reads and writes live in separate modules (`figma.ts` is GET-only and asserts
  it at runtime); `report` cannot post twice (state hash + reply scanning);
  a dead preview blocks the post; edits after work started are surfaced.
