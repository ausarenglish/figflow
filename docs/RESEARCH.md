# FigFlow — Research Audit & Architecture

Status: proposal, pre-code
Date: 2026-08-03

---

## 0. TL;DR

Three findings change the design:

1. **You cannot resolve a Figma comment programmatically.** No REST endpoint, no Plugin API access, no MCP tool. Open feature request since 2022, still not shipped. `figflow resolve` cannot exist as specified. What *can* be written back: a **reply** on the thread, a **reaction** (✅), and a **dev resource** (a link pinned to the node). The loop closes *informationally*, and a human clicks Resolve.
2. **The official Figma MCP server has 24 tools and not one of them touches comments.** That is the gap. Everything design-context-shaped is already solved and well-funded; the comment lifecycle is unclaimed.
3. **Figma is already shipping the "AI reads your comments" half** — an in-canvas design-review agent and a Figma Agent that summarizes feedback and turns it into next steps. Do not compete there. The defensible wedge is the part Figma structurally will not build: **crossing into someone else's repo.**

Recommended architecture: **one npm package, zero LLM calls, one committed JSON state file, two entrypoints (CLI + MCP).** Drop the Figma plugin. The GitHub Action is a 10-line workflow that runs the CLI, not a build target.

---

## 1. Prior art audit

### Design context → code (SOLVED, don't build)

| Thing | State | Verdict |
|---|---|---|
| **Official Figma MCP** (`mcp.figma.com/mcp`, remote, all plans incl. free) | 24 tools: `get_design_context`, `get_screenshot`, `get_metadata`, `get_variable_defs`, `get_code_connect_map`, `use_figma`, … | **Depend on it.** Never reimplement. Zero comment tools. |
| **GLips/Figma-Context-MCP** (Framelink) | Mature, popular, simplifies Figma API responses for LLMs | Superseded by the official server for most cases. Not a competitor. |
| **Code Connect** (`.figma.tsx` + `figma connect publish`) | Official, GA. Maps Figma node ID → source file + component name | **This is the join key.** See §4. |

### Comments (BARELY TOUCHED)

| Thing | State | Verdict |
|---|---|---|
| **figma-comments-mcp** (fm3o5) | MIT, early/experimental, 4 tools: `list_comments`, `get_unresolved_comments`, `query_comments`, `reply_comment`. No tests, no HTTP transport, currently not installable | Closest prior art. Read-side only. No state, no repo, no verification. |
| **"Figma Comment Reviewer"** Claude Code skill | Fetches unresolved comments, groups by node | A prompt, not a system. No persistence. |
| **Zapier / Make** Figma→GitHub recipes | Comment created → create issue | Fire-and-forget. No dedup, no state, no idempotency, no write-back, no verification. This is what people use today and it's why nobody trusts it. |
| **atlassian-labs/figma-for-jira** | Links *designs* to Jira issues, syncs design metadata | Not comments. Wrong direction. Useful precedent for the dev-resource write-back pattern. |
| **Figma's own AI design review / Figma Agent** | Ships in-canvas: summarize feedback, identify themes, propose next steps | **Competitive.** Owns the "understand the comment" layer. Cedes the repo. |

### Visual verification (HARD, IMMATURE)

| Thing | State | Verdict |
|---|---|---|
| **uiMatch** (kosaki08) | MIT, ~11 stars, self-described "Experimental / 0.x". Playwright render vs Figma node → pixel + ΔE2000 color + layout + text → "Design Fidelity Score" | The most serious attempt at Figma↔DOM comparison. Its immaturity at 11 stars is the signal: this is genuinely hard. |
| **Playwright `toHaveScreenshot()`** | Built in, uses pixelmatch | Excellent for *regression* (screenshot vs previous screenshot). Poor for *conformance* (screenshot vs design). |
| **odiff** | Zig + SIMD, ~6–8× faster than pixelmatch, Node API | Right choice *if/when* pixel diffing is needed. |

