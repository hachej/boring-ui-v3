# Formal model scope

Install Node 22, Java 17+ and Lean via Elan using `lean-toolchain`, then run `npm ci`, `npm run setup:formal`, `npm run check` and `npm run verify`.

`npm run test:lean` builds every [semantic module](../SEMANTICS.md) with the pinned Lean toolchain and treats warnings (including `sorry`) as errors. It checks the abstract definitions and proofs; it does not prove that the TypeScript implementation refines them. The full verification gate includes this build, and missing Lean fails it.

`tools/formal-toolchain.json` pins TLC by release URL and SHA-256. Missing Java/TLC, a mismatched checksum, timeout, parse error or invariant violation fails verification. CI installs and executes the same toolchain. `TLA2TOOLS_JAR` and `JAVA_BIN` may select a local installation; the JAR checksum remains mandatory.

| Model | Checked finite domain | Safety claim |
|---|---|---|
| Execution | One Job/Actor/Resource, revisions bounded at 4, with start, admission, observation, human write, revoke, cancel and commit interleavings; the receipt records the facts at commit time | A receipt cannot arise from stale, revoked or non-running work |
| Lifecycle | One parent, three children, every interleaving of create, start, resolve, cancel and cascade | Composition freezes when the parent starts; the parent completes only from completed children; a child runs only under a running parent; a terminal parent leaves no unresolved child |
| Commit | Two writers, revisions 1 through 4, delete/recreate | A writer cannot commit using a stale observed revision |

`CHECK_DEADLOCK FALSE` is intentional: these are safety checks with legal terminal/quiescent states and bounded revision exhaustion. No fairness, eventual completion or deadlock-freedom claim is made.

`npm run test:formal` checks the execution, lifecycle and commit models and removes critical guards in temporary copies. Each mutation must produce the named invariant violation; a syntax error is not accepted as a successful negative test. Missing-tool behavior is tested too. The former duplicate Bend predicates were removed: they had no enforced toolchain or model/runtime correspondence.

These models are specifications, not a proof of TypeScript refinement. Each runtime implementation needs conformance tests at its actual storage/admission boundary. Registry deferrals are visible gaps, never passing evidence. Additional retry/idempotency, durable crash recovery, live policy integration and liveness models remain deferred until their protocols exist.

The Execution model is the primary cross-noun race model for the MVP. Older per-noun models remain bounded supporting checks, not claims of implementation refinement.
