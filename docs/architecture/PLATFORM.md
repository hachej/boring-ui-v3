# Why a Job-driven platform

The starting point is an outcome a person wants achieved. A Job preserves that intent while its realization changes. A registry can index reusable, versioned Job definitions; it does not need a new kind of authority or a sixth primitive.

At a particular time, a person's Experience presents the useful composition of Jobs and Resources. Replacing that Experience or an Agent should be cheap because neither owns the underlying outcome or authoritative material.

## Why these four nouns

| Owner | Independent responsibility | Canonical contract |
|---|---|---|
| Job | Outcome and work lifecycle | [Job laws](../../platform/jobs/INVARIANTS.md) |
| Resource | Identified state and revision semantics | [Resource laws](../../platform/resources/INVARIANTS.md) |
| Actor | Attribution and configured behavior | [Actor laws](../../platform/actors/INVARIANTS.md) |
| Environment | Admitted effects | [Environment laws](../../platform/environments/INVARIANTS.md) |

Room is deferred: it earns a place only when a consumer needs independently governed collaboration (membership, lifecycle, authority) that composition cannot express. A single-user Job does not need a Room; membership and execution admission remain different responsibilities. See [Relationships](../../platform/RELATIONSHIPS.md#deferred-room).

## Why other concepts stay compositions

- A workflow or plan composes Jobs; a registry indexes definition Resources.
- An Agent is a configured Actor. Instructions, skills and code are Resources.
- An Experience presents and requests work; a Viewer specializes Resource interaction; an App packages software.
- An artifact is a Resource with provenance. Approval binds an Actor's decision to an identified revision.
- Sessions and attempts stay execution/history details until a consumer demonstrates an independent lifecycle that needs a new primitive.

The older Boring UI plans used Workspace for product/tenant policy context and Action for an admitted operation or execution attempt. Those responsibilities survive through admission and Job history without introducing two more nouns.

## Why implementation boundaries differ from nouns

A cell, Durable Object, database or container is a mechanism. Its boundary follows serialization, locality and lifecycle needs; five nouns do not imply five services or one cell per object.

Tiny identity references live in the type-only [identity boundary](../../platform/identity.ts). That file has no imports or behavior. It lets nouns refer to identity without importing another noun's implementation. The [architecture policy](../../platform/ARCHITECTURE.json) rejects cycles even when every edge is type-only.

Infrastructure depends on platform contracts and supplies implementations at the host. This repository holds the kernel first; providers, the agent runtime, reusable Jobs and Experiences are added in the order [the roadmap](ROADMAP.md) states, each behind the layer policy in [ARCHITECTURE.json](../../platform/ARCHITECTURE.json).

## Where to read next

[Cross-cutting laws](../../platform/INVARIANTS.md) define the shared obligations. [Relationships](../../platform/RELATIONSHIPS.md) point to their owners. Each primitive owns its evidence registry. [the method](METHOD.md) explains how these decisions are revised.