**Conclusion:** the read side of Figma is solved. The comment lifecycle, the repo join, and the verification loop are open. Build only those.

---

## 2. Hard constraints (verified against the API docs)

### 2.1 Comments API — `/v1/files/:key/comments`

| Capability | Available? |
|---|---|
| Read all comments (incl. resolved) | ✅ `GET`, returns `resolved_at`, `order_id`, `parent_id`, `client_meta`, `message_meta` |
| Create a comment | ✅ `POST` |
| Reply to a thread | ✅ `POST` with `parent_id`. **Cannot reply to a reply** — one level deep only |
| Delete a comment | ✅ `DELETE` |
| React (✅/👍) | ✅ `POST`/`DELETE` reactions, emoji shortcodes |
| **Mark resolved** | ❌ **Does not exist.** Not REST, not Plugin API, not MCP |
| Pagination on GET comments | ❌ None documented — the whole file comes back in one response |

`client_meta` variants: `Vector`, `FrameOffset`, `Region`, `FrameOffsetRegion`. The `FrameOffset*` variants carry **`node_id`** — that's the anchor from a comment to a frame. Comments pinned to empty canvas are bare `Vector` and have no node anchor (handle this: they degrade to "unanchored, needs human triage").

### 2.2 Rate limits

Comments and dev resources are **Tier 2**; `GET file` / `GET image` are **Tier 1**.

| Tier | Starter | Pro | Org |
|---|---|---|---|
| Tier 1 (file, images) — Dev/Full seat | 10/min | 15/min | 20/min |
| Tier 2 (comments, dev resources) — Dev/Full seat | 25/min | 50/min | 100/min |
| Any tier — View/Collab seat | 5–10/min | same | same |

Practical impact: a full comment sync is **one request**. Rendering node images is the expensive call (Tier 1, 10–20/min) — cache exports aggressively, keyed on node id + file `version`.

### 2.3 Webhooks v2

`FILE_COMMENT` exists and fires on comment creation. Payload includes `comment`, `comment_id`, `parent_id`, `order_id`, `mentions`, `triggered_by`, `created_at`, **`resolved_at`**, `passcode`. There is **no comment-resolved event** — resolution is only observable by polling `GET comments` and watching `resolved_at` flip.

Webhook limits: 20/team, 5/project, 3/file. Team webhooks need team admin.

**Implication: polling is not a v1 compromise, it is the only way to detect resolution.** Design for polling first; webhooks are a latency optimization for *new* comments only. This is a strong argument for keeping v1 pull-based and stateless-on-the-wire.

### 2.4 Dev Resources API — the real write-back channel

`POST /v1/dev_resources` (bulk), `PUT` (bulk update), `DELETE`. Fields: `file_key`, `node_id`, `name`, `url`. **Max 10 per node.** Scope `file_dev_resources:write`.

This pins a labeled link to a specific frame in Dev Mode. It is how you get **"PR #84" and "Preview" showing up on the frame the designer is looking at.** This is the single highest-value write in the entire product and it's not in your original brief.

### 2.5 GitHub

- Sub-issues: REST + GraphQL (GraphQL needs `GraphQL-Features: sub_issues` header). 100 sub-issues per parent, 25 issue types per org.
- Issue advanced search via REST/GraphQL with AND/OR.
- Projects v2 automation is GraphQL-only and requires org-level field configuration.

**Recommendation: v1 uses issues + labels only.** No Projects v2 (GraphQL surface + per-org setup kills the "clone and run" property). Sub-issues only when one comment cluster genuinely spans multiple work items.

Auth: resolve a token as `GITHUB_TOKEN` env → else shell `gh auth token`. Zero setup for anyone who has `gh`, and works unchanged in Actions. No Octokit dependency needed — plain `fetch`.

---

## 3. Challenges to the proposed design

