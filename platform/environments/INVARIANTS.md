# Environment invariants

## ENVIRONMENT-1 — coherent effect boundary

Operations expose the owning Resource's authoritative state and revision semantics. An Environment cannot silently introduce another canonical copy.

## ENVIRONMENT-2 — admission bounds operations

An issued Environment binds one Job execution context, Actor and attenuated resource/operation grants. Execution cannot swap that binding through payload identifiers. Adapters and providers cannot widen it; child Jobs receive their own admission, never ambient parent authority. Revocation, lifecycle and expiry are checked according to the operation's commit policy.

## ENVIRONMENT-3 — implementation is replaceable

A different provider or sandbox preserves the Job/Resource contract, including admission and concurrency. An asynchronous provider must define commit-time authorization rather than assume an earlier check is still valid.

## ENVIRONMENT-4 — namespace confinement

Every operation resolves through an admitted grant: one space (a mount, a database) and one exact, subtree or whole-space name pattern inside it. Policy and storage use the same canonical relative name; traversal, decoding, symlinks or aliases cannot escape that scope. Space and name are distinct tuple components, and a space prefix keeps mounts and databases apart whatever they are called.
