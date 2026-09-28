# Roadmap: the kernel first, then outward

The repository grows in three layers. Each layer is admitted only when the previous one is verified, and the layer policy in [ARCHITECTURE.json](../../platform/ARCHITECTURE.json) already names them all, so the dependency direction is fixed before the code arrives.

```text
platform/   <-  infra/  host/        <-  jobs/  experiences/  apps
kernel          providers, runtime       reusable work, what a person sees
layer 1         layer 2                  layer 3
```

## Layer 1: the kernel and the verification CLI (this basis)

In: the four nouns (Job, Resource, Actor, Environment) with their TypeScript contracts, laws, evidence registries, Lean semantic modules and bounded TLA+ models; the cross-cutting laws; the executable architecture policy and its negative-control tests; the `boring` CLI with the verify-boring skill and feature map.

Verified by: `check`, `typecheck`, `test:architecture`, `test:formal`, `test:lean`, `verify`.

Every verifier that needs a provider, a runtime or a running hub is an explicit deferral in the registries, each naming the command that will replace it. `boring verify` lists them. Room stays deferred as a noun; Experience stays a composition.

## Layer 2: file and database providers, the agent runtime, the host

In: `infra/` (SQLite file and database providers with compare-and-swap and receipts, the effect log, the Flue agent runtime and the deterministic in-process loop, the host Job runner) and `host/` (the hub the CLI launches, one isolated instance per checkout). The primitive tests return with them, and the deferred registry entries for FS-2 to FS-7, DATABASE-1 and 2, ENVIRONMENT-1, 2 and 4, ACTOR-1 to 4, JOB-1 to 3 and PLATFORM-1 to 4 become commands again.

Gate to enter: layer 1 green in CI. Gate to leave: `boring env up`, `doctor`, `send`, `log` and `trace` work against the fixture app, and `boring smoke` runs in CI.

## Layer 3: reusable Jobs, Experiences and the first expert app

In: `jobs/` (transcription, dictation, review, each with a `SPEC.md` and, where useful, a Lean or Bend contract), `experiences/` (the headless Markdown and workroom compositions), the end-to-end scenarios, and one real expert path served through platform Jobs. JOB-4 to 6 and JOB-CONTRACT-1 regain their evidence here. The Bend contract algebra in `platform/jobs/contract.bend` should lose its transcription-specific stage names before the second reusable Job arrives.

Gate to leave: an expert-facing app runs on the kernel with every write attributed in the effect log.

## Sources

Layers 2 and 3 are ported from `hachej/boring-hub`, branch `platform/v0-control` (pull requests #25, #27, #28, #30, #31), trimmed to what the deferrals name. A verified-kernel spike in Bend was tried there and did not meet its gate; its conclusion stands and is not repeated here.
