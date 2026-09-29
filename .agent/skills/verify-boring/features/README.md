# Boring feature map

Behavior-level inventory of the library as a person and a client meet it through the example app (`examples/notes`): a chat page over one conversation, a wire that starts runs and jobs and replays threads, a manifest, and the records under them (runs, events, receipts, usage). Agents use this map to decide what to drive and what counts as evidence; people use it as the regression checklist. An application of your own maps onto the same surfaces.

## Baseline preconditions

- `boring doctor` is clean for what the change needs: the environment is running, the port answers from its own pid, the build is **not STALE** (restart with `boring env up --restart` after any source change), the browser is up when you drive the page.
- Start from a seed rather than driving your way there: `boring env seeds` lists them; they go in through the wire.
- The fake model by default: deterministic and instant. The answer agent replies `Scripted answer to: <question>`; the summariser calls `lookup` once, then saves `{ title: "A scripted title", summary: "A scripted summary of the note.", tags: ["fake"] }`.
- Identity is the app's dev auth: every call is actor `dev` unless you pass `x-dev-actor` yourself. The wire is `<url>/agent`.
- The page's selectors: `input[aria-label=message]`, `button[type=submit]`, `[data-boring-chat] li[data-role=person|agent]`, `[data-boring-chat] li[data-run] button` (stop). The thread id lives in `location.hash` as `#thread=<id>`.
- Agent work is asynchronous. Wait on observable end states with `boring wait-settle` (records) and `boring wait-for <selector>` (DOM), never fixed sleeps.
- `eval` reads state after the user path ran. It never performs the action under test.

## Proof and skip reporting

The relevant feature file defines the coverage set. For a change that spans surfaces, also read the journeys below.

- Drive the production path: the wire and the page. Do not call library functions to fake a step.
- Exercise every reachable entry point the file lists, and the success, refusal, empty, cancel and persistence paths the change can affect.
- Show the trigger and the stable end state: `wait-settle` output, `trace`, `chat`, `snapshot` or `screenshot` after the action.
- Verify side effects, not pixels: receipts and usage (`trace`), the records after a restart (`runs`), two replays that are identical (`chat` twice).
- The fake model counts only for library behavior. A change to a prompt, a validator's wording or anything the model decides needs a real-model run.
- When a path is unreachable, name it, say what blocks it, and cover the closest real path.

## Full sweep

Walk this map top to bottom for a broad regression, then finish with the journeys.

- [manifest](manifest.md): what the app publishes, the schemas a client builds forms from.
- [wire](wire.md): identity, ownership, idempotency, errors: the rules every endpoint obeys.
- [conversations](conversations.md): a message, a thread, history, replay by cursor.
- [runs](runs.md): one agent's run: pending to terminal, validated output, cancel.
- [jobs](jobs.md): predeclared children, completion from children, refusals.
- [receipts-and-usage](receipts-and-usage.md): what a run touched and what it cost, attributed.
- [chat-page](chat-page.md): the page in a browser: send, reply, stop, reload.

## Multi-surface journeys

- **Page then wire.** Send from the page, then `chat`: the events the page rendered are the ones the wire replays; `trace` the run the page started.
- **Restart persistence.** After any journey, `env up --restart --keep-data`, then `runs` and `chat`: every run keeps its status and the thread replays unchanged (AGENT-1, CHAT-1).
- **Two actors.** Anything created as `dev` is 404 for `curl -H "x-dev-actor: other"` on the same id (CHAT-4, AGENT-8).
- **Real model pass.** Repeat the conversation and the digest with `--model openrouter/...`; judge the answers against the notes and read `trace` for attempts and usage.

## Entry contract

Every feature file uses the same four H2s:

1. `Sub-features`
2. `How to get to it (user POV)`
3. `Driving it with boring`
4. `Gotchas`

A behavior with no entry is a gap in this skill; add it in the same change that adds the behavior. Every "Driving it" block here was run before it was written; the evidence of the last full sweep is under `.cache/evidence/`.
