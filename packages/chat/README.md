# @boring/chat

One React shell over the agent wire, the client protocol it uses, and the page-command bridge. `BoringChat` shows a thread rebuilt from the wire's events, sends a message to a conversation and follows the run it started. It owns no layout, no global style and no truth; mount it in a column, a drawer, an iframe or beside an app's own screen.

Laws: [INVARIANTS.md](INVARIANTS.md). Evidence: [VERIFY.json](VERIFY.json). Contract: [src/index.ts](src/index.ts). Design: [docs/design/ui-bridge.md](../../docs/design/ui-bridge.md). No Flue import; only the wire types of `@boring/agent`.

```tsx
import { BoringChat, createChatClient, useAgentUi } from "@boring/chat";

const client = createChatClient({ endpoint: "/agent" });                 // the app's fetch, cookies and headers
<BoringChat endpoint="/agent" conversation="chat" client={client} onThread={setThread} />
```

## Skin

- **Tokens**: every style reads `var(--boring-*, default)`; set them on any ancestor or pass `theme={{ "--boring-accent": "#8b5e34" }}`. The list: [src/theme.ts](src/theme.ts).
- **Slots**: `slots={{ Message, Text, ToolCall, AskCard, ApprovalCard, Artefact, UiRequest, RunStatus, Composer }}`.
- **Headless**: `headless` renders bare elements with `data-boring="…"` attributes and no inline style. Under a strict CSP (`style-src` without `'unsafe-inline'`) use this mode with your own stylesheet; the default mode uses inline `style` attributes and no stylesheet.

## Page commands

```tsx
const { page } = useAgentUi({ client, thread, target: { kind: "record", id, version }, commands: [
  { name: "open_record", description: "Open a record by id.", input: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    handler: async ({ id }) => { open(id); return { outcome: "applied" }; } },
] });
```

The agent may request `open_record` only if its `agent.md` names it under `ui:` and the host allows it; the bridge refuses, before the handler, requests for another page, unregistered commands, inputs outside the schema and targets the page has left. Without React: `createUiBridge({ client, thread, commands }).start()` (from `@boring/chat/bridge`), which is also how a headless caller answers.

`createChatClient` (from `@boring/chat/client`) gives `say`, `cancel`, `run`, `job`, `createThread`, `follow` (an async iterable of events by cursor), `registerUi`, `unregisterUi`, `uiRegistrations` and `answerUi`; it runs anywhere `fetch` does.

## Deferred

Answering ask and approval cards (decisions are not in the runtime yet); a reload check in the browser test (CHAT-1).
