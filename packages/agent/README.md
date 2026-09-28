# @boring/agent

A durable agent loop an application mounts in its own backend. The application keeps its database, its auth and its deploy. The loop adds threads, runs, tools admitted before they run, a receipt for every effect, and questions and approvals as records. Files go through `@boring/files`.

Laws: [INVARIANTS.md](INVARIANTS.md). Evidence: [VERIFY.json](VERIFY.json). Contract: [src/index.ts](src/index.ts). Wire to the chat: [src/wire.ts](src/wire.ts).

Planned contents: the SQLite store, the Flue-backed loop and a deterministic in-process loop for tests, admission, the receipt log, the Host contract runtime, mount adapters for Express and Hono, the HTTP wire, and a dev host that `boring env up` launches.
