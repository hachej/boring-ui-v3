# Library-wide laws

These laws cross package boundaries. Each package owns its own laws beside its code; this file holds only what is true of the library as a whole, and the root registry holds only integration and structure evidence.

## BORING-1 — model output is never authority

A tool runs only inside a context the host admitted: one actor, one thread, one run, one set of grants. Arguments produced by a model cannot name the actor, widen a grant, or select a scope. The same holds for text in a file, a record, or a page.

## BORING-2 — every effect leaves a receipt

An accepted mutation of a file or a record identifies who (actor), through what (thread, run, tool) and on what (the resource and its revision before and after). The receipt commits or rolls back with the mutation; a rejected mutation leaves neither.

## BORING-3 — one contract, every transport

Agent tools, HTTP endpoints and the tree operate on files through one provider contract with one meaning. A local store, a directory and a remote sandbox implement that contract or refuse an operation; none degrades it silently. The same rule applies to records.

## BORING-4 — presentation requests, it never owns

The chat, the tree, UI commands and model text present state or request work. They hold no truth: a reconnecting page rebuilds everything it shows from records, and deleting a page loses nothing.

## BORING-5 — evidence matches the claim

Types, the checker, tests, bounded models and human acceptance establish different things. Every law has one definition and one owner registry. A missing tool or a failed check is never reported as passing; a deferral names the command that will replace it.

## BORING-6 — packages depend one way

`files` imports nothing from this repository. `agent` imports `files`. `chat` imports only types from `agent`, never its runtime. The policy in [ARCHITECTURE.json](ARCHITECTURE.json) is executable and `boring check` enforces it, including type-only edges and computed imports.
