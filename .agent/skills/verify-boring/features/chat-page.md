# Chat page

The example page (`examples/notes/web`, built by Vite, served at `/`): the notes list and `BoringChat` over `/agent` on the `questions` conversation. The component rebuilds everything it shows from the thread's events; the page keeps only the thread id, in `location.hash`. Laws: CHAT-1, CHAT-2, BORING-4.

## Sub-features

- send: type in the message box and press Send (or Enter); the person's message appears at once from the wire, the agent's reply when its run completes.
- live status: while a run is open a line `answer is running…` with a **stop** button shows; it disappears at the terminal event.
- reload: the thread id is in the hash, so a reload replays the same transcript.
- error: a refused message shows `role="alert"` under the list.
- placement: the component is inside the app's own layout with only `endpoint`, `conversation`, `inputs` and `thread` props.

## How to get to it (user POV)

Open the app's URL (`env info` → `url`). Type a question about the notes, press Send. Reload the page: the conversation is still there.

## Driving it with boring

```bash
node bin/boring.mjs env up
node bin/boring.mjs type "input[aria-label=message]" "Which note mentions milk?"
node bin/boring.mjs click "button[type=submit]"
node bin/boring.mjs wait-for "[data-boring-chat] li[data-role=agent]" && node bin/boring.mjs wait-settle
node bin/boring.mjs snapshot "[data-boring-chat]"        # list: listitem "Which note mentions milk?", listitem "Scripted answer to: ..."; textbox "message"; button "Send" [disabled]
node bin/boring.mjs eval "location.hash"                  # #thread=<id>
node bin/boring.mjs screenshot .cache/evidence/<time>/page.png
node bin/boring.mjs reload && node bin/boring.mjs wait-for "[data-boring-chat] li[data-role=agent]"
node bin/boring.mjs eval "[...document.querySelectorAll('[data-boring-chat] li[data-role]')].map(li => li.dataset.role + ': ' + li.textContent)"
node bin/boring.mjs chat                                  # the same events on the wire (set the thread: boring send --thread <id> ... or read runs)
```

Observed: after send, `["person: Which note mentions milk?", "agent: Scripted answer to: Which note mentions milk?"]`; after reload the same two lines, URL `…/#thread=<id>`; `trace` of the run shows `input.text` equal to what was typed.

- Stop: needs an open run; with a real model, send a question, then `click "[data-boring-chat] li[data-run] button"`; expect the run `cancelled` in `runs` and no reply.
- Error: `eval` cannot force a refusal; a stopped app (`env down`) then a send shows the alert (`snapshot` shows `alert`).

## Gotchas

- The environment's browser opens `/` once at `env up`; page controls reuse that tab. The thread id in the hash survives `reload` but not `env up --restart` (a fresh browser): open a known thread with `boring goto "/#thread=<id>"` (the id from `runs` or `chat`), then `wait-for` the agent's line.
- `wait-for` waits for the DOM, `wait-settle` for the records; a reply can be in the records a tick before the DOM shows it. Use both.
- `snapshot` is the ARIA tree (roles and names); `eval` reads exact text. Assert on the records (`chat`, `trace`) for anything beyond what is rendered.
