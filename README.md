# Boring

A library for putting an agent next to an application. The application keeps its backend, its database, its auth and its deploy. Boring adds three things it can install separately:

| Package | What it gives you |
|---|---|
| [`@boring/agent`](packages/agent) | A durable agent loop mounted in your backend: threads, runs, tools admitted before they run, a receipt for every effect, questions and approvals as records, usage metered per actor. |
| [`@boring/chat`](packages/chat) | One React component that shows a thread and talks to that loop. Place it anywhere. Register the page commands the agent may use. |
| [`@boring/files`](packages/files) | Files under mounts, with revisions and receipts, behind one provider contract that the tree, the HTTP endpoints and the agent's tools all share. Local store, directory or remote sandbox. |

`agent` depends on `files`. `chat` depends on the agent's wire types only. `files` depends on nothing here. That direction is written in [ARCHITECTURE.json](ARCHITECTURE.json) and enforced by `boring check`.

## What makes it different from a raw agent framework

The loop is what any framework gives you. The library is what an application needs around it: model output is never authority, every effect is attributed and revision-checked, human decisions are rows the model cannot fake, roles and budgets stay the application's, and `boring env up` runs your app with a scripted model and reads the receipts to prove it.

## Laws and evidence

Each package owns its laws in `INVARIANTS.md` and the evidence for them in `VERIFY.json`. The [library-wide laws](INVARIANTS.md) cover what crosses packages. A law is either backed by a command or a bounded model, or it is an explicit deferral naming the command that will replace it. `boring verify` runs all of it and never counts a deferral as passing.

## Commands

```bash
npm ci --ignore-scripts
npm run setup:formal      # pinned TLC
npm run check             # package direction, laws and registries present
npm run typecheck         # the three public contracts together
npm run verify            # every registered evidence: tests, TLA+ models; deferrals listed
node examples/notes/server.mjs   # the sample app on :8787 with a scripted model (OPENROUTER_API_KEY for a real one)
node bin/boring.mjs --help
```

`verify` needs Node 22 and Java 17+. CI runs the same gate on every push.

## Where this stands

Contracts, laws, registries, the checker and the two models were the skeleton. `@boring/agent` now exists: definitions as files, the Flue-backed runtime with receipts, metering, validated outputs and repair, the HTTP wire and the manifest, driven end to end by [examples/notes](examples/notes). `@boring/chat` has its client and a minimal `BoringChat`. `@boring/files` is still its contract. The rest arrives in the order of [the roadmap](docs/architecture/ROADMAP.md). The method comes from [docs/architecture/METHOD.md](docs/architecture/METHOD.md); the reasons for three packages are in [docs/architecture/LIBRARY.md](docs/architecture/LIBRARY.md).

## History

The laws and the verification method were first built as a platform kernel in `hachej/boring-hub` (pull requests #24 to #32) and moved here in commit `211649a`. They were then rewritten for a library. The earlier hub-shell registry plan is in commit `a0ef51e`.
