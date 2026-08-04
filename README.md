# figflow

Carries Figma comments into your repo, and carries the result back to the designer.

```
Sara comments in Figma
  → figflow sync            you see it in the terminal
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
| `file_comments:read` | `sync` |
| `file_content:read` | frame names |
| `file_comments:write` | `report` (the reply and the ✅) |
| `file_dev_resources:write` | `report` (pinning PR/preview to the frame) |

```sh
export FIGMA_TOKEN=figd_…        # or .env.local next to .figflow/
```

Then in the repo the designs belong to:

```sh
figflow init "https://www.figma.com/design/<key>/…" \
  --name "Oonee MVP" \
  --preview "https://oonee-mvp-git-{branch}.vercel.app"

figflow sync
figflow routes --init            # stub listing every commented frame
$EDITOR .figflow/routes.json     # fill in "/services", "/provider", …
```

`routes.json` is what turns "a comment on the Service Card frame" into "look at
`/services` on the preview". Frames you leave blank still work — the reply just
links the preview root.

## Daily

```sh
figflow sync                       # what changed in Figma
figflow status                     # open / in progress / awaiting review
figflow context --open | pbcopy    # paste into Claude Code

figflow start 1382 1383            # before you begin
# …implement, push, preview deploys…
figflow report                     # dry run — shows the exact reply
figflow report --post              # send it
```

`report` with no thread ids picks up everything you ran `start` on for the current
branch. It finds the PR through `gh` if there is one. `--note "…"` adds a line of
your own to the reply; `--pr N` and `--preview URL` override the lookups.

## Safety

**`report` never posts unless you pass `--post`.** Default is a dry run that prints
the exact text, the exact URLs, and what would get pinned to which frame.

**It cannot notify the designer twice.** Two independent guards: our own state
records what was posted at which content hash, and — if state is ever lost — it
scans the thread's existing replies for the PR/preview link before posting. Change
the comment or the PR and it posts again; otherwise it stays quiet. This is the
thing that decides whether the designer trusts the tool or mutes the file.

**Reads and writes are separate modules.** `src/figma.ts` is GET-only and asserts
it at runtime. `src/figma-write.ts` is the only file that can post, and only
`report` imports it. "Does this touch the designer's file?" is answerable by grep.

**Edits after you start are surfaced.** If Sara changes the ask while you're
working, `sync` and `status` flag it and `report` marks it ⚠ rather than telling
her something stale is ready.

## State

`.figflow/state.json` is the whole database — commit it. Git gives you sync,
history, and conflict resolution for free, and changes show up in PR diffs.

Statuses: `open` → `in_progress` (start) → `reported` (report) → `resolved`
(the designer, in Figma) — plus `gone` for deleted comments. Figma always wins on
`resolved`; the middle two are ours.

## Layout

```
src/figma.ts         read-only client + thread grouping   (GET only, enforced)
src/figma-write.ts   the only module that posts to Figma
src/state.ts         schema + reconcile                   (pure, tested)
src/report-plan.ts   what would be posted, and why not    (pure, tested)
src/project.ts       branch, PR via gh, preview URL
src/routes.ts        frame → app path
src/commands/        init, sync, status, context, routes, start, report
docs/RESEARCH.md     API constraints, prior art, what was ruled out
```

`npm test` — 20 tests over reconcile and report planning, no network.

## Deliberately not built

**Playwright screenshot diffing.** The reply carries a live preview URL; the
designer clicking through beats any screenshot, and Figma comments can't hold
images via the API. Screenshots are for local verification later, not for the loop.

**GitHub issues.** Only worth it if you want the work tracked somewhere other than
the Figma thread. The thread is already the tracker.

**An MCP wrapper.** The CLI is the interface; adding MCP is ~50 lines when there's
a reason to want it.

See `docs/RESEARCH.md` for the reasoning on each, plus the Figma API limits that
shaped this.
