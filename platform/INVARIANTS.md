# Cross-platform invariants

These six laws cross primitive or execution boundaries. Detailed contracts and evidence belong to the owning primitive; this registry contains only integration and architecture evidence.

## PLATFORM-1 — authority before effect

An Actor affects a Resource only through Environment access admitted for the relevant Job/context. References, paths, graph edges, Room membership and model-supplied identifiers do not themselves grant an operation.

## PLATFORM-2 — bounded effects

Every adapter preserves or narrows the admitted operations. Long-running work defines and revalidates authority and freshness at irreversible commit; switching Actor, adapter or provider cannot bypass that boundary.

## PLATFORM-3 — attributable effects

Accepted effects/results identify the Job, Actor and relevant Resource revisions. Provenance-sensitive Agent work also identifies its definition revision. Recomposition does not rewrite prior evidence; approval binds a specific Resource revision.

## PLATFORM-4 — presentation is not authority

Apps, Experiences, Viewers, Sessions and model output present state or request operations; they do not own Job or Resource truth merely by existing. Adapters over the same Resource use the same authoritative operation semantics.

## PLATFORM-5 — evidence matches the claim

Types, lint, tests, runtime evidence, bounded models, formal proofs and human acceptance establish different claims. Every invariant has one definition and one owner registry. Deferred obligations remain explicit; missing tools and failed checks cannot become passing evidence.

## PLATFORM-6 — dependencies preserve ownership

The kernel never imports reusable Jobs, products, Experiences or concrete infrastructure. Infrastructure and compositions depend on platform contracts. Noun dependencies are acyclic, including type-only edges; shared identity types import nothing and export no behavior. The executable policy is [ARCHITECTURE.json](ARCHITECTURE.json).
