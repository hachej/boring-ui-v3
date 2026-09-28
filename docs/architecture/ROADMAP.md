# Roadmap

The skeleton is complete when `boring check` and `boring verify` are green with every behavioral law an explicit deferral. Code then arrives in the dependency order, each step turning deferrals into commands.

1. **files.** Address canonicalisation, the SQLite provider with receipts, the directory provider, the conformance suite run against both, HTTP routes, the `FileTree` component and its hook. Then the remote-sandbox adapter, which is the test of FILES-8. Source to port: the hub's SQLite file provider and effect log.
2. **agent.** The SQLite store for threads, runs, decisions, receipts and usage; admission and grants; the Flue-backed loop and a deterministic in-process loop for tests; the Host contract runtime; mount adapters for Express and Hono; the HTTP wire; the dev host `boring env up` launches. Source to port: the hub's runtime, runner and dev host.
3. **chat.** `BoringChat` over the wire with cursor replay, the ask and approval cards, tool and artefact renderers, `useAgentUi` with the command bridge. Source to port: the hub's chat pane and wire client, and the v2 UI-command dispatcher trimmed to registered commands.
4. **examples.** A notes app that owns nothing but files, and a brownfield app that owns a Postgres database and mounts the agent with its own roles. The second is the acceptance test for the whole library.

Out of scope until a consumer asks: shell and sandbox execution, viewers beyond the artefact card, reusable jobs, a plugin system, payments.
