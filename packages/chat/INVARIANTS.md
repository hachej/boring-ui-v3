# Chat laws

The chat is one React component that shows a thread and lets a person talk to the agent behind it. It can be placed in any layout. Its only inputs are the endpoint of an agent and the person's session; everything else it shows comes over the [wire](../agent/src/wire.ts).

## CHAT-1 — the chat is a projection

Every message, tool call, question, approval and artefact the chat shows is derived from thread records replayed by cursor. Reconnecting or reloading shows the same state; the component adds no rule and stores no truth.

## CHAT-2 — placeable anywhere

The component owns no layout, no route and no global state. It mounts in a column, a drawer, an iframe or beside an app's own screen with the same props, and two instances of one thread stay consistent because both read the same records.

## CHAT-3 — UI commands are allowlisted by the app

The agent can drive the page only through commands the app registered, each with a schema. The state reporter is read-only. There is no command that evaluates code or reaches an element the app did not expose.

## CHAT-4 — a person's answer comes from the person

An answer to a question or an approval is sent with the session's actor and accepted only for that actor. Page script, another tab, or the model cannot supply it.
