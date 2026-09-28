# Filesystem admission

A filesystem is Environment operations over file Resources, not an additional primitive.

[ENVIRONMENT-2 and FS-1](INVARIANTS.md) own admission and namespace confinement. [The Resource file contract](../resources/filesystem/INVARIANTS.md) owns read, mutation, revision and receipt semantics. Those contracts have separate owner registries; this page adds no laws or API sketch.

The host maps a mount name to a provider and stable storage authority. That mapping is deployment configuration, not a second grant system. The Actor receives bounded operations over mount/path addresses, not unrestricted host paths or the raw provider.

The first scope is text files, exact/subtree grants and explicit create/update/remove. POSIX permissions, symlinks, shell operations, search/watch and cross-mount transactions await a concrete consumer and their own protocols.

Human editing, Agent tools and transcription are adapters over those same admitted operations. Executable signatures belong to their TypeScript definitions; consumer motivation lives in the consumer's repository.

The v0 uses [admission](admission.ts) and [operation closures](filesystem.ts) over the synchronous [provider contract](../resources/filesystem/filesystem.ts); [database closures](database.ts) do the same for an app's [database Resource](../resources/database/database.ts) with the same grant model. An Environment is admitted from a Job record. Grant inputs are detached and frozen; the host's required `isActive` callback is checked at every operation. Canonical paths are required before provider access. Remote providers need a different commit-time protocol.
