# Effect log and traces

Every accepted change is one row in the platform's effect log, written in the same transaction as the change: Job transitions, database revisions, file revisions, each with the Job and Actor that made it. Laws: PLATFORM-3, FS-7, JOB-3.

## Sub-features

- log-pane: the effect log under the chat, live.
- attribution: every write names its Actor (person, agent, host) and Job.
- job-trace: a request's Jobs and each agent's Flue conversation.

## How to get to it (user POV)

Watch the Effect log panel under the chat while working. There is no user-facing trace; agents use `boring trace`.

## Driving it with boring

```bash
node bin/boring.mjs log --since 0
node bin/boring.mjs log --job <request job id>
node bin/boring.mjs trace <request job id>
```

- Assert attribution: every `app db → rev` line during a request names one of its child Jobs; every line from the app pane names a `pane-` Job and the person.

## Gotchas

- Revisions 1–2 are the host applying migrations at start (`by hub in host`).
- The log is append-only; `--since` takes a cursor from an earlier line.
