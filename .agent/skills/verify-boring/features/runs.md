# Runs

`POST /agent/agents/:agent/runs`: one agent's run from inputs (or a message), recorded before it starts, ending exactly once in `completed`, `failed` or `cancelled`, with a validated output or a readable error. Laws: AGENT-1, AGENT-3, AGENT-6, AGENT-11.

## Sub-features

- start: `{ inputs, message?, thread?, idempotencyKey? }` → 202 `RunView` with status `pending`; `model` names what will run.
- structured output: a `tool` agent (`summarise`) must call its output tool; the definition's `validate` runs inside it; a refusal goes back to the model for a repair (`attempts` counts).
- markdown output: a `markdown` agent (`answer`) answers in text; `output` is the string.
- helper tools: the model sees the declared helper tools intersected with what the host allows (`lookup` for `summarise`); each call leaves a receipt.
- failure: a bad input is 400 before anything is recorded; an output that never validates fails the run with the validator's message.
- cancel: `POST /runs/:id/cancel` → the run ends `cancelled` before its next effect; once ended, 409.
- view and events: `GET /runs/:id`; `GET /runs/:id/events` replays then follows until the terminal event.
- reading images (AGENT-15): `runtime.readImages(actor, { images, instruction, model })` is an in-process call, not a wire endpoint; its run (agent `read-images`, model `fake/read-images` with the fake access) is listed and traced like any other. The example app does not call it: `test/agent/images.test.ts` drives it (admission, metering, cancel, refusals); an application that uses it proves the path on its own instance.

## How to get to it (user POV)

A client requests a run and follows its events; the hub does this from the manifest. In the example page a person only reaches runs through the conversation.

## Driving it with boring

```bash
node bin/boring.mjs tool summarise '{"note":"Buy milk tomorrow."}' --key r1 --wait
node bin/boring.mjs runs                              # newest first: id, agent, status, job, created
node bin/boring.mjs run <id>                          # the view (output { title, summary, tags }) and its events
node bin/boring.mjs trace <id>                        # + input, receipts (lookup ok by dev), usage (fake/summarise)
node bin/boring.mjs cancel <id>                       # 409 once ended: "already ended (completed)"
node bin/boring.mjs tool summarise '{}'               # 400: summarise: note is required
node bin/boring.mjs tool nope '{}'                    # 404: unknown agent
```

Observed: `attempts: 1`, `model: fake/summarise`, output `{ title: "A scripted title", summary: "A scripted summary of the note.", tags: ["fake"] }`; the agent's message on the thread carries the output as text (`**A scripted title**` …) after a `[tool]` part for the lookup call.

- Cancel mid-run: the fake model answers instantly, so a running run cannot be caught from the CLI; `test/agent/stop.test.ts` drives a slow script and proves no effect after the cancel. With a real model, `tool summarise ... ` without `--wait`, then `cancel <id>` immediately: expect `cancelled` and no usage row after the cancel.
- Repair path: needs a model that answers badly first; `test/agent/repair.test.ts` scripts it.

## Gotchas

- `tool` is the CLI name for "request one agent's run with these inputs"; the agent's own helper tools (`lookup`) are called by the model, never by the CLI.
- `--wait` returns the 202 view (status `pending`) plus `settled`; read the final status from `run <id>` or `settled.latest`.
- A run started by a job shows `job: <id>` and is listed by `runs` like any other.
