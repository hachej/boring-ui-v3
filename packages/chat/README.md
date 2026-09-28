# @boring/chat

One React component that shows a thread and lets a person talk to the agent behind it. Mount it in a column, a drawer, an iframe or next to an app's own screen. The app registers the page commands the agent may use; nothing else on the page is reachable.

Laws: [INVARIANTS.md](INVARIANTS.md). Evidence: [VERIFY.json](VERIFY.json). Contract: [src/index.ts](src/index.ts).

Planned contents: `BoringChat`, the ask and approval cards, tool and artefact renderers, `useAgentUi` for the command bridge, and a wire client with cursor replay.
