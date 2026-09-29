---
name: verify-boring
description: Verify a Boring change by running it. Brings up an isolated copy of the example app for this checkout (own ports, data dir and headless browser), seeds it through the wire, drives it like a person and a client — the conversation, runs and jobs on the wire, the chat page in the browser — then reads the records (runs, events, receipts, usage) as evidence. Use after changing a package or the example, when reproducing a bug, or when deciding what evidence a change needs.
---

# Verify Boring

Run the example app, put it in the state the change needs, drive the feature the way a person or a client reaches it, and show the observable end state. `node bin/boring.mjs --help` is the canonical command surface; this page is how to use it. The feature map under [`features/`](features/README.md) says what exists, how it is reached, how to drive it and what usually misleads.

## Launch

One environment per checkout: ports and the data dir are derived from the checkout path, so parallel checkouts never collide. The app is `examples/notes` (two agents, one job, one conversation) with the fake model unless you ask for a real one.

```bash
node bin/boring.mjs env up --seed asked            # fake model, fresh data, chat page built, headless browser
node bin/boring.mjs env up --seed digested --model openrouter/openai/gpt-4o-mini   # a real model (OPENROUTER_API_KEY)
node bin/boring.mjs env seeds | env info
```

`--restart` replaces a running environment; `--keep-data` keeps its records across the restart; `--no-browser` skips Chromium. Seeds go in through the wire, the same calls a client makes: `empty`, `asked`, `conversation`, `summarised`, `digested`.

## Doctor

Run it first, and again whenever anything looks off.

```bash
node bin/boring.mjs doctor
```

It reports the toolchain (Node 22, Java 17 and the pinned TLC, oxlint, Chromium, playwright-core, the built page, the OpenRouter key) and the instance: running, answering from its own pid on its own port, **not STALE**, browser up. An app started before your last source change is not evidence: `env up --restart`.

## Drive

Read the feature file for the change (`node bin/boring.mjs features`, then `features/<surface>.md`). Compose the controls; every command prints JSON with `--json`.

```bash
node bin/boring.mjs send "What do I need to buy?" --wait      # a conversation turn on the wire, until settled
node bin/boring.mjs chat                                       # the thread as the person sees it, replayed by cursor
node bin/boring.mjs tool summarise '{"note":"Buy milk."}' --key k1 --wait   # one agent's run, idempotent by key
node bin/boring.mjs job digest '{"notes":["a","b"]}' --wait    # a job of predeclared children
node bin/boring.mjs runs && node bin/boring.mjs run <id>       # the records, a run with its events
node bin/boring.mjs trace <id>                                 # input, events, receipts, usage of one run
node bin/boring.mjs log --run <id>                             # everything recorded, in order
node bin/boring.mjs type "input[aria-label=message]" "Which note mentions milk?" && node bin/boring.mjs click "button[type=submit]"
node bin/boring.mjs wait-for "[data-boring-chat] li[data-role=agent]" && node bin/boring.mjs wait-settle
node bin/boring.mjs snapshot "[data-boring-chat]" && node bin/boring.mjs screenshot .cache/evidence/<time>/page.png
node bin/boring.mjs reload                                     # the thread id is in the URL hash; the transcript rebuilds
node bin/boring.mjs goto "/#thread=<id>"                       # open a known thread in the tab
```

Do not write one-off scripts. If a step you need is missing, add it to `tools/control.mjs`, to `bin/boring.mjs --help` and to this skill in the same change.

## Proof bar

- Drive the production path: the wire (`send`, `tool`, `job`, `cancel`) and the page (`type`, `click`, `press`). `eval` reads state afterwards; it never performs the action under test.
- Cover the entry points and the success, refusal, empty, cancel and persistence paths the change can affect (each feature file lists them), and the multi-surface journeys in the README when the change spans surfaces.
- Wait on end states: `wait-settle` for the records, `wait-for` for the DOM. Never sleep.
- Show side effects, not pixels: `trace` for receipts and usage, `runs` after `env up --restart --keep-data`, `chat` replayed twice, a second actor's 404 (`curl -H "x-dev-actor: other"`).
- The fake model proves library behavior only. Anything the model decides (an answer's content, a summary's quality) needs a `--model openrouter/...` run, judged by a person.
- Keep evidence under `.cache/evidence/<time>/` (command output, screenshots, `smoke.json`). Name every path you could not reach and why (`doctor` usually says).

## Evidence beneath the running app

```text
boring check / lint / typecheck      package direction, laws and registries, types
boring test                          the node tests (test/agent, test/chat, test/architecture)
boring env … (this skill)            the real user and client path
boring model / test:formal / verify  bounded models with mutants, the full evidence registry
human/domain acceptance              where required (a real model's output)
```

`boring smoke` is the deterministic journey CI runs on a throwaway instance with the fake model, built from the same controls. It guards regressions and backs the registry entries that name it; it does not replace driving the feature you changed.

## Clean up

```bash
node bin/boring.mjs env down           # stop the app and its browser
node bin/boring.mjs env down --clean   # and delete .cache/env/
```

## Report

State the feature files you used, the commands you ran and what you observed, the laws involved (each feature file names them), the evidence directory, and every path you did not cover and why.
