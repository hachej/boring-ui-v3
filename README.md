# Boring

The Boring platform: outcome-driven work for people and agents over authoritative state. An expert describes an outcome; the platform records it as a Job, admits every effect through an Environment, attributes it to an Actor, and keeps Resources as the only truth. Everything a person sees is a composition over those four nouns.

This repository starts from the kernel and grows outward in fixed layers. See [the roadmap](docs/architecture/ROADMAP.md).

## What is here

| Path | What it is |
|---|---|
| `platform/` | The kernel: four nouns with their TypeScript contracts, laws (`INVARIANTS.md`), evidence registries (`VERIFY.json`), Lean semantics and TLA+ models. Root files hold the cross-cutting laws, relationships and the executable architecture policy. |
| `bin/boring.mjs`, `tools/` | The `boring` command: structure and evidence checks, model runs, and the remote control for an isolated running hub. |
| `.agent/skills/verify-boring/` | How an agent verifies a change by running the app, with the feature map it drives. |
| `test/architecture/`, `test/formal/` | Negative controls: the architecture checker rejects what it must, and each TLA+ model detects its own mutated guard. |
| `docs/architecture/` | Why a Job-driven platform, the method, and the roadmap. |
| `docs/sources/` | Archived source material that influenced the method. |

## Commands

```bash
npm ci --ignore-scripts
npm run setup:formal      # pinned TLC
npm run check             # architecture and evidence-registry structure
npm run typecheck
npm run verify            # every registered evidence: tests, TLA+ models, Lean build; deferrals are listed, never counted as passing
node bin/boring.mjs --help
```

`verify` needs Node 22, Java 17+ and the Lean toolchain named in `lean-toolchain`. CI runs the same gate on every push and pull request.

## Rules

- A concept becomes a noun only when a consumer needs an independent identity, lifecycle or authority boundary. Otherwise it is a composition.
- Every law has one definition and one owner registry. Missing evidence is an explicit deferral with a reason, never a green check.
- The layer policy in `platform/ARCHITECTURE.json` is enforced by `boring check`: the kernel imports nothing above it.
- A change is verified by running it. `boring` is the remote control; the feature map says what to drive and what counts as proof.

## History

The kernel, the evidence method and the verification CLI were developed in `hachej/boring-hub` (pull requests #24 to #32, September 2026) and moved here as one basis. The earlier registry and hub-shell explorations this repository held are in commit `a0ef51e`.