### 3.1 `figflow resolve` cannot ship. Reframe it as `figflow report`.

The final arrow in your diagram is unimplementable by anyone, including Figma's own MCP. Pretending otherwise will be the first GitHub issue filed against the project.

What it becomes:

```
figflow report <thread>
  ├─ POST reply on the thread:
  │    "Addressed in #84 — <preview-url>
  │     Changed: padding 12→16px on ServiceCard (components/service-card.tsx)
  │     ✅ ready for your review"
  ├─ POST ✅ reaction on the root comment
  └─ POST dev_resource on the anchored node:
       name: "PR #84", url: https://github.com/.../pull/84
       name: "Preview", url: https://…-pr-84.vercel.app/services
```

The designer opens Figma, sees a reply + a checkmark + a live preview link pinned to the frame, clicks through, clicks Resolve. **Next `figflow sync` sees `resolved_at` flip and closes the issue.** The loop closes — the human contributes exactly one click, and it's the one click that should stay human anyway (approval).

Be loud about this limitation in the README. It's a credibility asset, not a weakness.

### 3.2 Five artifacts is four too many. Ship one package, two entrypoints.

Your stack: Core Engine → CLI → MCP Server → GitHub Action → Figma Plugin.

- **Figma Plugin: cut entirely.** The Plugin API cannot read comments at all. A plugin can do strictly less than the REST API here. There is no version of this that pays for its own maintenance.
- **GitHub Action: not an artifact.** It's `- run: npx figflow sync --report` in a workflow file, shipped as a docs snippet. Publishing a marketplace action means a second release pipeline, a `dist/` commit, and node20-runtime pinning for zero added capability.
- **MCP server: same package, `figflow mcp` subcommand.** Once the engine exists, the MCP server is ~50 lines of `@modelcontextprotocol/sdk` mapping the same verbs to tools. Not a separate repo, not a separate release.

```
figflow/                 one repo, one package, one release
  src/core/              engine — pure, no I/O at the edges
  src/cli/               commander entrypoint       → bin: figflow
  src/mcp/               MCP stdio server           → figflow mcp
  .github/workflows/     example workflow, documented not published
```

### 3.3 FigFlow should contain zero LLM calls. That is what makes it AI-native.

This is the biggest architectural claim in this document.

The temptation is `figflow plan` → call Claude → get a plan. Resist it, because it costs you:
an API key in config, a provider choice you can't unmake, prompt drift, an eval harness,
nondeterministic output that can't be snapshot-tested, and a tool that's useless
to anyone whose agent isn't the one you picked.

Instead: **FigFlow is a deterministic context compiler and state machine. The intelligence is the caller.**

```
figflow context <thread>   →  emits a complete work packet:
                                comment thread (all replies, author, timestamps)
                                anchored node id + frame name + page
                                exported PNG of the frame
                                Code Connect mapping → source file(s)
                                route + selector from .figflow/routes.json
                                git blame of the mapped files
                                current lifecycle state + linked issue/PR
```

The agent — Claude Code, Cursor, whatever — reads that packet and writes the plan. FigFlow never guesses. Every command is pure, fast, offline-testable, and free.

`figflow plan` still exists, but it is **deterministic grouping**: cluster threads by anchored node → by parent frame → by mapped source file → by explicit `[tag]` in the comment text, and emit Markdown. Optionally `--agent` shells out to whatever agent CLI is on `$PATH` (`claude -p`, etc.) using the *user's* existing auth. FigFlow still owns no key and no prompt.

This is also the honest reading of "Claude as orchestrator." The orchestrator shouldn't be *inside* the tool.

### 3.4 `figflow review` should not pixel-diff against Figma in v1.

Comment-driven feedback is overwhelmingly semantic: *"this padding feels tight," "wrong CTA copy," "this should use the secondary button."* A pixel diff against a Figma frame answers a question nobody asked, and answers it badly — fonts, viewport, dynamic content, image decode, and antialiasing all produce noise that swamps the signal. uiMatch is the serious attempt at this and it's at 11 stars and self-labeled experimental.

