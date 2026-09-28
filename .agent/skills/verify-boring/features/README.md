# Boring feature map

Behavior-level inventory of the hub as a person uses it: a chat on the left, one app on the right, an effect log under the chat. Agents use this map to decide what to drive and what counts as evidence; people use it as the regression checklist. It describes the fixture app in `test/fixtures/apps/notes` (notes with a dictation and three sections written by three agents); an app of your own maps onto the same surfaces.

## Baseline preconditions

- `boring doctor` is clean for what the change needs: the environment is running, the port answers from its own pid, the build is **not STALE** (restart with `boring env up --restart` after any source change), and the browser is up when you drive the page.
- Start from a seed rather than clicking your way there: `boring env seeds` lists them (`empty`, `note`, `note-without-dictation`, `drafted`). Seeds use the same app tools a person uses.
- Scripted model by default (deterministic, instant). `--model codex` for the real model; `--think-ms n` slows the scripted agents so races are drivable.
- App-pane selectors take the prefix `app:` (the app is an iframe). Prefer ids and ARIA roles the app exposes; the fixture exposes `#newTitle`, `#title`, `#saveTitle`, `#dictation`, `#saveDictation`, `#cards`, `#msg`.
- Agent work is asynchronous. Wait on observable end states with `boring wait-settle`, never fixed sleeps.
- `eval` reads state after the user path ran. It never performs the action under test.

## Proof and skip reporting

The relevant feature file defines the coverage set. For a change that spans surfaces, also read `multi-surface-journeys.md`.

- Drive the production path: the chat on the Flue wire, the app's own page and tools, the host's routes. Do not call platform functions to fake a step.
- Exercise every reachable entry point the file lists, and the success, cancel, error, empty and persistence paths the change can affect.
- Show the trigger and the stable end state: `wait-settle` output, `log`, `snapshot` or `screenshot` after the action.
- Verify side effects, not pixels: the effect log (who wrote which revision in which Job), `trace` of the agents' conversations, `tool read_*` after a reload or restart.
- The scripted model counts only for platform behavior. A change to prompts, instructions or anything the model decides needs a `--model codex` run.
- When a path is unreachable, name it, say what blocks it (credential, tool, missing driver support), and cover the closest real path.

## Full sweep

Walk this map top to bottom for a broad regression, then finish with `multi-surface-journeys.md`.

- [app-pane](app-pane.md): records in the app — create, dictate, rename; revision conflicts; schema refusals.
- [chat](chat.md): the chat — send, streaming reply, tool calls, abort; the panel bundle or the minimal client.
- [requests](requests.md): asking for work — plan, agents, completion, cancel, failure.
- [effect-log](effect-log.md): what changed, who changed it, in which Job; tracing an agent's conversation.
- [approval](approval.md): approve the current revision; later edits are not covered.
- [multi-surface-journeys](multi-surface-journeys.md): edits during agent work, cancel mid-draft, restart persistence.

## Entry contract

Every feature file uses the same four H2s:

1. `Sub-features`
2. `How to get to it (user POV)`
3. `Driving it with boring`
4. `Gotchas`

A behavior with no entry is a gap in this skill; add it in the same change that adds the behavior.
