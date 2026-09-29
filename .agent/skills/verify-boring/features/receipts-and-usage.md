# Receipts and usage

What a run touched and what it cost, as records: a receipt for every helper-tool call (actor, thread, run, tool, an input hash, ok or refused, the revisions it produced) and a usage row for every model response (actor, thread, run, agent, model, tokens), both readable after the fact and both handed to the host as they happen. Laws: AGENT-4, AGENT-10, BORING-2.

## Sub-features

- receipt per tool call: `lookup` by the summariser leaves `ok` with `revisions: []` (no file mounts in the example).
- refused receipt: a mutating tool while the host says the run may no longer act, or after a cancel, leaves `ok: false` and the tool throws.
- usage per model response: one row per response with `input`, `output`, `cached`; the host's `onUsage` sees it before the run continues (the example server logs `[usage] agent model in out`).
- attribution: every row names `dev`, the thread and the run; a run's text never says what changed, the receipts do.

## How to get to it (user POV)

A person never sees these. An application reads them from its store or receives them through the Host contract; `boring trace` and `boring log` read the environment's own records.

## Driving it with boring

```bash
node bin/boring.mjs tool summarise '{"note":"Buy milk tomorrow."}' --wait
node bin/boring.mjs trace <id>            # receipts: "ok lookup by dev revisions []"; usage: "fake/summarise in 637 out 32 cached 0 (dev)"
node bin/boring.mjs log --run <id>        # the same, interleaved with the run's transitions and messages
node bin/boring.mjs state                 # counts: receipts, usage
grep usage .cache/env/server.log          # what the host was handed: "[usage] summarise fake/summarise 637 32"
```

Observed: one `lookup` receipt and one usage row per summarise run; the `answer` agent leaves usage and no receipt (it has no helper tools); the digest's two children leave one receipt and one usage row each.

- File revisions in receipts (`revisions` non-empty) need a mount; the example host mounts nothing (deferred in AGENT-4 until the files providers).
- Refused receipts: `test/agent/admission.test.ts` and `stop.test.ts` drive a host that says no; not reachable with the example host.

## Gotchas

- `trace` and `log` read the SQLite records directly (read-only); they are the runtime's truth, not the wire's projection, and they exist only for the environment's own data dir.
- With the fake provider `cached` may equal `input` (the provider reports everything as cached); with a real model the numbers are the provider's.
