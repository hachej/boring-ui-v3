# Conversations

`POST /agent/conversations/questions/messages`: one message is one run of the `answer` agent with the notes and the last six turns as context, on a thread the actor owns. The thread is the durable record; the chat page and `boring chat` both rebuild from its events. Laws: CHAT-1, AGENT-1, BORING-4.

## Sub-features

- say: `{ text, inputs, thread? }` → 202 `{ thread, run }`; a new thread when none is given.
- history: the agent sees the earlier turns of the thread (six for `questions`); a second message continues the same thread.
- replay: `GET /threads/:id/events?cursor=&live=0` returns the same lines every time; a cursor skips what was seen.
- empty text: 400 `text is required`.
- context: the conversation's `context(input)` adds the notes to every message; the run's recorded `input` shows them.

## How to get to it (user POV)

The person types in the chat page and presses Send (see [chat-page](chat-page.md)); each message becomes a run whose answer appears under it. A client calls the same route.

## Driving it with boring

```bash
node bin/boring.mjs env up --seed asked
node bin/boring.mjs chat                             # the seeded turn: run pending, person, run running, agent, run completed
node bin/boring.mjs send "And who should I call?" --wait
node bin/boring.mjs chat | tail -5                   # the second turn on the same thread (#6..#10)
node bin/boring.mjs send "New topic" --new --wait    # another thread; `state` shows threads: 2
node bin/boring.mjs trace <run>                      # input: { notes: [...], text: "..." }; output: the markdown answer
```

Observed: a turn is five events in this order: `run pending`, `person`, `run running`, `agent`, `run completed`; the reply is `Scripted answer to: <text>`; `wait-settle` reports the reply. Two `chat` calls print the same lines. A restart with `--keep-data` replays the same thread (`chat` after `env up --restart --keep-data` shows nothing only because the environment forgot which thread was current: pass the id with `boring send --thread <id>` or read `runs` for it).

- History path: with a real model, ask a follow-up that only the previous turn can answer.
- Persistence: `env up --restart --keep-data`, then `runs` lists the runs and `curl $U/agent/threads/<id>/events?live=0` replays them.

## Gotchas

- `boring send` continues the environment's current thread until `--new`; `env up` (fresh or `--keep-data`) starts with no current thread.
- The answer agent validates markdown length (`too long: answer in a few sentences`); with a real model a long answer becomes a repair attempt (`attempts` > 1), not a failure, unless repairs run out.
- `inputs.notes` come from the page (`examples/notes/web/main.tsx`) and from `boring send` alike; a client that omits them gets "No notes." in the message and an answer saying so.
