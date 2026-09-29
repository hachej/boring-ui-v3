# Jobs

`POST /agent/jobs/digest/start`: a job plans predeclared children (one `summarise` run per note), starts them under itself, and completes only from their completed outputs, collected in order. Laws: AGENT-12, AGENT-1.

## Sub-features

- start: `{ inputs, thread?, idempotencyKey? }` → 202 `JobView` with its children already recorded (`children[].job` names the parent).
- predeclared: a plan naming an agent outside `JOB.md`'s `children:` is 400 before anything is recorded; the example's plan can only name `summarise`.
- completion: `completed` with `output.summaries` in the notes' order once every child completed; a failed or cancelled child fails the parent with the child's error.
- empty plan: `{ notes: [] }` is 400 (`notes: at least one note is required`).
- view: `GET /jobs/:id` with the children's current views.

## How to get to it (user POV)

A client (the hub) starts a job from the manifest and polls or follows its children. The example page does not start jobs.

## Driving it with boring

```bash
node bin/boring.mjs env up --seed digested            # one completed digest of the two example notes
node bin/boring.mjs job digest '{"notes":["a","b"]}' --wait
node bin/boring.mjs runs | head -3                    # two summarise runs with job <id>
node bin/boring.mjs job digest '{"notes":[]}'         # 400
node bin/boring.mjs job digest '{"notes":["a"]}' --key d1 --wait && node bin/boring.mjs job digest '{"notes":["a"]}' --key d1   # same job id
```

Observed: the 202 view lists two children `running` under `job`; after `wait-settle`, `GET /jobs/<id>` (the `--json` output of `smoke`, or `curl`) shows `status: completed`, both children `completed`, `output.summaries.length === 2`; `state` counts `jobs: { completed: 1 }`.

- Failure path: needs a child that fails; with a real model, a note the summariser cannot title within 80 characters after two repairs fails the child and the parent names it. With the fake model, `test/agent/wire.test.ts` covers the refusal of an undeclared child.
- Cancel path: cancelling a child (`cancel <child>`) while running ends the parent `cancelled`; not reachable with the instant fake model from the CLI.

## Gotchas

- `boring job` is CLI shorthand for `POST /jobs/:job/start`; the view it prints is the 202 one (children `running`); read the end state with `curl $U/agent/jobs/<id>` or `runs`.
- Children share the job's thread; `chat` on that thread shows every child's messages interleaved.
