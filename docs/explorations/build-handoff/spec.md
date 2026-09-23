# Supervised Build Handoff — spec

Version 5, 2026-09-22. Rendered page: `supervised-build-handoff.html` in this
folder (also published at https://claude.ai/artifact/RAkWdxmGpgPoHkxtwHbQgd).
Spike backing the storage decision: `spike-isomorphic-git.md` (code on branch
`spike/isomorphic-git`, `spike/isomorphic-git/`).

After the interview, the build leaves the chat: the colleague hands the frozen
fiche and mockup to a builder outside the conversation, an engineer approves,
the hub lands the result, and the colleague comes back for the acceptance walk.

## Decision

**Every build of a new app or a substantial change is a handoff.** The
colleague interviews, writes the fiche, shows the mockup, closes gate 2, then
says it is passing the work on and stops. It never builds a whole app inside a
chat turn again. The build runs as a ticket: a branch, a brief, a builder and a
reviewer, one human approval, a publish from the merged commit, and a hidden
return message that brings the colleague back to open step 5.

**What stays in the chat:** using the app, answering questions, and the small
fix as `process.md` already defines it (moment-sized, reversible, inside the
agreement, on an app that is already live). The colleague keeps `publish` and
`undo` for exactly that.

Why this replaces version 2's « only hard work is handed off »:

- **One path, no triage rule.** Version 2 asked the model to decide, per
  ticket, whether the work was hard. A fixed rule (new app or substantial
  change ⇒ ticket) needs no judgment and the evaluator can check it.
- **The in-chat build is the weakest step.** No tests, no reviewer, publication
  live at once. The interview runs on a fast, low-effort model tier; the build
  needs the strongest tier, a worktree, the dev container and the per-package
  gates, which live outside the Durable Object.
- **The wait becomes honest.** An interview turn answers in seconds; a build
  takes minutes to hours. « I will come back to you when it is ready » is the
  right promise, and the stage layout already has the dot on the Chat button.
- **The human stop** version 2 asked for applies to every build.

## What the colleague says, and the one settled rule it changes

`process.md` ends with « There is one colleague wearing the interviewer,
product, designer, and builder hats; never imply that a separate team is behind
the work », and `docs/history/PLATFORM.md` records the same decision. The
owner's proposed line implies a separate builder. Two wordings; in both the
person keeps one interlocutor and never talks to the builder.

- **A · Owner's wording (recommended).** « Merci pour cet échange. Je passe le
  relais à un développeur avec la fiche et la maquette telles que vous les avez
  validées. Je reviens vers vous dès que l'application est en place ; vous
  n'avez rien à faire d'ici là. » Honest about the process. Changes the rule to
  « one interlocutor »: the developer is named, never reachable.
- **B · One voice.** « Merci pour cet échange. Je pars construire ça ; cela
  prend un moment. Je reviens vers vous dès que c'est en place ; vous n'avez
  rien à faire d'ici là. » Keeps the rule word for word; slightly less true.

Either way: one sentence in `process.md` at the activity-4 boundary, said once,
asserted by evaluator checkpoint H1. The « Où on en est : étape 4 sur 5 — je
construis » line stays, said just before it.

## The seam with the interview work

The interview slice (gates, fiche shown at the gates, stepper) ends at the
gate-2 yes on the « on construit ça ? » card. This spec starts at that yes.
Today the colleague then sets the intent to `building` and writes under `app/`.
After this spec it calls one tool, `request_build`, says the line, and the turn
ends. The interview agent should not implement anything past the gate-2 card.

| Moment | Owned by | Runtime state |
|---|---|---|
| Fiche agreed (gate 1), mockup shown, gate-2 card asked | interview slice | intent `agreed`, mockup present, strip at step 3 |
| Gate-2 yes → `request_build` | this spec | intent `building` + `handoff: <ticket>`, strip at step 4 « en construction » |
| Landing → return message → acceptance walk | this spec | `handoff` cleared, strip at step 5 |
| Gate 3 « je garde » | `process.md`, unchanged | intent `kept` |

## The flow

| # | Step | Who | Ticket state |
|---|---|---|---|
| 1 | Gate 2 closes. The colleague calls `request_build({ intent, note? })`. The runtime checks: intent `agreed`, mockup exists, no pending journal entry, no open ticket. It writes the ticket, sets the front matter, returns the id. The colleague says the handoff line and stops. | colleague + runtime | `queued` |
| 2 | The hub makes sure the app's remote exists (see « Git is the version store »), opens branch `build/<slug>/<ticket>` from the current version's commit, carrying the fiche at its frozen revision, the mockup, PRODUCT.md, the kit, and `BUILD.md` written from a template. A draft PR opens with the ticket id in its title. | hub | `queued` |
| 3 | The runner takes the ticket: one worktree, the dev container, the builder brief. The builder implements the acceptance lines, runs two logic cases for anything that decides, inspects console and screenshot, appends CHANGES.md and rewrites PRODUCT.md, writes a plain-language change note, stores proof under `.eval-evidence/<ticket>/`. It never talks to the person; an unanswerable question marks the ticket stuck. | builder (cloud) | `building` |
| 4 | The reviewer reads the branch against the fiche and tries to break every acceptance line, the migration rule, and the kit rule. Blockers go back to the builder. At most three rounds, then stuck. | reviewer (cloud, read-only) | `review` |
| 5 | **Stop, engineer.** Reads note, proof, verdict, diff. Merge, send back with one line (one more round), or take over the worktree. The PR is the review surface; the GitHub app is enough on a phone. | human | `needs_human` → `merged` / `sent_back` / `stuck` |
| 6 | Landing. The hub fetches the merge commit, reads its tree, validates like any publish, tags and moves the pointer (undo remains the rollback), syncs the colleague's dev filesystem from that commit (a real overwrite of `app/` and `agent/`, not today's additive one-time pull-down), clears the handoff on the intent. No rehearsal slot in v1: acceptance already happens on the live app, and additive-only migrations mean undo loses nothing. | hub | `landed` |
| 7 | Return. The hub sends the colleague a hidden message, like the kickoff, with the change note and the landed version. The colleague says what changed in the person's words, that it is displayed, the « my app is down » line, and opens the acceptance card. If the dock is closed, the Chat button shows the dot. | hub + colleague | — |
| 8 | **Stop, the person (gate 3).** Walks the acceptance lines on real cases. Moment-sized bug: fixed in chat. Other bug: re-ticket on the same track with the report in the brief. Adjustment: new ticket. New need: phase 2. | human | possibly a new `queued` |

