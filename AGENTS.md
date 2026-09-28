# Working in this repository

Read [README.md](README.md) and [docs/architecture/ROADMAP.md](docs/architecture/ROADMAP.md) first.

- Run `npm run check` and `npm run verify` before and after a change. `verify` prints deferrals; a change that adds behavior turns the deferral it covers into a command, in the same change.
- Add a law only beside its owner (`platform/<noun>/INVARIANTS.md`) with an entry in that owner's `VERIFY.json`. Cross-cutting laws live in `platform/INVARIANTS.md`. Never define the same law twice.
- Do not add a noun, a layer or an external dependency without changing `platform/ARCHITECTURE.json`; `boring check` will refuse it otherwise.
- Product vocabulary (a clinic, a note, a patient) never enters `platform/`. Products are bundles the platform stores and runs.
- Verify by driving the running app with `boring` once the host exists (layer 2). Until then, evidence is tests, models and the Lean build.
- Keep documents short. Explain a decision once, in the file that owns it, and link to it from elsewhere.