**v1 `review` captures, it does not judge.** Playwright screenshots the preview URL at the mapped route and viewport; FigFlow exports the Figma node PNG; both land on disk with a manifest. The agent looks at both images and judges — multimodal comparison is *better* at "was this comment addressed?" than any pixel metric, and it costs you nothing to build.

Pixel diffing arrives later and in its correct role: **regression** (this deploy vs last deploy, `odiff`), not conformance.

### 3.5 The product is a state machine. That's the whole moat.

Everything else is API glue that a competent engineer writes in a weekend. What nobody has built is durable, reviewable, idempotent state over comment threads:

```
discovered → triaged → planned → issue_created → in_progress
           → implemented → deployed → reported → resolved
                                              ↘ stale (comment edited after report)
                                              ↘ orphaned (node deleted from file)
```

State lives in **`.figflow/state.json`, committed to the repo.** Not a database. Not a server. Not a hosted account.

Why this is right:
- Git is the sync layer, conflict resolution, and audit log — for free.
- State changes show up **in PR diffs**, so the loop is reviewable by humans.
- Zero infrastructure means zero adoption friction, which for an OSS dev tool is the entire game.
- It works offline, in CI, and on a plane.

Two rules make it survive contact with reality: **stable IDs** (Figma `comment_id`, never array position) and **content hashes** (so an edited comment marks its issue `stale` instead of silently drifting).

### 3.6 Name

