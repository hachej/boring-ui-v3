# Multi-surface journeys

Journeys across the chat, the app pane and the agents. Per-surface selectors live in the linked files; read those first. Baseline preconditions in [the feature-map README](README.md) apply.

## Person edits while agents write

The person must never lose an edit to an agent, and an agent must never lose its section to the person.

- `env up --seed note --think-ms 2500`; `send "draft the open note"` (no wait); while the log shows writers running, `type "app:#title" "…"` and `click "app:#saveTitle"`; `wait-settle`.
- Expect: the title the person typed, all three sections, and in `log` the person's write interleaved with the writers' (a stale write retried, never overwritten). If the page reports a conflict, a second Rename applies the text.

## Cancel mid-draft

- `env up --seed note --think-ms 3000`; `send "draft it"`; `click "#cancel"` once the log shows the request running; `wait-settle`.
- Expect: request and children `cancelled`, no `app db` write after the cancel line, the chat reporting the cancellation.

## Restart persistence

- After any journey, `env up --restart --keep-data`, then `chat` and `tool read_note`: the conversation and the note are unchanged.

## Real model pass

- Repeat "Person edits while agents write" with `--model codex`. Judge the sections against the dictation (`tool read_note`), and read `trace` for each agent's input and tool calls.
