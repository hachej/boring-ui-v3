# Formal model scope

Four bounded TLA+ models exist, one per race or protocol the laws pin down. `tools/formal-toolchain.json` pins TLC by URL and checksum; `npm run setup:formal` fetches it; `boring model <name>` runs one; `npm run test:formal` removes one guard per invariant in a temporary copy and requires that invariant to be reported as violated, so a model that checks nothing, and an invariant that nothing protects, cannot pass.

| Model | Owner | Finite domain | Safety claims |
|---|---|---|---|
| `files-commit` | FILES-2 | Two writers, revisions 1 to 4, remove and recreate | No commit succeeds on a stale observed revision |
| `agent-commit` | AGENT-2, AGENT-6 | One run, one actor, one resource; start, admission, observation, a concurrent human write, revocation, cancellation and commit interleave freely | A receipt never arises from stale, revoked or stopped work |
| `agent-idempotency` | AGENT-11 | One key, two bodies, three concurrent submissions, three runs at most; the process may restart while submissions are in flight and their callers retry | Same key and body always name one run; another body is refused; a key creates at most one run. The reservation of a key is one atomic step |
| `agent-composition` | AGENT-12 | Two child slots, a declared and an undeclared agent, a plan chosen nondeterministically | An undeclared plan is refused before any child is recorded; children come from the frozen plan only; a child runs only under its running parent; the parent completes only from completed children; a terminal parent leaves no open child; a child's terminal status is never rewritten (an action property) |

`CHECK_DEADLOCK FALSE` is deliberate: these are safety checks with legal quiescent states. No liveness, fairness or completion claim is made. The models are specifications, not proofs that the TypeScript refines them; the runtime and each provider need conformance at their real boundary, which the registries list as tests, the smoke, or deferrals until they exist. One such boundary is worth naming: `agent-idempotency` requires key reservation to be atomic with the lookup, which is what the store's primary key gives; the runtime must reserve before it awaits anything.
