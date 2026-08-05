# figflow

Carries Figma comments into your repo, and carries the result back to the designer.

```
Sara comments in Figma
  → figflow watch           desktop ping, seconds later
  → figflow context         work packet → agent implements it
  → figflow start           threads tied to your branch
  → push, preview deploys
  → figflow report --post   reply + ✅ + PR/preview pinned to her frame
  → Figma notifies her, she clicks through, she resolves
  → figflow sync            closed
```

One human click in the whole loop: hers, at the end. That one stays human because
it's the approval — and because Figma has no API to resolve a comment anyway.

## Setup

Node 24+. No build step, no runtime dependencies.

```sh
cd ~/code/figflow && npm install && npm link
```

Figma personal access token — **figma.com → Settings → Security → Personal access tokens**:

| scope | needed for |
|---|---|
| `file_comments:read` | `sync`, `watch` |
| `file_content:read` | frame names |
| `file_comments:write` | `report` — the reply and the ✅ |
| `file_dev_resources:write` | `report` — pinning PR/preview to the frame |

Dev resources are a Dev Mode feature, so on a free Figma plan that last one 403s
even with the scope granted. `report` treats it as optional: the reply and the ✅
still land, and the run prints `dev resources not pinned` rather than failing.

```sh
export FIGMA_TOKEN=figd_…        # or .env.local next to .figflow/
```

Then in the repo the designs belong to:

```sh
figflow init "https://www.figma.com/design/<key>/…" \
  --name "Oonee MVP" \
  --preview "https://oonee-mvp-git-{branch}-oonee.vercel.app"

figflow sync
figflow routes --init            # stub listing every commented frame
$EDITOR .figflow/routes.json     # fill in "/services", "/provider", …
```

`routes.json` turns "a comment on the Service Card frame" into "look at `/services`
on the preview". Frames you leave blank still work — the reply links the preview root.

The preview template must match the alias Vercel actually issues, which includes
the team scope: `{project}-git-{branch}-{scope}.vercel.app`. Get the real one from
`vercel inspect <any-preview-url> --scope <team>` and read the **Aliases** line —
guessing it is how you end up sending a designer to a 404. `init` accepts
`/design/`, `/board/` (FigJam) and `/slides/` URLs and records which, so links back
to Figma point at the right editor.

## Daily

```sh
figflow sync                       # what changed in Figma
figflow watch                      # or leave this running — pings you on new comments
figflow status                     # open / in progress / awaiting review
figflow context --open | pbcopy    # paste into Claude Code
figflow open 1382                  # jump to the thread in Figma

figflow issue 1382 1383            # optional: one GitHub issue for both comments
figflow start 1382 1383            # before you begin
# …implement, push, preview deploys…
figflow report                     # dry run — exact reply, and checks the preview is up
figflow report --post              # send it
```

`report` with no thread ids picks up everything you `start`ed on the current branch.
`--note "…"` adds your own line; `--pr N` and `--preview URL` override the lookups.

**`gh` is optional.** With it installed, `report` finds the branch's PR by itself.
Without it, pass `--pr N` — the link is built from your git remote, so it works on
plain git access with no GitHub CLI. `figflow issue` is the one command that does
require `gh`.

## Using it from Claude Code

`skills/figflow/SKILL.md` is a Claude Code skill — symlink it into `~/.claude/skills/`
and Claude drives the whole loop when you mention design comments. It's told never to
run `--post` without showing you the dry run first, never to pass `--skip-check`, and
to stop and re-read when a comment was edited after you started.

## Making it hands-free

`examples/figflow-report.yml` is a GitHub Actions workflow that fires on
`deployment_status` success and runs `figflow report --post` — so the designer is
notified the moment the preview is genuinely live, not when the code was written.
It uses the deploy's own `environment_url`, so there's no branch-slug guessing.

Vercel's deployment event carries a commit SHA and an empty payload — no branch
name anywhere — so the workflow resolves the branch through the commit's PR, which
returns the PR number in the same call. It passes `--allow-empty`, because most
pushes have no design threads attached and that is not a failure.

Copy it into the app repo, add `FIGMA_TOKEN` as a secret, and `figflow start` becomes
the only thing you run by hand. The workflow must be on the default branch to fire.

## Safety

**`report` never posts unless you pass `--post`.** Default is a dry run printing the
exact text, the exact URLs, and what would be pinned to which frame.

**It checks the preview is actually reachable first.** A 404 or 5xx blocks the post.
Vercel deployment protection (401/403) passes — the deploy exists, we just can't see
it. Sending a designer to a dead link once is enough for them to stop opening the
notifications.

**It cannot notify twice.** Two independent guards: state records what was posted at
which content hash, and — if state is ever lost — it scans the thread's existing
replies for the PR/preview link before posting. Change the comment or the PR and it
speaks again; otherwise it stays quiet.

**Reads and writes are separate modules.** `src/figma.ts` is GET-only and asserts it
at runtime. `src/figma-write.ts` is the only file that can post, imported only by
`report`. "Does this touch the designer's file?" is answerable by grep.

**Edits after you start are surfaced.** If Sara changes the ask while you're working,
`sync`, `watch`, and `status` flag it, and `report` marks it ⚠ rather than telling her
something stale is ready.

**`issue` acts immediately**, no `--post` — it writes to your own repo, where a
mistake is trivially deletable. The safety default tracks real risk, not symmetry.
`--dry-run` shows the body first.

## State

`.figflow/state.json` is the whole database — commit it. Git gives you sync, history,
and conflict resolution for free, and changes show up in PR diffs.

Statuses: `open` → `in_progress` (start) → `reported` (report) → `resolved` (the
designer, in Figma) — plus `gone` for deleted comments. Figma always wins on
`resolved`; the middle two are ours.

## Layout

```
src/figma.ts         read-only client + thread grouping   (GET only, enforced)
src/figma-write.ts   the only module that posts to Figma
src/state.ts         schema + reconcile                   (pure, tested)
src/report-plan.ts   what would be posted, and why not    (pure, tested)
src/preview.ts       is the deploy actually up            (pure policy, tested)
src/project.ts       branch, PR via gh, preview URL
src/routes.ts        frame → app path
src/sync-core.ts     one pull-and-fold, shared by sync and watch
src/commands/        init, sync, watch, status, context, routes, open, issue, start, report
skills/figflow/      Claude Code skill
examples/            GitHub Actions workflow for auto-report on deploy
docs/RESEARCH.md     API constraints, prior art, what was ruled out
```

`npm test` — 41 tests, no network.

## Deliberately not built

**Playwright screenshot diffing.** The reply carries a live preview URL and `report`
verifies it responds; the designer clicking through beats any screenshot, and Figma
comments can't hold images via the API. A headless browser download for marginal gain.

**An MCP wrapper.** The skill covers the agent surface, and the CLI already works from
any agent that can run a shell. ~50 lines to add if a reason appears.

**Webhooks.** Figma's `FILE_COMMENT` fires on creation only — there is no resolve
event — so polling is required regardless. `watch` is the honest version of that.

See `docs/RESEARCH.md` for the API limits behind each.
