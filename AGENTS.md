# Working in this repository

Read [README.md](README.md), [docs/architecture/LIBRARY.md](docs/architecture/LIBRARY.md) and [docs/architecture/ROADMAP.md](docs/architecture/ROADMAP.md) first.

- Run `npm run check`, `npm run lint`, `npm run typecheck`, `npm test` and `npm run verify` before and after a change. A change that adds behavior turns the deferral it covers into a command in the same change.
- A law lives beside its owner (`packages/<name>/INVARIANTS.md`) with an entry in that package's `VERIFY.json`. Library-wide laws live in the root `INVARIANTS.md`. Never define the same law twice; never restate another package's law.
- A package imports only what [ARCHITECTURE.json](ARCHITECTURE.json) allows. Adding a package, an edge or an external dependency is a policy change first.
- The public contract of a package is `src/index.ts`. Change it deliberately; it is what an application installs.
- Application vocabulary (a patient, a shift, a note) never enters a package. The library speaks in actors, threads, runs, tools, mounts, files, receipts and decisions.
- Roles, budgets and credentials are the application's. The library asks the host; it never decides.
- Verify by running: `node bin/boring.mjs env up`, then drive the change with the controls and read the records, following [.agent/skills/verify-boring/SKILL.md](.agent/skills/verify-boring/SKILL.md) and its feature map. Keep evidence under `.cache/evidence/`. Tests and models are the evidence beneath it; `boring smoke` is the CI guard, not a substitute.
- Law ids are stable and indexed in [docs/LAWS.md](docs/LAWS.md); the hub cites them. Add a row there with any new law.
- Keep documents short. Explain a decision once, in the file that owns it.
