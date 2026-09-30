# @boring/agent

A standard, app-embeddable agent runtime. An application owns and runs its agents in its own process: it defines them as files, runs them on Flue with receipts, usage metering, validated outputs and repair, exposes them over one HTTP wire, and publishes a manifest another system can read to discover them. The application keeps its database, its auth and its deploy; the [Host contract](src/index.ts) is the only way authority enters.

Laws: [INVARIANTS.md](INVARIANTS.md). Evidence: [VERIFY.json](VERIFY.json). Contract: [src/index.ts](src/index.ts). **The wire contract clients code against: [CONTRACT.md](CONTRACT.md)** (endpoints, bodies, views, events, cursors, status codes, manifest schema). Wire types for the chat: [src/wire.ts](src/wire.ts). Sample application: [examples/notes](../../examples/notes).

## Define

```
boring.json                         { name, version, description }
agents/<name>/agent.md              front matter + system prompt
agents/<name>/tool.json             the output tool's JSON schema (output: tool)
agents/<name>/rules.md              editable defaults, handed to buildMessage as `rules`
agents/<name>/index.mjs             buildMessage(input), validate(output), asText(output), optional tools()
jobs/<name>/JOB.md                  front matter (children: [...]) + description
jobs/<name>/index.mjs               plan(input) → [{ agent, input }], collect(results, input) → output
conversations/<name>/CONVERSATION.md   front matter (agent, history) + description
conversations/<name>/index.mjs      optional context(input) → input for the agent
```

`agent.md` front matter: `name`, `title`, `model` (provider/model, a default the app may override), `effort`, `max_tokens`, `output: tool | markdown`, `helper_tools: [names]`, `files:` (`[read]`, `[read, write]` for every mount the host offers, or a block of `<mount>: read | [read, write]` lines; the needs become grants admitted per run and offer the file tools `read_file`, `write_file`, `list_files`, `stat`, `remove_file`, which address `/<mount>/<path>`), `ui: [names]` (page commands the agent may request of a page that registered them), an `inputs:` block (`name: description`, or `name: { type, description, required, enum, items, default }`) that becomes the manifest's JSON-schema `inputs`, and an `outputs:` block of `name: description` for markdown agents. A validator throws `OutputError`; its message goes back to the model for a repair (twice by default).

## Run and expose

```ts
import { createRuntime, loadApp, mountWire } from "@boring/agent";

const app = await loadApp("./");                       // the registry
const runtime = await createRuntime({ host, app, tools, store: "./data/agent.sqlite", model: { kind: "openrouter", apiKey } });
const wire = mountWire({ host, runtime, basePath: "/agent" });   // wire.fetch(request) → Response
```

| Endpoint | Does |
|---|---|
| `GET /.well-known/boring.json` | The manifest: app, agents (inputs as JSON schema, output schema, model, tools), jobs (children), conversations, endpoints |
| `POST /agents/:agent/runs` | Request work: `{ message?, inputs?, thread?, idempotencyKey? }` → run (202); same key = same run |
| `GET /runs/:id` | Status, output, error, attempts |
| `GET /runs/:id/events?cursor=` | NDJSON: replay after the cursor, then live until the run ends |
| `POST /runs/:id/cancel` | Stop: no further effect commits; committed receipts stay |
| `POST /jobs/:job/start` | `{ inputs?, thread?, idempotencyKey? }` → job with its children (202) |
| `GET /jobs/:id` | The job and its children |
| `POST /conversations/:conversation/messages` | `{ text, thread?, inputs?, idempotencyKey? }` → `{ thread, run }` (202) |
| `POST /threads`, `GET /threads/:id`, `GET /threads/:id/events?cursor=&live=0` | An empty thread; the thread and its replayable events |
| `PUT/DELETE /threads/:id/ui/:page`, `GET /threads/:id/ui`, `POST /runs/:id/ui/:requestId` | The page-command bridge: a page's commands on a thread, and its one answer per request ([docs/design/ui-bridge.md](../../docs/design/ui-bridge.md)) |

Identity comes from `Host.resolveActor(request)` on every request. `Host.mounts(actor)` returns the mount table (`code`, `workspace`, `shared`, `mnt/<name>` → a `@boring/files` provider); tools reach files only through the run's grants and the router. Bodies, views, events and status codes are specified once in [CONTRACT.md](CONTRACT.md). Model access (`fake` script, `openrouter` key, `openai-codex` credentials file) is given at mount time and never stored.

Other runtime options an application usually sets:

- **`models`** is a record by agent name, or a function `(agent) => ({ model?, effort? })` asked at every run, so a settings page can change models without a restart.
- **`language`** (`"en"` or `"fr"`) and **`phrases`** choose the words the library writes to models and into records (AGENT-14). A failed run carries a `failure` kind next to its `error` sentence.
- **`runtime.children(actor, job)`** lists a job's runs, and **`runtime.wait(actor, run)`** resolves when a run ends, both checked against the owner.
- Usage rows carry the provider's **`cost`** next to the tokens.
- **`runtime.readImages(actor, { images, instruction, model, effort?, thread?, signal? })`** reads images (`{ data: Uint8Array, mimeType }`, PNG, JPEG, WebP or GIF) with one model call each through the same model access, and resolves with `{ run, readings }`, one `{ text }` or `{ error }` per image (AGENT-15). It is a run of `read-images`: admitted by `mayRequest`, metered per call, cancellable; the bytes are never stored. A model whose catalog entry takes no images is refused (400) before any call. In-process only, not on the wire.

## What exists now

Definition loaders with front-matter validation (`files:`, `ui:` included); the Flue-backed runtime (one generic Flue agent per run, output tool validated inside the tool with `terminate`, helper tools, file tools over the host's mounts with grants and receipts, page commands as `ui` tools, repair loop, `useResponseFinish` metering, durable abort); the SQLite store (threads, runs, jobs, events, ui requests, usage, receipts, idempotency keys); the Hono wire and the manifest; admission through the Host; interrupted runs failed on restart.

## Deferred

Ask and approval rows (AGENT-5); resuming an interrupted run against recorded inputs (the lease and receipt-replay protocol); per-model-turn usage rows (one row per Flue response today); Express adapter and the dev host `boring env up` launches.
