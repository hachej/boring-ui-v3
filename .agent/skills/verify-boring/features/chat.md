# Chat

The left pane is a conversation with the hub's assistant over Flue's chat wire (`POST /agents/assistant/<person>`, SSE updates), the same protocol boring-hub serves for its Colleague. With a build of the chat panel bundle (`--chat-bundle` or `BORING_CHAT_BUNDLE`) the pane is `PiChatPanel`; without it, a minimal client of the same wire. Laws: PLATFORM-4, ACTOR-3.

## Sub-features

- send: a message is admitted (202, submission id) and joins the conversation.
- streaming-reply: assistant text streams; tool calls show as they run and settle.
- tool-calls: `request_work`, `cancel_work`, the app's read tools, `open_note`.
- abort: stopping the in-flight turn (Flue `POST /:id/abort`); the panel bundle has its own Stop.
- isolation: one conversation per person; another person's conversation id is refused.
- history: the conversation survives page reload and hub restart (Flue persistence in the data dir).

## How to get to it (user POV)

Type in the composer at the bottom of the chat pane and press Enter. The reply streams in above; tool activity appears inline. Reload the page and the conversation is still there.

## Driving it with boring

```bash
node bin/boring.mjs env up --seed note
node bin/boring.mjs send "What note do I have open?" --wait   # reply text + tool calls + db revision
node bin/boring.mjs chat                                       # the conversation as the person sees it
# through the page: the panel bundle (env up --chat-bundle ...) or the minimal client
node bin/boring.mjs type "#chat textarea" "Draft it" && node bin/boring.mjs press Enter --in "#chat textarea"   # the panel bundle
node bin/boring.mjs type "#say" "Draft it" && node bin/boring.mjs press Enter --in "#say"                        # minimal client
node bin/boring.mjs wait-settle
node bin/boring.mjs screenshot
```

- `send --wait` exercises the wire directly; typing in the composer exercises the page. A change to the page or panel needs the second, with the composer the change affects.
- Isolation: `curl -X POST <url>/agents/assistant/someone-else ...` must answer 403.

## Gotchas

- Before the first message the conversation does not exist; reads answer Flue's documented 404 `stream_not_found`. Not a failure.
- With a real model the reply wording varies; assert on tool calls and side effects, not on text.
- "System instructions updated." appears once when the assistant's instructions change between turns (for example after a host upgrade). Frequent occurrences mean instructions are being varied per turn, which also defeats prompt caching.