Ticket states: `queued → building → review → needs_human → merged → landed`;
`sent_back → building`; `stuck` (terminal until the engineer acts).

## What the person sees during the wait

- **The strip.** Step 4 lit with a second line: « en construction — vous n'avez
  rien à faire ». When landed: « prêt à vérifier ensemble », and the dot on the
  Chat button. The process endpoint already returns `handoff`.
- **The chat.** Open as always. Using the app and questions work. A build
  request during the wait is written into the fiche's journal as « demandé par
  vous » and answered with « je le note pour après la construction ». It is not
  sent to the builder: the brief is frozen at the validated revision.
- **Time.** No estimate promised. A ticket has a budget (proposed two hours of
  runner time, then stuck). Beyond it the colleague says once: « cela prend
  plus de temps que prévu ; je vous préviens dès que c'est en place ».
- **Failure.** A stuck ticket is the engineer's. The person hears nothing new
  until the engineer lands it or sends the colleague a line to relay, which the
  colleague turns into one card. The person never sees a PR, a branch, or a
  builder.

## Enforced by the runtime, not by the prompt

- `request_build` refuses unless the intent is `agreed`, the mockup file exists
  for that track, the journal has no pending « à valider » entry, and no ticket
  is open. Each refusal is one line the colleague can relay.
- `publish` refuses while a ticket is open (any state before `landed`). It also
  refuses when the active intent is `discovery` or `agreed` and the app has no
  current version: a new app is never built from the chat. A live app keeps the
  small-fix path.
- The brief is generated from the fiche by the runtime, never by the model.
- Landing publishes only from a merged commit whose PR carries the ticket id.
- Three evaluator checkpoints join `evals/e2e/checkpoints.md`: **H1** the
  handoff line said exactly once right after the gate-2 yes, and the turn ends
  with no build tool call; **H2** zero `publish` or app-file writes from the
  chat between the gate-2 yes and the return message; **H3** after the return
  message, the change note in the person's words, the « my app is down » line,
  and the acceptance card.

## Records

Intent front matter, one field added:

```
---
status: building
title: Mon suivi fitness
revision: 12
handoff: t-2026-09-22-fitness-01   # present while a ticket is open
---
```

Process endpoint, `GET /<slug>/api/v1/process`:

```json
{
  "step": 4, "label": "I build it",
  "status": "building", "gate": null, "pending": false,
  "handoff": {
    "ticket": "t-2026-09-22-fitness-01",
    "state": "review",
    "since": "2026-09-22T10:41:00Z",
    "over_budget": false
  }
}
```

Ticket (hub table):

