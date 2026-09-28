# Files laws

A file lives under a mount. A mount is a named space the host maps to a provider: a SQLite store, a directory, a remote sandbox. The tree, the HTTP endpoints and the agent's file tools all go through the [provider contract](src/index.ts).

## FILES-1 — a read names its revision

A read returns the content and the revision it came from. Two mounts, or two providers, cannot issue the same identity for different files.

## FILES-2 — a write names the revision it saw

An update carries the revision the writer observed. A mismatch changes nothing and returns a conflict. A blind overwrite does not exist unless a mount declares it as a separate, explicit operation.

## FILES-3 — create is not overwrite

Create fails when the address exists; update fails when it does not. Neither becomes the other by accident.

## FILES-4 — removal keeps revisions monotonic

Remove carries the current revision. Removing and recreating an address cannot bring an earlier revision back as current.

## FILES-5 — a mount confines every address

An address is a mount and a canonical relative path. Traversal, encoding, symlinks and aliases cannot leave the mount, and policy and storage compare exactly the same string.

## FILES-6 — one authority per mount

The tree, the endpoints, the agent's tools and any viewer read and write the same file through the same provider. Caches, buffers and streams are projections, never a second copy that can win.

## FILES-7 — receipt and mutation commit together

An accepted write or removal records actor, thread, run, tool and the before and after revisions, in the same transaction as the change. A rejected one records nothing.

## FILES-8 — a remote provider keeps the contract or refuses

A provider over a sandbox or a network checks the revision at commit time on the far side. When it cannot guarantee the condition, or the receipt, it rejects the operation; it never reports success it did not verify.
