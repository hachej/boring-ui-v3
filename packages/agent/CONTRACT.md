# The @boring/agent wire contract

What an application exposes when it mounts `mountWire`, and what a client (a chat, a page, the hub) codes against. Field names here are canonical. The types are in [src/wire.ts](src/wire.ts) and the manifest type in [src/wire/manifest.ts](src/wire/manifest.ts); this file says the same thing once, in prose.

## General rules

- All paths are relative to the mount prefix the application chose (for example `/agent`).
- Bodies and responses are JSON (`content-type: application/json`), except event streams, which are NDJSON (`application/x-ndjson`).
- **Identity** comes from `Host.resolveActor(request)` on every request except the manifest. No body or header field names the actor. `null` from the host is **401** `{ "error": "not authenticated", "status": 401 }`.
- **Ownership**: an actor sees only the threads, runs and jobs they created. Anything else, and any unknown id, agent, job or conversation, is **404**. A run started on another actor's thread is 404 too.
- **Admission**: `Host.mayRequest` answering no is **403**.
- **Validation**: a body that is not a JSON object, a missing `text`, inputs the definition's `buildMessage` refuses, or a job plan naming an undeclared child is **400**.
- **Idempotency**: a request carrying `idempotencyKey` is recorded once per `(actor, key)`. Repeating it with the same request body returns the recorded run, job or message (same `id`); repeating it with a different body is **409**. Cancelling a run that already ended is **409**.
- Errors always have the shape `{ "error": string, "status": number }`.
- **Status values** for runs and jobs: `pending | running | completed | failed | cancelled`. The last three are terminal; a run takes exactly one terminal transition.

## Endpoints

| Method and path | Body | Response |
|---|---|---|
| `GET /.well-known/boring.json` | — | `Manifest` (public, no actor needed) |
| `POST /agents/:agent/runs` | `{ message?, inputs?, thread?, idempotencyKey? }` | **202** `RunView` (status `pending`) |
| `GET /runs/:id` | — | **200** `RunView` |
| `GET /runs/:id/events?cursor=` | — | **200** NDJSON of `Event`, replay after `cursor` then live until the run ends |
| `POST /runs/:id/cancel` | — | **200** `RunView`; 409 once ended |
| `POST /jobs/:job/start` | `{ inputs?, thread?, idempotencyKey? }` | **202** `JobView` with its children |
| `GET /jobs/:id` | — | **200** `JobView` |
| `POST /conversations/:conversation/messages` | `{ text, thread?, inputs?, idempotencyKey? }` | **202** `{ thread: string, run: RunView }` |
| `GET /threads/:id` | — | **200** `{ id, createdAt }` |
| `GET /threads/:id/events?cursor=&live=0` | — | **200** NDJSON of `Event`, replay after `cursor`; live until the client disconnects unless `live=0` |

Body fields:

- `message` (string): the person's text, handed to the agent's `buildMessage` as `inputs.message` and recorded as the person's message on the thread.
- `inputs` (object): validated by the definition's `buildMessage`; for an agent or a job its shape is the manifest's `inputs` schema; for a conversation it is extra context for every message.
- `text` (string, required for a conversation message): the person's message.
- `thread` (string): an existing thread of this actor; omitted, a new thread is created and returned in the view.
- `idempotencyKey` (string): see the rules above.

## Views

```
RunView  { id, thread, agent, job?, status, output?, error?, model?, attempts, createdAt, endedAt? }
JobView  { id, definition, thread, status, children: RunView[], output?, error?, createdAt, endedAt? }
```

`output` is the validated output: the output tool's arguments for a tool agent, the markdown string for a markdown agent, the job's `collect` result for a job. `error` is a readable sentence. `attempts` counts output attempts (1 when the first was valid). `model` is `provider/model` as run.

## Events

One JSON object per line. Every event has a `cursor` (an opaque string; numerically increasing within a store) and a `kind`:

```
{ cursor, kind: "message", message: { id, role: "person" | "agent", run?, parts: Part[], at } }
{ cursor, kind: "run", run: RunView }
{ cursor, kind: "decision", decision, answered }          (reserved; decisions are not implemented yet)
Part = { type: "text", text } | { type: "tool", name, input, state, output?, error? } | { type: "ask" | "approve" | "artefact", ... }
```

Cursor semantics: `?cursor=` returns events strictly after that cursor; omit it for everything. Events are durable and replaying twice yields the same lines; a client rebuilds its whole state from them and stores nothing else. A run's stream is, in order: the `run` event at creation (`pending`), the person's `message`, `run` (`running`), the agent's `message` (the answer or the failure), then the terminal `run` event that closes the stream. Live delivery is in-process; after a reconnect, replay from the last cursor seen.

## Manifest

```
{
  protocol: 1, name, version, description?,
  agents: [ { name, title, description?, model, effort?, output: "tool" | "markdown", inputs: InputSchema,
              outputs: { schema: JSONSchema } | { <name>: description }, tools: string[], invoke: "POST /agents/<name>/runs" } ],
  jobs: [ { name, title, description, children: string[], inputs: InputSchema, outputs: { <name>: description }, invoke } ],
  conversations: [ { name, title, description, agent, inputs: InputSchema, invoke } ],
  endpoints: { manifest, startRun, run, runEvents, cancel, startJob, job, say, thread, threadEvents }
}
InputSchema = { type: "object", properties: { <name>: { type: "string" | "number" | "integer" | "boolean" | "array" | "object",
                description?, enum?, items?: { type }, default? } }, required: string[] }
```

`inputs` is always a JSON-schema object so a client can build a form from it. It is derived from the definition's `inputs:` front matter: a plain `name: description` line is `{ type: "string", description }`; a `name: { type, description, required, enum, items, default }` map declares the rest. `outputs` is the output tool's JSON schema for a tool agent and a `name: description` map for a markdown agent. `model` is the definition's default; the application may run another. Nothing in the manifest is a credential, a prompt or a record.
