# Requests (agent work)

Asking for work: the assistant calls `request_work`; the host plans it into a parent Job with one child per app agent (`agents.json`), each agent runs on Flue with only its declared tools, and the parent completes only from what the children committed. Laws: JOB-2, JOB-3, JOB-5, ACTOR-2, ACTOR-3, PLATFORM-1.

## Sub-features

- plan: a request the app serves becomes a parent Job with its children; anything else is not a request.
- admission: host policy decides whether this person may request this work.
- agent-execution: each agent sees the instructions file and the record's input at an exact revision, and only its tools.
- completion: the parent completes from the children's accepted outputs; the chat reports the result.
- cancel: Stop work cancels the parent and every child before its next write.
- failure: one agent failing fails the request, names the step, and keeps the others' work.
- stale-input: an input that changed after the request was planned fails the step instead of drafting from old text.

## How to get to it (user POV)

With a note open that has a dictation, ask the chat "draft the open note". The effect log shows the request and three agents running; the cards fill in; the chat says it is done. Stop work (chat pane header) cancels a running request.

## Driving it with boring

```bash
node bin/boring.mjs env up --seed note
node bin/boring.mjs send "Draft the open note from its dictation." --wait
node bin/boring.mjs log | grep -E "request|writer"
node bin/boring.mjs trace <request job id>        # each agent's prompt, tool calls, reply
```

- Cancel: `env up --seed note --think-ms 3000`, `send "draft it"`, then `click "#cancel"` (or `curl -X POST <url>/api/cancel -d '{"job":"<id>"}'`), `wait-settle`. Expect the request and its children `cancelled`, and no agent write after the cancel in `log`.
- Empty path: `--seed note-without-dictation`, ask for a draft. Expect the request refused or the agents to write nothing and the request to fail visibly, never three invented sections.
- Real model: repeat with `--model codex`; judge the cards against the dictation and read `trace` for what each agent was given.

## Gotchas

- Agents race on the same record; a stale save is retried by the agent. Several `app db → rev` lines per request are expected.
- `trace` works for Jobs run since the hub started; conversations persist in the data dir but the Job-to-conversation index is in memory.
- A request's outputs are the database at its last revision, not one ref per agent.
