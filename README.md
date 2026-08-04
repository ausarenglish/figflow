# figflow

Pulls Figma comments into a local state file and emits Markdown work packets for an AI agent.

Built for one job right now: stop hand-transcribing design review comments into work.

## Setup

Needs Node 24+ (no build step — Node runs the TypeScript directly). No runtime dependencies.

```sh
cd ~/code/figflow && npm install && npm link     # puts `figflow` on PATH
```

Get a Figma personal access token at **figma.com → Settings → Security → Personal access tokens**,
scopes `file_comments:read` and `file_content:read`:

```sh
export FIGMA_TOKEN=figd_…      # or put it in .env.local next to .figflow/
```

Then, in the repo the designs belong to:

```sh
figflow init "https://www.figma.com/design/<key>/…" --name "Oonee MVP"
```

That writes `.figflow/config.json`. Commit it.

## Daily use

```sh
figflow sync                 # what changed in Figma since last time
figflow status               # open threads, grouped by frame
figflow context --open       # work packet for every open thread
figflow context 1382 1401    # work packet for specific threads
```

The intended loop:

```sh
figflow sync
figflow context --open | pbcopy     # paste into Claude Code
# …implement…
figflow sync                        # designer resolved it → status flips
```

`--json` on `context` if you want to script against it.

## figflow never writes to Figma

`src/figma.ts` issues `GET` and nothing else — `request()` throws on any other method, so
this is enforced at runtime, not by convention. No replies, no reactions, no dev resources.

This is also partly forced: **Figma has no API to resolve a comment.** Not REST, not the
Plugin API, not the official MCP server. The feature request has been open since 2022.
Resolving stays a human click in Figma, and `figflow sync` picks up `resolved_at` afterward.

## State

`.figflow/state.json` is the whole database. Commit it — git gives you sync, history, and
conflict resolution for free, and state changes show up in PR diffs.

Statuses are `open`, `resolved`, `gone` (deleted from the file). Every thread carries a
content hash, so a comment edited after you started work shows up as `edited` on the next
sync instead of silently drifting.

## Layout

```
src/figma.ts        read-only Figma client + thread grouping
src/state.ts        state schema + reconcile (pure, fully tested)
src/packet.ts       Markdown rendering
src/commands/       init, sync, status, context
docs/RESEARCH.md    API constraints, prior-art audit, where this goes next
```

`npm test` runs the reconcile suite (`node --test`).

## Not built yet

`issue` (open a GitHub issue from a thread), `report` (reply + ✅ + pin the PR/preview to the
frame in Dev Mode), `review` (Playwright capture of the preview beside the Figma export), and
an MCP wrapper. See `docs/RESEARCH.md` for why each is shaped the way it is.
