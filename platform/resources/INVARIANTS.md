# Resource invariants

## RESOURCE-1 — authoritative identity/state

A Resource has one authoritative identity/state. Human UI, Agent, filesystem operations, services and execution must not silently operate on contradictory canonical copies presented as the same Resource.

## RESOURCE-2 — explicit concurrency

Every mutable Resource kind defines stale/concurrent-write behavior. Delayed work cannot silently overwrite a newer authoritative revision unless that behavior is explicitly part of the Resource contract.

## RESOURCE-3 — code is Resource

Source code, instructions, manifests, migrations and configuration are Resources with appropriate semantics/permissions. Executing code is Environment behavior, not a different ontology.


File-specific obligations live in [filesystem/INVARIANTS.md](filesystem/INVARIANTS.md) and this noun’s evidence registry.
