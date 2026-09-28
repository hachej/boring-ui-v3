# Relationships and their owners

[RELATIONSHIPS.json](RELATIONSHIPS.json) records the semantic graph and cardinalities. Its edges describe composition, attribution or discovery; actual authority comes from admitted Environment operations under [PLATFORM-1](INVARIANTS.md#platform-1--authority-before-effect).

| Relationship responsibility | Canonical laws |
|---|---|
| Job definition, inputs, outputs and child composition | [JOB-1–4](jobs/INVARIANTS.md) |
| Environment bound to Job, Actor and resource grants; no child authority inheritance | [ENVIRONMENT-2](environments/INVARIANTS.md#environment-2--admission-bounds-operations) |
| Resource identity, revisions and references | [RESOURCE-1–3](resources/INVARIANTS.md) |
| Actor identity and Agent definition provenance | [ACTOR-1](actors/INVARIANTS.md#actor-1--attributable-identity) |
| Adapter parity, immutable provenance and presentation boundaries | [PLATFORM-2–4](INVARIANTS.md) |

An authority-bearing relationship change is an architecture change. It needs a stated meaning, cardinality, owning contract and evidence there, rather than a second relationship-level invariant or test registry here.


## Experience composition

Experience is not a noun or authority boundary. It is a non-authoritative composition that may project Resources and Jobs, request admitted Job creation, and adapt admitted Environment operations into human controls.

```text
Experience -> requests/projects Job
Experience -> projects Resource
Experience -X-> authority
```

## Deferred Room

Room is not part of the MVP kernel. The previous Room draft is intentionally deferred until a concrete collaboration consumer demonstrates independent membership/lifecycle/authority requirements.