"FigFlow" welds you to Figma, and the state machine is source-agnostic — the same engine runs over Linear comments or GitHub review threads. Don't build the abstraction yet, but put the Figma client behind a one-method `CommentSource` interface so the name isn't a load-bearing decision later. (Also: `figflow` is close enough to Figma's marks to invite a trademark note on an OSS project. Worth 10 minutes of thought before the npm publish, not before the first commit.)

---

## 4. The join problem — comment → code

The hardest unsolved question, and the one that decides whether this is magic or a toy. Three strategies, tried in order:

**1. Code Connect (best, official).** If the repo has `.figma.tsx` files published, `get_code_connect_map` returns `node_id → { codeConnectSrc, codeConnectName }`. A comment anchored to a component instance resolves directly to a source file. Zero configuration, maintained by the design-system owner. **Detect and use this automatically when present.**

**2. `.figflow/routes.json` (cheap, explicit, always works).**
```json
{
  "1:234": { "route": "/services", "selector": "[data-testid=service-card]", "viewport": "mobile" }
}
```
Maps a top-level frame node to a URL and a DOM anchor. Hand-written, ~10 lines for a small app, and it's also exactly what `review` needs to know where to point Playwright. **This is the v1 mechanism.**

**3. Agent inference (fallback).** Hand the frame name, page name, and comment text to the agent and let it grep. Always available, never trusted — record it in state as `inferred: true` so a human can correct it once and have the correction stick.

---

## 5. Recommended MVP (v0.1)

**Smallest surface that removes real work.** Three read commands ship first — they alone delete the "engineer manually reads comments and transcribes them" step, which is the most-repeated manual work in the loop.

```
figflow init                 # write .figflow/config.json, resolve file key from a Figma URL
figflow sync                 # GET comments → reconcile → .figflow/state.json; print the delta
figflow status               # what's open / in progress / awaiting review / resolved
figflow context <thread>     # emit the full work packet (the AI-native primitive)
figflow issue <thread>       # create a GitHub issue, link both directions, record in state
figflow report <thread>      # reply + ✅ reaction + dev resources (PR + preview) — §3.1
figflow mcp                  # expose the same six verbs as MCP tools
```

**Deferred to v0.2:** `review` (Playwright capture + manifest), `plan --agent`, webhook receiver.
**Deferred indefinitely:** pixel diffing, Figma plugin, Projects v2, hosted anything.

### Dependencies (deliberately tiny)

| Package | Why |
|---|---|
| `commander@15` | CLI. Boring on purpose — maximizes outside contributions |
| `@modelcontextprotocol/sdk@1.30` | MCP stdio server |
| `zod` | Validate config, state, and API responses at the boundary |
| `@figma/rest-api-spec@0.41` (dev) | Official generated types. Types only — call `fetch` directly |
| `playwright` (optional peer, v0.2) | Capture only |

No Figma SDK. No Octokit. **No AI SDK.** Node 24, ESM, `tsdown` → `dist`.

### Config

```jsonc
// .figflow/config.json  — committed
{
  "figma": { "fileKey": "abc123", "pageIds": ["0:1"] },
  "github": { "repo": "owner/name", "labels": ["design-feedback"] },
  "preview": { "baseUrl": "https://app-git-{branch}.vercel.app" }
}
```
Secrets by env only: `FIGMA_TOKEN` (scopes: `file_comments:read`, `file_comments:write`, `file_dev_resources:write`, `file_content:read`), `GITHUB_TOKEN` (or fall back to `gh auth token`).

### The end-to-end loop, as it actually works

```
figflow sync                       →  3 new comments on ServiceCard
figflow context 1382               →  work packet → agent reads it
  agent implements the change
figflow issue 1382                 →  #84 opened, linked in state
  git push; preview deploys
figflow report 1382                →  reply + ✅ + "PR #84" & "Preview" pinned to the frame
  designer clicks through, clicks Resolve   ← the one human click
figflow sync                       →  resolved_at set → issue #84 closed
```

Six commands. One human click. No server, no database, no API key beyond the two tokens, no model calls.

---

## 6. Open questions for the first week

1. **Resolution detection latency.** Polling only. Is a `sync` on every `git pull` + a scheduled Action enough, or does anyone actually need sub-minute? (Suspect: no.)
2. **Multi-file / multi-page.** One config = one Figma file is right for v1. When does a repo need many? (Suspect: design systems, and later.)
3. **Comment threads with 20 replies.** Truncation strategy for the work packet, or send everything and let the agent's context handle it? (Suspect: send everything; contexts are large now.)
4. **Unanchored comments** (bare `Vector`, no node). Roughly what fraction in a real file? If it's high, the join strategy needs a fourth fallback.
5. **Trademark / name.** See §3.6.

---

## 7. Sources

- Figma REST API — comments endpoints: https://developers.figma.com/docs/rest-api/comments-endpoints/
- Figma REST API — dev resources: https://developers.figma.com/docs/rest-api/dev-resources-endpoints/
- Figma REST API — webhook events: https://developers.figma.com/docs/rest-api/webhooks-events/
- Figma REST API — rate limits: https://developers.figma.com/docs/rest-api/rate-limits
- Figma MCP server — tools and prompts: https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/
- Resolve-via-API feature request (open since 2022): https://forum.figma.com/ask-the-community-7/enhancement-request-ability-to-resolve-a-comment-via-the-api-22011
- uiMatch (Figma↔Playwright comparison): https://github.com/kosaki08/uimatch
- figma-comments-mcp: https://glama.ai/mcp/servers/fm3o5/figma-comments-mcp
- GLips/Figma-Context-MCP: https://github.com/GLips/Figma-Context-MCP
- atlassian-labs/figma-for-jira: https://github.com/atlassian-labs/figma-for-jira
- GitHub sub-issues REST/GraphQL API: https://github.blog/changelog/2024-12-12-github-issues-projects-close-issue-as-a-duplicate-rest-api-for-sub-issues-and-more/
- odiff: https://github.com/dmtrKovalenko/odiff
- Playwright visual comparisons: https://playwright.dev/docs/test-snapshots
- Figma AI design review / Figma Agent: https://www.figma.com/solutions/design-review/
