# @boring/agent

A standard, app-embeddable agent runtime. An application owns and runs its agents in its own process: it defines them as files, runs them on Flue with receipts, usage metering, validated outputs and repair, exposes them over one HTTP wire, and publishes a manifest another system can read to discover them. The application keeps its database, its auth and its deploy; the [Host contract](src/index.ts) is the only way authority enters.

Laws: [INVARIANTS.md](INVARIANTS.md). Evidence: [VERIFY.json](VERIFY.json). Contract: [src/index.ts](src/index.ts). Wire types for the chat: [src/wire.ts](src/wire.ts). Sample application: [examples/notes](../../examples/notes).

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

`agent.md` front matter: `name`, `title`, `model` (provider/model, a default the app may override), `effort`, `max_tokens`, `output: tool | markdown`, `helper_tools: [names]`, `inputs:` and `outputs:` blocks of `name: description` for the manifest. A validator throws `OutputError`; its message goes back to the model for a repair (twice by default).

## Run and expose

```ts
import { createRuntime, loadApp, mountWire } from "@boring/agent";

const app = await loadApp("./");                       // the registry
const runtime = await createRuntime({ host, app, tools, store: "./data/agent.sqlite", model: { kind: "openrouter", apiKey } });
const wire = mountWire({ host, runtime, basePath: "/agent" });   // wire.fetch(request) → Response
```

| Endpoint | Does |
|---|---|
| `GET /.well-known/boring.json` | The manifest: app, agents (inputs, output schema, model, tools), jobs (children), conversations, endpoints |
| `POST /agents/:agent/runs` | Request work: `{ message?, inputs?, thread?, idempotencyKey? }` → run (202); same key = same run |
| `GET /runs/:id` | Status, output, error, attempts |
| `GET /runs/:id/events?cursor=` | NDJSON: replay after the cursor, then live until the run ends |
| `POST /runs/:id/cancel` | Stop: no further effect commits; committed receipts stay |
| `POST /jobs/:job/start` | `{ inputs?, thread?, idempotencyKey? }` → job with its children (202) |
| `GET /jobs/:id` | The job and its children |
| `POST /conversations/:conversation/messages` | `{ text, thread?, inputs?, idempotencyKey? }` → `{ thread, run }` (202) |
| `GET /threads/:id`, `GET /threads/:id/events?cursor=&live=0` | The thread and its replayable events |

Identity comes from `Host.resolveActor(request)` on every request. Model access (`fake` script, `openrouter` key, `openai-codex` credentials file) is given at mount time and never stored.

## What exists now

Definition loaders with front-matter validation; the Flue-backed runtime (one generic Flue agent per run, output tool validated inside the tool with `terminate`, helper tools, repair loop, `useResponseFinish` metering, durable abort); the SQLite store (threads, runs, jobs, events, usage, receipts, idempotency keys); the Hono wire and the manifest; admission through the Host; interrupted runs failed on restart.

## Deferred

Ask and approval rows (AGENT-5); resuming an interrupted run against recorded inputs (the lease and receipt-replay protocol); file revisions in receipts and mounts (waits for the `files` providers; `Operations.files` routes to `host.mounts` today); per-model-turn usage rows (one row per Flue response today); Express adapter and the dev host `boring env up` launches.