```
ticket
  id, workspace, slug
  intent_path, fiche_revision, mockup_path
  branch, pr_url, state, rounds
  builder_run_id, reviewer_run_id
  note                    -- plain-language change note
  landed_version          -- app-runner version number
  budget_ms, started_at
  created_at, updated_at

approval
  ticket_id, by, at, kind   -- merge | acceptance
  note, evidence_url
```

Return message (hidden, like the kickoff):

```
[handoff-return] Ticket t-2026-09-22-fitness-01 landed as version 7.
Change note: « Vous pouvez dicter un repas ; le total du jour
se met à jour tout seul. »
Open step 5: say what changed, say it is displayed, say the
"my app is down" line, then the acceptance card.
```

## The brief the builder receives

`BUILD.md` on the branch, written by the runtime from a template:

1. **Identity.** Workspace, slug, ticket id, the version it starts from, the fiche revision it implements.
2. **The fiche**, whole, at the frozen revision; acceptance lines repeated as a checklist ticked with proof paths.
3. **The mockup** path and the rule: the first screen matches it, in the person's labels.
4. **The boundary.** `capabilities.md` (additive migrations only) and `kit.md` (components and tokens, never bespoke CSS for covered parts).
5. **Delivery checks**, copied from `process.md` phase 4.
6. **Proof.** Screenshots and tool outputs under `.eval-evidence/<ticket>/`, named by acceptance line; a change note of at most three sentences in the person's language.
7. **Earlier reports**, only on a re-ticket after acceptance: the classified bug reports, verbatim.
8. **Rules.** Never talk to the person; a question means stuck with the question written down. Never touch `agent/intents/`. Never publish; the hub publishes.

## Git is the version store; the remote is the option

**Owner decision, 2026-09-22, after the spike.** Each app's history is a real
git repository inside the app's own Durable Object: blobs, trees, commits and
tags, kept by isomorphic-git over a small `fs.promises` adapter on the DO's
SQLite. The versions table becomes that repository. What git has no notion of
stays in the hub: `refs/hub/current` and `refs/hub/previous` are the pointer,
and activate still runs migrate-then-switch. Git is the truth for content; the
pointer is the truth for what serves.

Local, always on:

- Publish = write the tree, commit, tag `v<n>`, move `refs/hub/current`. Undo =
  a new commit restoring the previous tree plus a pointer move; history is
  never rewritten.
- Publish, activate, rollback, versions and files keep their routes and
  shapes; only the storage under them changes. The app-runner tests prove
  nothing observable moved.
- Existing version rows are imported as commits on first boot, oldest first.
- Diff between any two versions comes free: the reviewer's verdict and the
  change note read it.
- The app-runner worker gains the `nodejs_compat` flag (isomorphic-git needs
  Buffer); the agent-flue worker already has it.

Remote, an app option:

- Off by default; the owner switches it on from the app's settings; the first
  `request_build` switches it on by itself.
- The hub creates `boring-app-<workspace>-<slug>`, private, with the agent
  credentials from Vault, and pushes main and the tags. The name is derived.
- After every publish, the push runs in the background after the version is
  written. A publish never fails because the push failed; a missed push is
  retried and shown on the settings page as « history behind by N versions ».
- The colleague has no git tool and no repository name in its prompt.

Spike measurements (fitness app, 16 real versions + 30 synthetic, workerd):

| Operation | Result | Time |
|---|---|---|
| Import 16 versions, commit + tag each | 415 KB stored for 1,960 KB raw | 2.1 s, 47 to 100 ms each |
| Log, diff of two versions | — | 18 ms, 13 ms |
| Push main + 16 tags to GitHub | ok | 25 s, 1.5 s per ref, all network |
| Fetch a commit made on GitHub, fast-forward, read its tree | landed | 1.0 s |
| Push main alone with 30 new commits | ok | 1.9 s |
| Restart workerd | 47 commits still there | — |

Worker bundle 635 KB raw, 127 KB gzipped. Nothing near the CPU limit. Caveats:
fetch needs a remote entry added once; tags push one per round trip, so a long
first export pushes main first and tags in the background.

## Publishing from outside

| Way | Who | How | Status |
|---|---|---|---|
| Merge on `main` | the runner, an engineer, CI, any git client | The hub fetches `main` (poll in v1, webhook later). A commit it did not author is landed as a version: fast-forward, read the tree, validate like any publish (must contain `app/index.js`, agents and viewers validated), tag, move the pointer, sync the colleague's dev filesystem. One second measured. A commit that fails validation is not a version; the failure is a status check on the commit and a line on the settings page. | to build, P3 |
| The hub's `publish` tool over MCP | Claude Code, Codex, any MCP client with a personal token | Exists today. With the remote on, it also becomes a push. The colleague already pulls such a version down when it has none. | exists |
| A CLI from a checkout | an engineer | Not needed: with the remote on, `git push` is the CLI. | by design, none |

