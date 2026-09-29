# Roadmap

The skeleton is complete when `boring check` and `boring verify` are green with every behavioral law an explicit deferral. Code then arrives in the dependency order, each step turning deferrals into commands.

1. **files.** *(landed: address canonicalisation and mounts, the memory, directory and GitHub providers with receipts, the read-only wrapper, one conformance suite; FILES-8 tested on the GitHub provider.)* Remaining: a SQLite provider, HTTP routes, the `FileTree` component and its hook.
2. **agent.** *(first code landed: definitions, runtime, wire, manifest; decisions, resumption and the dev host remain.)* The SQLite store for threads, runs, decisions, receipts and usage; admission and grants; the Flue-backed loop and a deterministic in-process loop for tests; the Host contract runtime; mount adapters for Express and Hono; the HTTP wire; the dev host `boring env up` launches. Source to port: the hub's runtime, runner and dev host.
3. **chat.** *(landed: `BoringChat` with tokens, slots and headless mode, tool renderer, `useAgentUi` and `createUiBridge` over the wire's `ui` requests.)* Remaining: answering ask and approval cards once decisions exist, the artefact viewer.
4. **viewers and the registry.** *(landed: `@boring/viewers` with the file tree, markdown and image hooks and their tools; the HTTP file routes; the shadcn registry with file-tree, markdown-editor, image-viewer and the chat items; examples/registry-host installing them.)* Next: the canvas (tldraw), the dockview workspace, then a PDF viewer, a code editor, charts, and the hub consuming the registry in its panes.
5. **examples.** A notes app that owns nothing but files, and a brownfield app that owns a Postgres database and mounts the agent with its own roles. The second is the acceptance test for the whole library.

Out of scope until a consumer asks: shell and sandbox execution, reusable jobs, a plugin system, payments.
