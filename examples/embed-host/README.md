# embed-host

A tiny existing application (Hono, a records API, a plain page) that mounts the runtime in its own process, registers two page commands, attaches `/code` (its own folder, read-only) and `/workspace` (per actor, in memory), and drives a scripted agent that calls a page command and writes a file.

```bash
npx vite build examples/embed-host/web
node examples/embed-host/server.mjs           # http://localhost:8788, scripted model
node --test examples/embed-host/test/round-trip.test.ts   # headless page over the wire
node --test examples/embed-host/test/browser.test.ts      # the page in Chromium (playwright-core)
```

What to read: [host.mjs](host.mjs) (the Host contract, the mounts, two backend tools), [server.mjs](server.mjs) (the app's routes beside `/agent`), [web/main.tsx](web/main.tsx) (`useAgentUi` with `open_record` and `highlight`, the app's own status mutation bound to a version), [agents/operator/agent.md](agents/operator/agent.md) (`files:` and `ui:` declarations). The design is in [docs/design/ui-bridge.md](../../docs/design/ui-bridge.md).
