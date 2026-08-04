---
name: figflow
description: Work through Figma design comments end to end — pull them in, implement them, and report back to the designer. Use when the user mentions Figma comments, design feedback, design review, "what did the designer say", unresolved comments, or asks to close the loop on a design review. Also use after finishing work that came from a Figma comment.
---

# figflow

`figflow` is a CLI in this environment that carries Figma comments into the repo and the
result back to the designer. You drive it; it makes no model calls of its own.

**It is the deterministic half. You are the judgement half.** It tells you what the comments
are, what state they're in, and what would be posted. You decide what the code should be and
whether the work is actually done.

## The loop

```sh
figflow sync                      # pull comments, print what changed
figflow status                    # open / in progress / awaiting review, grouped by frame
figflow context --open            # or: figflow context 1382 1401
```

`context` prints a Markdown work packet: verbatim comment text, replies, the Figma frame, the
app route it maps to, and any prior work on it. **Read the packet before touching code.** Do
not paraphrase the designer — implement what they actually asked for.

Then:

```sh
figflow start 1382 1401           # ties these threads to the current branch
# …implement…
# …push; wait for the preview to deploy…
figflow report                    # DRY RUN — prints the exact reply and checks the preview is up
figflow report --post             # sends it
```

## Rules

**Never run `figflow report --post` without showing the user the dry-run output first and
getting an explicit go-ahead.** It posts to the designer's real Figma file and notifies real
people. The dry run prints the exact reply text, the preview URLs, and what gets pinned to
which frame — show that, then ask.

**Never pass `--skip-check`.** That flag bypasses the check that the preview URL is actually
reachable. Its whole purpose is to stop the designer being sent to a 404.

**If a thread is flagged `⚠ edited since you started`, stop and re-read it.** The designer
changed the ask while you were working. Report the discrepancy to the user; do not report the
old work as done.

**Do not invent the reply text.** `report` builds it from the PR title, the preview URL, and
an optional `--note`. If the change deserves a human sentence, use `--note "…"` — keep it to
what actually changed, in plain language the designer will recognise.

**`figflow` cannot resolve a comment.** Figma has no API for it. The designer resolves; the
next `figflow sync` picks it up. Never tell the user a comment was resolved — only that it
was reported.

## Other commands

- `figflow issue <id…>` — GitHub issue from one or more threads. Groups several comments into
  one issue by default, `--each` for one apiece, `--dry-run` to see the body first.
- `figflow open <id> [--preview]` — open the thread in Figma, or its preview route.
- `figflow routes` — show which frames map to which app path. `--init` writes the stub.
  If `report` warns "no route mapped", offer to fill in `.figflow/routes.json`.
- `figflow watch` — poll and desktop-notify on new comments. Long-running; only start it if
  the user asks, and tell them it runs until ctrl-c.

## Reading state

`.figflow/state.json` is committed and holds every thread ever seen. `figflow context --json`
gives the same data machine-readable if you need to reason over it in bulk. Prefer the CLI
over reading the file directly — the CLI applies the status derivation and staleness checks.
