# File Resource invariants

Admission and namespace confinement belong to [Environment / FS-1](../../environments/INVARIANTS.md). These laws belong to the file authority and are registered in the [Resource evidence registry](../VERIFY.json).

## FS-2 — reads identify the observed version

A read returns content and its authoritative file identity/revision. Identity includes the backing storage authority; distinct stores or address tuples cannot alias accidentally.

## FS-3 — updates require the observed revision

Every update supplies an expected revision. A mismatch changes neither content nor provenance. No blind overwrite exists unless introduced as a separately admitted operation with an explicit contract.

## FS-4 — creation is explicit

Create and update are distinct. Create fails if the address already exists; it cannot silently become an overwrite or carry an update precondition.

## FS-5 — removal preserves revision ordering

Remove requires the current revision. Deleting and recreating an address cannot make an old revision current again; the authority preserves a monotonic tombstone or equivalent generation token.

## FS-6 — adapters share one file authority

Human editing, Agent tools, dictation and viewers use the same authoritative provider or a projection of it. Cached buffers and event streams are not competing canonical files.

## FS-7 — mutation and attribution agree

Accepted writes/removes identify the admitted Job, Actor, Environment and before/after revisions. Mutation and its receipt commit or roll back together at the owning write boundary; rejected writes create neither.