**Who wins when both move.** The version row carries the expected current sha,
as the colleague's publish already does. An outside commit and a chat publish
that cross resolve like two chat publishes today: the second is refused with
the current sha, and the hub commits the winner. On a refused outside commit,
the hub opens a branch `rejected/<sha>` and reports it, so nothing pushed is
lost.

**What the person notices.** Nothing new: the app refreshes live, the colleague
sees the new current on its next turn, undo works on it.

## Where it runs

| Piece | Choice for v1 | Why |
|---|---|---|
| Repository | One private repository per app, `boring-app-<workspace>-<slug>`, created by the hub when the remote option turns on; the colleague never sees it | Owner decision 2026-09-22 |
| Runner | A timer on the coding VM polling `GET /api/tickets?state=queued` with a runner token; one worktree per ticket; the builder and reviewer briefs the ship slices use today (Sol builds, Astra reviews), run headless; `gh pr create`; state updates through `POST /api/tickets/:id` | The VM already has the dev container, the CLIs and the Vault credentials |
| Landing trigger | The runner polls merged PRs carrying a ticket id and calls `POST /api/tickets/:id/landed`; the hub fetches the merge commit and lands it | No inbound webhook to secure in v1 |
| Engineer queue | The PR list with labels; the hub's queue page later | Everything the version-2 queue page showed is on the PR |
| Models | Builder on the strongest tier at medium effort; reviewer on a different model family; the colleague stays on the interview tier | The cross-model review finds the round-four bugs |

## Pieces, in build order

| Piece | What | Proof |
|---|---|---|
| P1 · Handoff state | The `handoff` front-matter field; `deriveProcessStatus` returns the object above. Three places assert `handoff === null` today and widen together: `src/process/status.ts`, `shell/src/process.ts`, `shownProcess` in `column-bar.tsx`. The strip shows the second line and the dot. | Fixture tests for both states; strip screenshot at step 4 in both |
| P2 · The tool and the gates | `request_build` in the colleague toolbox writing a ticket row and the front matter; `publish` refusals; the handoff line and return behaviour in `process.md` and `instructions.md`; boring-pm's « set `building` during publication » becomes « set at `request_build` »; checkpoints H1 to H3 | Evaluator run: 24 existing checkpoints green plus H1, H2; a scripted return message makes H3 green |
| P3 · Git as the version store | The SQL filesystem adapter and isomorphic-git in the app-runner DO; import of existing rows as commits; publish → commit + tag + pointer; undo as a restoring commit; routes unchanged; `nodejs_compat` on the worker. Then the remote option: settings toggle, repository creation, background push with retry and the behind-by-N status, fetch of `main` → version, branch and BUILD.md on ticket creation | App-runner suite green with git underneath. Remote on for fitness: one commit per version appears. Publish from chat, see the commit. Push a commit, see the version live and the dev filesystem synced |
| P4 · Runner | The polling script, worktree per ticket, builder then reviewer with the bounded loop, PR creation, state updates, the budget | One real fitness ticket goes queued → needs_human with proof on the PR |
| P5 · Landing and return | The landed call, fetch and activate from the merge commit, the return dispatch, the dot on the Chat button | Two-browser proof: gate-2 yes → handoff line → merge on GitHub → the colleague returns and opens the acceptance card, no publish from the chat in between |
| Later | Rehearsal slot at `/<slug>/preview/<version>`; the hub's queue page with the engineer role; a cloud runner; the return through a channel when no dock is open; a second approval for non-additive migrations the day that rule is relaxed | — |

P1 and P2 are small and land first: from then on the colleague already stops at
gate 2 and says the line, even while tickets are worked by hand from this
session's worktrees. P3 to P5 make the hand disappear.

## Owner decisions

Settled on 2026-09-22: every build is a handoff; git is the version store in
every app (spike passed); one remote repository per app, created automatically
with a fixed prefix, transparent to the colleague, as an app option.

Still open:

1. **The line**: A (« un développeur », one-interlocutor rule) or B (one voice). Recommended: A.
2. **Auto-merge** when the reviewer says safe and CI is green? Recommended: no; revisit after twenty tickets.
3. **Where the repositories live**: the hachej GitHub organization (recommended) or bare repositories on the VM.
4. **The budget** before a ticket is stuck. Proposed: two hours of runner time.
