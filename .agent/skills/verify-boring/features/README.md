# Boring feature map

Behavior-level inventory of the library as a person meets it through an example app: a chat, the app's own page, the file tree, and the receipts under them. Agents use this map to decide what to drive and what counts as evidence; people use it as the regression checklist.

The per-surface files are written with the examples (step 4 of [the roadmap](../../../../docs/architecture/ROADMAP.md)). Until then this README fixes the contract every file follows.

## Baseline preconditions

- `boring doctor` is clean for what the change needs: the environment is running, the port answers from its own pid, the build is **not STALE** (restart with `boring env up --restart` after any source change), and the browser is up when you drive the page.
- Start from a seed rather than clicking your way there: `boring env seeds` lists them. Seeds use the same app tools a person uses.
- Scripted model by default (deterministic, instant). `--think-ms n` slows the scripted agent so races are drivable.
- App-page selectors take the prefix `app:`. Prefer ids and ARIA roles the app exposes.
- Agent work is asynchronous. Wait on observable end states with `boring wait-settle`, never fixed sleeps.
- `eval` reads state after the user path ran. It never performs the action under test.

## Proof and skip reporting

- Drive the production path: the chat on the wire, the app's own page and tools, the host's routes. Do not call library functions to fake a step.
- Exercise every reachable entry point the file lists, and the success, cancel, error, empty and persistence paths the change can affect.
- Show the trigger and the stable end state: `wait-settle` output, `log`, `snapshot` or `screenshot` after the action.
- Verify side effects, not pixels: the receipts (who wrote which revision in which run), `trace` of the run, `tool read_*` after a reload or restart.
- The scripted model counts only for library behavior. A change to instructions or anything the model decides needs a real-model run.
- When a path is unreachable, name it, say what blocks it, and cover the closest real path.

## Surfaces to map

- chat: send, streaming reply, tool calls, questions, approvals, cancel (CHAT-1 to CHAT-4, AGENT-5, AGENT-6).
- files: the tree, an edit by the person, an edit by the agent, a conflict (FILES-1 to FILES-7).
- runs: asking for work, declared tools only, completion, failure, stop (AGENT-1 to AGENT-4).
- receipts: what changed, who changed it, in which run; usage per run (BORING-2, AGENT-10).
- page commands: the app's registered commands, refused ones (CHAT-3).
- multi-surface journeys: a person edits while the agent writes, cancel mid-run, restart persistence (BORING-4).

## Entry contract

Every feature file uses the same four H2s:

1. `Sub-features`
2. `How to get to it (user POV)`
3. `Driving it with boring`
4. `Gotchas`

A behavior with no entry is a gap in this skill; add it in the same change that adds the behavior.
