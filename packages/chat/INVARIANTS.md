# Chat laws

The chat is one React component that shows a thread and lets a person talk to the agent behind it. It can be placed in any layout. Its only inputs are the endpoint of an agent and the person's session; everything else it shows comes over the [wire](../agent/src/wire.ts).

## CHAT-1 — the chat is a projection

Every message, tool call, question, approval and artefact the chat shows is derived from thread records replayed by cursor. Reconnecting or reloading shows the same state; the component adds no rule and stores no truth.

## CHAT-2 — placeable anywhere

The component owns no layout, no route and no global state. It mounts in a column, a drawer, an iframe or beside an app's own screen with the same props, and two instances of one thread stay consistent because both read the same records.

## CHAT-3 — page commands are registered by the page and checked in the bridge

The agent can drive the page only through commands the page registered on its thread, each with a name, a description and an input schema. The bridge answers a request only when it is addressed to this page instance, names a registered command, carries an input the schema accepts and binds the target the page still shows; anything else is refused before the handler runs. There is no command that evaluates code or reaches an element the page did not expose, and a page's answer is its report, never a receipt.

## CHAT-4 — a person's answer comes from the person

An answer to a question or an approval is sent with the session's actor and accepted only for that actor. Page script, another tab, or the model cannot supply it.

## CHAT-5 — the shell is a skin

The component injects no stylesheet and sets no style outside its root. Its appearance follows documented `--boring-*` tokens read with defaults, every piece is a slot the host can replace, and a headless mount renders bare elements with data attributes only.
