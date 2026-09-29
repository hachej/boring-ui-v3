# @boring/chat

One React component over the agent wire, and the client protocol it uses. `BoringChat` shows a thread rebuilt from the wire's events, sends a message to a conversation and follows the run it started. It owns no layout and no global state; mount it in a column, a drawer, an iframe or beside an app's own screen.

Laws: [INVARIANTS.md](INVARIANTS.md). Evidence: [VERIFY.json](VERIFY.json). Contract: [src/index.ts](src/index.ts). No Flue import; only the wire types of `@boring/agent`.

```tsx
import { BoringChat } from "@boring/chat";
<BoringChat endpoint="/agent" conversation="questions" inputs={{ notes }} />
```

`createChatClient({ endpoint, fetch })` (from `@boring/chat/client`) gives `say`, `cancel`, `run`, `job` and `follow` (an async iterable of events by cursor); it runs anywhere `fetch` does. The example page under [examples/notes/web](../../examples/notes/web) builds it with Vite.

## What exists now

The client (fetch + NDJSON with cursor replay), `BoringChat` with messages, live run status and a stop button.

## Deferred

Ask and approval cards, tool and artefact renderers, `useAgentUi` and the page-command bridge (CHAT-3), a DOM placement test (CHAT-2) and the browser smoke (CHAT-1 reload).
