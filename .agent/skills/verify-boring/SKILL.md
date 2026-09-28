---
name: verify-boring
description: Verify a Boring change by running it. Brings up an isolated hub for this checkout (own ports, data and headless browser), seeds it into a known state, and drives it like a person — chat, app pane, agents — then reads the effect log and the agents' conversations as evidence. Use after changing platform, host, agents, an Experience or an app, when reproducing a bug, or when deciding what evidence a change needs.
---

# Verify Boring

> Status: `check`, `verify`, `model`, `nouns`, `features` and `doctor` work in this checkout. The environment, page and act commands below need the host runtime, which arrives with layer 2 of [the roadmap](../../../docs/architecture/ROADMAP.md); until then they stop with one line saying so.

Run the hub, put it in the state the change needs, drive the feature the way a person reaches it, and show the observable end state. `node bin/boring.mjs --help` is the canonical command surface; this page is how to use it.

## Launch

One environment per checkout. Ports and data are derived from the checkout path, so parallel checkouts never collide and never touch the person's own hub.

```bash
node bin/boring.mjs env up --seed note                 # scripted model, fresh data, headless browser
node bin/boring.mjs env up --seed note --model codex   # the real model (owner's pi login)
node bin/boring.mjs env up --seed note --think-ms 3000 # slow scripted agents, to drive races
node bin/boring.mjs env seeds                          # empty, note, note-without-dictation, drafted
node bin/boring.mjs env info
```

Add `--chat-bundle <dir>` (or `BORING_CHAT_BUNDLE`) to serve the chat panel bundle; without it the page uses a minimal client of the same wire. `--restart` replaces a running environment; `--keep-data` keeps its data across the restart.

## Doctor

Run it first, and again whenever anything looks off.

```bash
node bin/boring.mjs doctor
```

It reports the toolchain (TLC, Java, Lean, Bend, Chromium, Playwright, the chat panel build, the Codex login) and the instance: running, answering from its own pid, and **not STALE**. A hub started before your last source change is not evidence: `env up --restart`.

## Drive

Read the feature file for the change (`node bin/boring.mjs features`, then `features/<area>.md`). It lists every entry point, how a person reaches it, the commands and selectors, and what usually misleads.

```bash
node bin/boring.mjs send "Draft the open note from its dictation." --wait   # chat on the Flue wire, until settled
node bin/boring.mjs type "app:#title" "Renamed" && node bin/boring.mjs click "app:#saveTitle"
node bin/boring.mjs wait-settle
node bin/boring.mjs snapshot "app:#cards"          # accessibility tree of a region
node bin/boring.mjs screenshot
node bin/boring.mjs tool read_note '{"id":"<id>"}' # an app tool as the person
node bin/boring.mjs log                            # every write: revision, Actor, Job
node bin/boring.mjs trace <request job id>         # each agent's input, tool calls, reply
```

Compose these per change. Do not write one-off scripts: if a step you need is missing, add it to `tools/control.mjs` and to this skill in the same change.

## Proof bar

- Drive the production path: the chat, the app page, the host's routes. `eval` only reads state afterwards.
- Cover the entry points, modes and the success / cancel / error / empty / persistence paths the change can affect (the feature file lists them), and the journeys in `features/multi-surface-journeys.md` when the change spans surfaces.
- Wait on end states with `wait-settle`, never sleeps.
- Show side effects, not pixels: `log` attribution, `tool read_*` after `env up --restart --keep-data`, `trace` of what an agent was given.
- The scripted model proves platform behavior only. Anything the model decides needs a `--model codex` run.
- Name every path you could not reach and why (`doctor` usually says).

## Evidence beneath the running app

The running app is the top of the stack, not all of it:

```text
boring check                         architecture and registry structure
npm run typecheck / test:*           noun-local and integration tests
boring env … (this skill)            the real user path
boring model / verify                bounded models, the full evidence registry
human/domain acceptance              where required
```

`boring smoke` is a canned, deterministic walk of a few features on a throwaway hub (CI runs it). It guards against regressions; it does not replace driving the feature you changed.

## Clean up

```bash
node bin/boring.mjs env down           # stop the hub and its browser
node bin/boring.mjs env down --clean   # and delete .cache/env/
```

## Report

State the feature files you used, the commands you ran and what you observed, the laws involved (each feature file names them), and every path you did not cover and why.

## Feature map

[`features/`](features/README.md): one file per surface, each with the same four H2s — `Sub-features`, `How to get to it (user POV)`, `Driving it with boring`, `Gotchas` — plus baseline preconditions, the proof and skip rules, a sweep order and multi-surface journeys in the README. A behavior change updates its entry in the same PR.
