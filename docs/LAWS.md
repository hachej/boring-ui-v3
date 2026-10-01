# The laws, indexed

Every law of the library in one table, for a consumer (the hub's registry, an application's own laws) to cite by id. The ids are stable: a law is renamed or renumbered never; one that stops holding is withdrawn with a note here. The definition lives beside its owner and only there; this page indexes, it does not restate. `boring laws` prints it.

The library speaks in the developer's words (an actor, a thread, a run, a job, a tool, a file, a receipt, admission, a decision). The hub's specification speaks in four nouns: **Job** (one request for an outcome, with predeclared composition), **Resource** (identified state with a revision and receipts), **Actor** (the attributable executor), **Environment** (the issued operations of one execution: admission, grants, revocation). The mapping is written once, in the last column, so that both registries mean the same thing when they cite an id.

| Law | Owner file | One line | Evidence (VERIFY.json entry) | Hub noun |
|---|---|---|---|---|
| BORING-1 | [INVARIANTS.md](../INVARIANTS.md) | Model output is never authority | test/agent/admission.test.ts; test/agent/files.test.ts (paths); test/chat/bridge.test.ts (page input) | Environment (admission), Actor |
| BORING-2 | [INVARIANTS.md](../INVARIANTS.md) | Every effect leaves a receipt | test/agent/attribution.test.ts; test/files/receipts.test.ts; test/agent/files.test.ts (mount, path, revisions) | Resource (receipt), Environment |
| BORING-3 | [INVARIANTS.md](../INVARIANTS.md) | One contract, every transport | test/files/conformance.test.ts (memory, directory, GitHub); test/files/routes.test.ts (the HTTP routes and their client) | Resource |
| BORING-4 | [INVARIANTS.md](../INVARIANTS.md) | Presentation requests, it never owns | test/chat/client.test.ts; `boring smoke` (reload and restart); test/viewers/file-tree.test.ts, test/registry/round-trip.test.ts (the tree) | Experience (a composition, not a noun) over Job and Resource |
| BORING-5 | [INVARIANTS.md](../INVARIANTS.md) | Evidence matches the claim | test/architecture (checker, registries, lint); test/formal (mutants) | the method itself (hub PLATFORM-5 cites it) |
| BORING-6 | [INVARIANTS.md](../INVARIANTS.md) | Packages depend one way | tools/check.mjs; `boring lint`; typecheck; definitions test | structure, no noun |
| BORING-7 | [INVARIANTS.md](../INVARIANTS.md) | The environment and vendor SDKs live in adapters | tools/check.mjs; test/architecture (checker and lint negative controls) | structure, no noun (the hub's PORTS-* cite it) |
| FILES-1 | [packages/files/INVARIANTS.md](../packages/files/INVARIANTS.md) | A read names its revision | test/files/conformance.test.ts, receipts.test.ts | Resource (revision) |
| FILES-2 | [packages/files/INVARIANTS.md](../packages/files/INVARIANTS.md) | A write names the revision it saw | model `files-commit`; test/files/conformance.test.ts | Resource (update precondition) |
| FILES-3 | [packages/files/INVARIANTS.md](../packages/files/INVARIANTS.md) | Create is not overwrite | test/files/conformance.test.ts | Resource (create precondition) |
| FILES-4 | [packages/files/INVARIANTS.md](../packages/files/INVARIANTS.md) | Removal keeps revisions monotonic | test/files/conformance.test.ts | Resource (revision) |
| FILES-5 | [packages/files/INVARIANTS.md](../packages/files/INVARIANTS.md) | A mount confines every address | test/files/address.test.ts; test/agent/files.test.ts (grants) | Resource (identity), Environment (grant scope) |
| FILES-6 | [packages/files/INVARIANTS.md](../packages/files/INVARIANTS.md) | One authority per mount | examples/embed-host/test/round-trip.test.ts; test/registry/round-trip.test.ts (routes and tree) | Resource |
| FILES-7 | [packages/files/INVARIANTS.md](../packages/files/INVARIANTS.md) | Receipt and mutation commit together | test/files/conformance.test.ts, receipts.test.ts | Resource (receipt), Actor, Job |
| FILES-8 | [packages/files/INVARIANTS.md](../packages/files/INVARIANTS.md) | A remote provider keeps the contract or refuses | test/files/remote.test.ts, receipts.test.ts (readonly) | Resource |
| AGENT-1 | [packages/agent/INVARIANTS.md](../packages/agent/INVARIANTS.md) | A run is durable and ends once | test/agent/durability.test.ts; `boring smoke` (restart); resumption deferred | Job (lifecycle), execution record (run) |
| AGENT-2 | [packages/agent/INVARIANTS.md](../packages/agent/INVARIANTS.md) | Admission before effect | model `agent-commit`; test/agent/admission.test.ts | Environment (admission, recheck at commit) |
| AGENT-3 | [packages/agent/INVARIANTS.md](../packages/agent/INVARIANTS.md) | Declared tools only | test/agent/tools.test.ts | Actor (declared needs), Environment |
| AGENT-4 | [packages/agent/INVARIANTS.md](../packages/agent/INVARIANTS.md) | Effects are attributed | test/agent/attribution.test.ts; `boring smoke` (receipt); test/agent/files.test.ts (file revisions) | Resource (receipt: Job, Actor, revisions) |
| AGENT-5 | [packages/agent/INVARIANTS.md](../packages/agent/INVARIANTS.md) | Human decisions are records | deferred: decisions | Job (waiting condition), Approval record |
| AGENT-6 | [packages/agent/INVARIANTS.md](../packages/agent/INVARIANTS.md) | Stop means stop | model `agent-commit`; test/agent/stop.test.ts | Environment (revocation, cancellation before commit) |
| AGENT-7 | [packages/agent/INVARIANTS.md](../packages/agent/INVARIANTS.md) | Credentials live in the host | test/agent/credentials.test.ts | Environment (borrowed credentials) |
| AGENT-8 | [packages/agent/INVARIANTS.md](../packages/agent/INVARIANTS.md) | The host is the only source of authority | test/agent/host.test.ts, admission.test.ts | Environment (issued by the host), Actor (identity) |
| AGENT-9 | [packages/agent/INVARIANTS.md](../packages/agent/INVARIANTS.md) | Roles belong to the application | test/agent/tools.test.ts; test/agent/files.test.ts, ui.test.ts (mounts, page commands); answers deferred | Actor (roles are the application's) |
| AGENT-10 | [packages/agent/INVARIANTS.md](../packages/agent/INVARIANTS.md) | Every model call is metered | test/agent/usage.test.ts; `boring smoke` (usage row) | Environment (budget), Actor (attribution) |
| AGENT-11 | [packages/agent/INVARIANTS.md](../packages/agent/INVARIANTS.md) | Request-work is idempotent by key | model `agent-idempotency`; test/agent/wire.test.ts, idempotency.test.ts (concurrent keys); `boring smoke` | Job (request-work, SPEC §4.3 idempotency) |
| AGENT-12 | [packages/agent/INVARIANTS.md](../packages/agent/INVARIANTS.md) | A job's composition is predeclared | model `agent-composition`; test/agent/wire.test.ts; `boring smoke` | Job (predeclared composition, frozen at start) |
| AGENT-13 | [packages/agent/INVARIANTS.md](../packages/agent/INVARIANTS.md) | A page command is a request, answered once by the bound page | test/agent/ui.test.ts | Environment (declared limits), hub UI-BOUNDARY-1, -4, -5 |
| AGENT-14 | [packages/agent/INVARIANTS.md](../packages/agent/INVARIANTS.md) | The library's words are the application's language | test/agent/language.test.ts | Actor (the application's audience), execution record (failure kind) |
| AGENT-15 | [packages/agent/INVARIANTS.md](../packages/agent/INVARIANTS.md) | Model providers are adapters behind one port | test/agent/model-adapters.test.ts; test/agent/usage.test.ts; live run deferred | Environment (borrowed credentials), Actor (metered) |
| CHAT-1 | [packages/chat/INVARIANTS.md](../packages/chat/INVARIANTS.md) | The chat is a projection | test/chat/client.test.ts; `boring smoke` (reload in a browser) | Experience over Job records |
| CHAT-2 | [packages/chat/INVARIANTS.md](../packages/chat/INVARIANTS.md) | Placeable anywhere | `boring smoke` (the example's bare page); examples/embed-host/test/browser.test.ts (another app's page, tokens) | Experience |
| CHAT-3 | [packages/chat/INVARIANTS.md](../packages/chat/INVARIANTS.md) | Page commands are registered by the page and checked in the bridge | test/chat/bridge.test.ts; test/agent/ui.test.ts | Environment (declared limits), hub UI-BOUNDARY |
| CHAT-4 | [packages/chat/INVARIANTS.md](../packages/chat/INVARIANTS.md) | A person's answer comes from the person | test/agent/host.test.ts, wire.test.ts; `boring smoke` (ownership); answers deferred | Actor (authenticated initiator), Approval record |

| CHAT-5 | [packages/chat/INVARIANTS.md](../packages/chat/INVARIANTS.md) | The shell is a skin | examples/embed-host/test/browser.test.ts (no stylesheet, tokens) | Experience |
| VIEWERS-1 | [packages/viewers/INVARIANTS.md](../packages/viewers/INVARIANTS.md) | One tool, every caller | test/viewers/*.test.ts; test/registry/browser.test.ts | Experience (component tools), hub UI-BOUNDARY-3 |
| VIEWERS-2 | [packages/viewers/INVARIANTS.md](../packages/viewers/INVARIANTS.md) | Read-only is enforced where the effect happens | test/viewers/file-tree.test.ts, markdown.test.ts | Environment (declared limits), hub UI-BOUNDARY-2 |
| VIEWERS-3 | [packages/viewers/INVARIANTS.md](../packages/viewers/INVARIANTS.md) | A result names what happened | test/viewers/file-tree.test.ts, markdown.test.ts, image.test.ts | Resource (receipt), hub UI-BOUNDARY-5 |
| VIEWERS-4 | [packages/viewers/INVARIANTS.md](../packages/viewers/INVARIANTS.md) | A binding is one mounted instance on one target | test/viewers/bridge.test.ts | hub UI-BOUNDARY-4 |
| VIEWERS-5 | [packages/viewers/INVARIANTS.md](../packages/viewers/INVARIANTS.md) | A save names the revision it read, and unsaved work is kept | test/viewers/markdown.test.ts | Resource (update precondition), hub UI-BOUNDARY-4 |
| VIEWERS-6 | [packages/viewers/INVARIANTS.md](../packages/viewers/INVARIANTS.md) | The person's decision stays the person's | test/viewers/markdown.test.ts | Actor (the person), hub UI-BOUNDARY-5 |
| VIEWERS-7 | [packages/viewers/INVARIANTS.md](../packages/viewers/INVARIANTS.md) | Headless and portable | test/architecture/lint.test.mjs; tools/check.mjs | structure, no noun |

## Reading the evidence column

- A test path is a `node --test` command in the owner's `VERIFY.json`; `boring verify` runs every entry and prints passed, deferred and failed per law.
- A model name is a bounded TLA+ model under `packages/<owner>/formal/`, pinned in `tools/formal-toolchain.json`; `test/formal/models.test.mjs` proves each invariant's guard is load-bearing with one mutant per invariant. Bounds and assumptions: [docs/architecture/FORMAL.md](architecture/FORMAL.md).
- `boring smoke` is the deterministic journey on a throwaway copy of `examples/notes` with the fake model (tools/smoke.mjs); each step names the claim it supports, and CI keeps the evidence directory.
- "deferred" is an explicit `pending` entry naming the command that will replace it. It is never counted as passing.

## Withdrawn ids

None.
