# Exploration: sharing one app with a consumer (fork, use-mode colleague)

Status: exploration, 2026-09-22. Nothing here is built. Owner's framing:
"make our app shareable to a consumer that will just use the app, no need
for update for now" -- then, sharpened: the consumer uses ONE published app
(fitness) AND talks to the Colleague as a *user* of that app, never as its
builder. Owner's simplification question: "could we just fork another app?"
Answer: yes, and it is most of the work.

## What "consumer" means here

Not the owner of a Colleague who builds apps (that is the product as it
stands), and not an anonymous viewer of a public page (unsupported: sharing
has one implemented role, `editor`; `viewer`/`public` are reserved names,
and published apps run on the shell's authenticated origin). The consumer is
a **known person, with an identity, who owns a copy of one app and gets a
colleague that only helps them use it.**

## Why a fork already does most of it

Three properties of the current design, none of them added for this:

1. **Workspaces isolate everything.** App data is one `AppHome` Durable
   Object per `{workspace}--{slug}`; the conversation id is
   `{workspace}:{slug}`. A consumer with their own workspace has their own
   fitness data and their own chat. Nothing is shared with the owner.
2. **Identity is solved on the Seneca host.** Cloudflare Access asserts the
   email; `resolveIdentity` slugifies it into a workspace. Adding a consumer
   is adding an email to the Access policy. (`docs/history/deploy-seneca.md`.)
3. **The published tree carries the colleague's profile.** `app-home.js`
   serves `agent/instructions.md`, `agent/process.md` and
   `agent/capabilities.md` from the current version, and `colleague.ts`
   prefers `current.instructions ?? code.read(...)` over its own seed. So a
   fork whose published tree contains a use-mode profile gets a use-mode
   colleague with **zero code changes**. `app/tools.json` tools
   (`app_fitness_read`, `app_fitness_propose`, ...) plus `show` / `exec_ui`
   / `get_ui_state` are already the "use" surface the colleague needs.

## The fork recipe (config only)

1. A consumer variant of the fitness tree (`apps/fitness-consumer/`, or the
   same tree with an `agent/` folder swapped at publish time) containing:
   - `agent/instructions.md` -- "you help this person use the app; you never
     change it; for change requests say who to ask".
   - `agent/process.md` -- one line, replacing the five-phase BUILD process.
   - `agent/capabilities.md` -- what the app does; plain refusal for changes.
   - one `agent/intents/*.md` with a done status. `isDiscoveryPhase()`
     (`src/process/status.ts`) returns true when there are NO intents, which
     would run the discovery interview (and the discovery model) on the
     consumer's first message.
2. Add the consumer's email to the Cloudflare Access policy.
3. Publish the fork into their workspace with `APP_RUNNER_TOKEN` -- the same
   operator move the Seneca deploy used to publish `fitness` into `default`
   (`scripts/reseed.mjs` / `scripts/import-wip-app.mjs` are the nearest
   existing scripts; a `provision-consumer` wrapper is the obvious addition).
4. Send them the direct app URL, `/<slug>`, not the root page.

"No update for now" falls out naturally: each consumer's app is an
independent copy pinned at the version they were given. A later upgrade is
republishing into each workspace.

## What the fork does NOT close

- **Build tools stay mounted.** The toolbox (`agents/colleague-toolbox.ts`)
  still offers `publish`, `undo`, `scaffold_app`, `versions`, `logs`, the
  file tools and `bash`. The profile tells the colleague not to use them;
  that is a prompt, not a boundary. A determined consumer can talk their
  colleague into rewriting *their own copy*. Harmless for a trusted friend;
  the one thing worth code for a stranger.
- **Base instructions are hardcoded** in `colleague.ts` and describe the
  filesystem, publish and scaffold; the published profile is appended after.
  A steering cost, not a functional gap.
- **Root page** (`/`) is the builder's app list with create + rollback.
  Avoided by linking straight to the app.
- **Model cost is the owner's.** The meter records per user
  (`docs/ARCHITECTURE.md`, "meter") but enforces no quota. Put consumers on
  OpenRouter, never the owner's Codex OAuth subscription (terms), and add a
  per-workspace cap before the second consumer.
- **Same-origin app code.** The consumer's app is the owner's code running
  under the consumer's identity. Fine as long as the consumer cannot publish;
  a real problem the day a consumer can edit.

## The one code change, if and when needed: a real use mode

A dozen lines in the toolbox factory: when the published profile declares
use mode (a front-matter flag in `agent/instructions.md`, or a marker file in
`agent/`), return only `app_*` tools, `show`, `exec_ui`, `get_ui_state` and
transcribe. Since the flag lives in the published tree and the consumer has
no `publish` tool, it cannot be flipped from the conversation. Optional
extras: hide create/rollback on `/` for use-mode workspaces; a per-workspace
model-usage cap.

Rejected as over-engineering for this consumer: a hub-side mode flag on the
app registration (the published tree already is the truth); a self-hosted
image (this consumer should never see Docker or an API key -- see below);
a `viewer` role (different problem: anonymous access to a public page).

## Alternatives considered

- **Host it and just invite them (no fork).** Works for "someone gets their
  own Colleague and builds their own apps". Not this consumer: they would
  land in an empty workspace with a builder.
- **Self-hosted image.** The image is already self-contained (one process,
  one port, one volume; Seneca was deployed via `docker save | docker load`)
  and would need ~a day: first-boot secret generation into `/data`, a
  default `SINGLE_USER_ID`, a clean compose file without this box's network
  hacks, an image on a registry. Right answer for a consumer who must own
  their data and machine; wrong for one who should just open a URL.

## Recommendation

Fork first, this week, with the three profile files and the intent file;
try it with one real consumer. Add the roster filter only if the colleague
drifts into building or the consumer stops being someone the owner trusts.
That filter *is* the whole "use mode" feature, and the fork lets it wait.
