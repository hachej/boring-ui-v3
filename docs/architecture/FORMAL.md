# Formal model scope

Two bounded TLA+ models exist, one per race that the laws forbid. `tools/formal-toolchain.json` pins TLC by URL and checksum; `npm run setup:formal` fetches it; `boring model <name>` runs one; `npm run test:formal` removes each model's guard in a temporary copy and requires the named invariant to be violated, so a model that checks nothing cannot pass.

| Model | Owner | Finite domain | Safety claim |
|---|---|---|---|
| `files-commit` | FILES-2 | Two writers, revisions 1 to 4, remove and recreate | No commit succeeds on a stale observed revision |
| `agent-commit` | AGENT-2, AGENT-6 | One run, one actor, one resource; start, admission, observation, a concurrent human write, revocation, cancellation and commit interleave freely | A receipt never arises from stale, revoked or stopped work |

`CHECK_DEADLOCK FALSE` is deliberate: these are safety checks with legal quiescent states. No liveness, fairness or completion claim is made. The models are specifications, not proofs that the TypeScript refines them; each provider and the runtime need conformance tests at their real boundary, which the registries list as deferrals until they exist.
