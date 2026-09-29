# The UI bridge

How an agent drives the page of the application that embeds it, and how the shell that shows the conversation takes the application's skin. Laws: [CHAT-3, CHAT-5](../../packages/chat/INVARIANTS.md), [AGENT-13](../../packages/agent/INVARIANTS.md), and the boundary rules UI-BOUNDARY-1..6 of the hub's [HUB-UI-BOUNDARY](https://github.com/hachej/boring-hub/blob/main/docs/architecture/HUB-UI-BOUNDARY.md). Runnable: [examples/embed-host](../../examples/embed-host).

## 1. Two kinds of tools

| | Backend tool | Page command |
|---|---|---|
| Registered by | the application's server, `createRuntime({ tools })` | a mounted page, `useAgentUi` / `createUiBridge` |
| Runs where | in the runtime's process, with issued `Operations` (files, effect) | on the page, in the person's browser |
| Result | the handler's value; file mutations leave receipts with revisions | a report: `applied`, `proposed`, `committed`, `stale`, `conflict`, `denied`, `unavailable` |
| Authority | admitted per run by the host (`mayRequest`), attributed (`effect`) | none of its own: the page can only do what the session already lets the person do (UI-BOUNDARY-1) |
| Evidence | the receipt row (BORING-2) | the page's word; a `committed` answer must come from the application's backend, whose evidence it carries (UI-BOUNDARY-5) |

A durable effect the agent needs evidence for is a backend tool. A page command is for what only the page can do: open, select, scroll, highlight, prefill, propose. A page command that does end in a durable effect (a "save" button) reports `committed` with the backend's evidence, or `conflict` when the backend refused the observed version; it never invents a receipt.

## 2. The protocol

Everything goes over the wire the chat already speaks, so a page never knows whether the runtime is in the application's process or a separate service.

```
page                                   wire                                   runtime
 │  PUT /threads/:t/ui/:page             │                                        │
 │  { commands:[{name,description,input}], target? }                             │
 │ ───────────────────────────────────────►  registration (memory, per thread)   │
 │  GET /threads/:t/events (live)         │                                        │
 │ ◄──────────────────────────────────────┤                                        │
 │                                        │        model calls tool "open_record"   │
 │                                        │  ◄────  ui_requests row + event        │
 │  { kind:"ui", ui:{ id, run, page, command, input, target, state:"requested" } } │
 │ ◄──────────────────────────────────────┤                                        │
 │  validate: my page? registered? schema? target still shown?                     │
 │  handler(input) → result               │                                        │
 │  POST /runs/:r/ui/:id { page, result } │                                        │
 │ ───────────────────────────────────────►  compare-and-set requested→answered    │
 │ ◄── UiRequestView (answered) ──────────┤  tool returns result to the model      │
 │                                        │  { kind:"ui", ui:{ …state:"answered" } } event
```

- **Registration** is per thread and per page instance (`page`, a random id per mount). It carries the command specs and an optional `target` (`{ kind, id, version? }`: what the page shows). Re-`PUT` when the target changes. `DELETE` on unmount. Registering grants nothing: the run offers a command only if its `agent.md` names it under `ui:` and `Host.allowedTools(actor)` includes the name (AGENT-3). A name equal to a backend tool is refused (409): no shadowing.
- **Request**: the runtime validates the model's arguments against the registered schema (the same schema Flue enforces), records a `ui_requests` row bound to `run`, `page` and the `target` the page reported, and emits it as a `ui` event on the run and the thread. Durable: a page that reconnects replays it and can still answer.
- **Answer**: `POST /runs/:run/ui/:request { page, result }`, from the run's actor (404 otherwise), for the bound page (404 otherwise), once (409 afterwards). `result.outcome` is one of the seven outcomes; `detail` and `evidence` are the page's.
- **Timeout** (`uiTimeout`, default 30 s): the request expires, the tool returns `{ outcome: "unavailable" }`; a late answer is 409.
- **Binding** (UI-BOUNDARY-4): the bridge answers `stale` when the request's target differs from what the page shows now; the runtime ends open requests `unavailable` (result `stale`) when the page re-registers with another target, `unavailable` when the page unregisters, and when the run ends.
- **Receipts**: the tool call leaves a receipt row (`tool: open_record`, `ok`, no revisions) and a `tool` part in the transcript with the page's result. Local interaction is visible; it is never a file revision.

The wire fields are specified in [packages/agent/CONTRACT.md](../../packages/agent/CONTRACT.md).

## 3. In-process, separate service, headless

- **In-process** (the example): the application's server mounts `mountWire` beside its routes; the page talks to `/agent/*`.
- **Separate service**: the agent runs elsewhere; the page talks to that service's wire with the application's fetch (its cookies or a token the host resolves). Nothing changes in the page or the bridge.
- **Headless** (a test, a script, another service): `createUiBridge({ client, thread, commands })` with handlers in Node does exactly what a page does, over the same endpoints; [round-trip.test.ts](../../examples/embed-host/test/round-trip.test.ts) is that. A caller that needs the durable effect and not the page calls the backend tool's operation directly, with the same authority, revision and receipt semantics (UI-BOUNDARY-3).

## 4. The shell

`BoringChat` is one component with three ways to take the application's look:

- **Tokens**: every style is inline and reads `var(--boring-*, default)`. Set the tokens on any ancestor or pass `theme`. The list is in [theme.ts](../../packages/chat/src/theme.ts): font, font-size, fg, bg, muted, border, accent, accent-fg, person-bg/fg, agent-bg/fg, tool-bg, card-bg, danger, radius, gap, bubble-max.
- **Slots**: `slots={{ Message, Text, ToolCall, AskCard, ApprovalCard, Artefact, UiRequest, RunStatus, Composer }}`, each a component receiving the wire's data. Replace one or all.
- **Headless**: `headless` renders bare elements with `data-boring="messages|message|text|tool|ask|approve|artefact|ui|run|composer|error"` and `data-role`, `data-state` attributes, no inline style; the host's stylesheet does the rest.

It injects no stylesheet and sets nothing outside its root (CHAT-5), owns no layout (a flex column filling its parent: put it in a column, a drawer, an iframe), and holds no truth (CHAT-1): reload and it rebuilds from the thread's events.

Ask and approval cards are slots today; decisions (AGENT-5) are not implemented in the runtime yet, so the default cards only render.
