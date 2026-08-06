---
name: figflow
description: Work through Figma design comments end to end — pull them in, implement them, and report back to the designer. Use when the user mentions Figma comments, design feedback, design review, "what did the designer say", unresolved comments, or asks to close the loop on a design review. Also use after finishing work that came from a Figma comment.
---

# figflow

`figflow` is a CLI in this environment that carries design comments into the repo and
the result back to the designer. It makes no model calls of its own.

**You operate the tool. The user never does.** They should never type a figflow
command, learn a flag, or memorise a thread id.

**Ask only product questions.** Never ask the user how to use the tool, whether to run
a command, which flag to pass, or whether you should show a dry run. Those are yours to
decide — decide them. Bring the user only decisions that require judgement about the
product or the designer's intent, and bring them as named options with a
recommendation.

| Never ask | Ask instead |
|---|---|
| "Should I run sync first?" | *(just run it)* |
| "Do you want to see the dry run?" | "Here is what Sara will receive. Send it?" |
| "Should I use `--note`?" | *(decide; show the resulting text)* |
| "Which thread id did you mean?" | "Sara has three comments on that screen — this one?" |
| "Shall I commit with a trailer?" | *(just do it)* |

**It is the deterministic half. You are the judgement half.** It tells you what the
comments are, what state they are in, and what would be posted. You decide what the
code should be and whether the work is actually done.

## Rhythm

**Batch, then check in.** Take a group of related comments, do the whole group, and
come back once with everything ready to review. Do not stop after every comment. A
batch is roughly one screen's worth of feedback, not the entire backlog.

**Report in the user's language, not the tool's.** "Sara has four comments on the shop
detail screen", not "4 threads anchored to node 2:406". Show thread ids only when
disambiguating.

## The four hard gates

Stop and ask, every time, however much autonomy you have been given:

1. **Before anything reaches a designer.** Show the exact reply text and get an
   explicit yes. This is the only irreversible step in the loop.
2. **A comment that is a question, not a request.** "Is there a way to edit a booking
   after?" is not a work item. Ask how the user wants to answer it. Never implement a
   question.
3. **A comment that is vague or a judgement call.** "Reorder and rename sections", "Add
   some pop ups like reminders". Lay out the plausible readings and let the user pick.
   Do not choose for them and do not average them.
4. **A comment that changed while you were working.** figflow flags this as
   `⚠ edited since you started`. Stop, re-read, and tell the user what changed. Never
   report work against wording the designer has since replaced.

Everything else — syncing, mapping frames to routes, writing the commit trailer,
checking the preview is up, posting once approved — you do without asking.

## Request → command

| The user says | You run |
|---|---|
| anything, first action of a session | `figflow doctor` |
| "what did the designers say", "what's outstanding" | `figflow sync` then `figflow status` |
| "tell me about that one", "what did she mean" | `figflow context <id>` |
| "let's work on X" | `figflow context <id…>`, then implement |
| "what would they see", "is it ready" | `figflow report` (dry run) |
| "send it", "let them know" | `figflow report --post` — after gate 1 |
| "did they reply", "any movement" | `figflow sync` |
| "show me that in Figma" | `figflow open <id>` |
| "track this properly" | `figflow issue <id…>` |
| anything failing or confusing | `figflow doctor` |

Run `figflow doctor` before your first real action in a session. It catches an expired
token, a missing config, a branch without `.figflow`, and an unreachable preview — each
of which otherwise surfaces later as a confusing failure. Report a problem in plain
terms and fix what you can.

## Doing the work

`figflow context` prints a Markdown work packet: verbatim comment text, replies, the
frame, the app route it maps to, and any prior work. **Read the packet before touching
code.** Do not paraphrase the designer — implement what they actually asked for.

When you commit work that addresses a comment, put the thread id in the message:

```
fix(bookings): let a rider cancel an upcoming booking

Figma: 1858203401
```

`report` reads those lines out of git history, so nothing needs marking in advance.

**That line is a claim that the work is done.** It is what causes a designer to be told
their comment has been addressed. Add it only to a commit that genuinely satisfies that
comment — not one that merely touches the same screen, and not one that does half of
it. When in doubt leave it off and say so.

`figflow start <id…>` still exists for marking a thread in-progress before the work
exists. Prefer the trailer otherwise.

## Rules

**Never run `figflow report --post` without showing the dry-run text and getting an
explicit go-ahead.** It posts to a real file and notifies real people.

**Never pass `--skip-check`.** It bypasses the check that the preview is reachable,
which exists to stop a designer being sent to a 404.

**Never pass `--allow-empty` interactively.** It is for the deploy hook, where "no
threads on this branch" is normal. Interactively it hides a real mistake.

**Do not invent the reply text.** `report` builds it from the PR title, the preview URL
and an optional `--note`. If the change deserves a human sentence, use `--note "…"` —
plain language describing what actually changed.

**Never say a comment was resolved.** Figma has no API for it. The designer resolves;
the next `figflow sync` picks it up. Only ever say it was reported.

**Do not report work that is not deployed.** The reply carries a preview link. If the
preview is not live, wait — `report` will refuse, and that refusal is correct.

## Other commands

- `figflow issue <id…>` — GitHub issue from one or more threads. Requires `gh`; nothing
  else in the loop does. `--dry-run` shows the body first.
- `figflow open <id> [--preview]` — open the thread in Figma, or its preview route.
- `figflow routes` — which frames map to which app path. `--init` writes the stub. If
  `report` warns "no route mapped", fill it in rather than asking the user to.
- `figflow watch` — poll and desktop-notify. Long-running; only start it if asked, and
  say it runs until ctrl-c.

## Reading state

`.figflow/state.json` is committed and holds every thread ever seen. `figflow context
--json` gives the same data machine-readable. Prefer the CLI over reading the file
directly — the CLI applies the status derivation and staleness checks.

If `.figflow` is missing, the user is probably on a branch created before it was
committed. Merging the base branch in fixes it; `figflow doctor` says so.
