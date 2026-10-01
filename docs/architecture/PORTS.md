# Ports and adapters in the library

The rule is the hub's ([hachej/boring-hub `docs/architecture/PORTS.md`](https://github.com/hachej/boring-hub/blob/main/docs/architecture/PORTS.md)): a deployment changes adapters and configuration, never the core. In the library it is one law, [BORING-7](../../INVARIANTS.md#boring-7--the-environment-and-vendor-sdks-live-in-adapters): no package reads the environment or imports a vendor SDK module outside an adapter folder, `packages/<package>/src/adapters/<port>/<name>/`, and the runtime reaches a port's adapters only through its table, `adapters/<port>/index.ts`. `boring check` enforces it; oxlint mirrors it.

The library owns two ports a consumer reuses rather than redefines:

| Port | Contract | Adapters | Conformance |
|---|---|---|---|
| files | the `FileProvider` contract, [packages/files/src/contract.ts](../../packages/files/src/contract.ts) (FILES-1..8) | memory, directory, GitHub, the remote HTTP client, the read-only decorator; the hub's versioned workspace files implement it too | `test/files/suite.ts`, run against every provider (and by the hub against its own) |
| models | `ModelAdapter`, [packages/agent/src/runtime/model-port.ts](../../packages/agent/src/runtime/model-port.ts) (AGENT-16) | `fake`, `openrouter`, `openai-codex` under [packages/agent/src/adapters/models](../../packages/agent/src/adapters/models); `@boring/agent/models` exports the provider factories for a host that builds its own runtime | `test/agent/model-adapters.test.ts` (real providers against a local double of their API) |

The third seam is the `Host` contract of `@boring/agent` (AGENT-8): the application, not the library, decides who the actor is, what a run may touch and where files live. It is a port the application implements once; the hub's composition root implements it for folder apps.

The files providers predate the adapter folders and keep their published paths; `packages/files/src/directory.ts` is the one reasoned `node:fs` exception (ARCHITECTURE.json `adapters.fsAllowed`), with `packages/agent/src/definitions/load.ts`, which reads the application's own definition folder.

Next adapters for the models port, each a new folder and a `ModelAccess` variant: `anthropic` (the Messages API), `bedrock` (pi-ai's Bedrock Converse stream), an OpenAI-compatible gateway (today: `openrouter` with `baseUrl`).
