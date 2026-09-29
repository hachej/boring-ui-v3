# @boring/files

Files under mounts, with revisions and receipts. One provider contract serves the agent's file tools, the host's own code and (later) the HTTP endpoints and the tree, so a person, a page and a model never disagree about which file is current.

Laws: [INVARIANTS.md](INVARIANTS.md). Evidence: [VERIFY.json](VERIFY.json). Contract: [src/index.ts](src/index.ts).

## Mounts

A mount table is what the host hands the runtime per actor (`Host.mounts(actor)`): names to providers. The names are a convention every tool and prompt can rely on:

| Mount | What | Default access |
|---|---|---|
| `code` | the application's own files: its source, its docs, whatever it wants the agent to read | read-only (`readonly(...)`) |
| `workspace` | the person's files | read-write |
| `shared` | files every actor of the deployment sees (rules, vocabulary) | read-only |
| `mnt/<name>` | an attached filesystem: a repository, a bucket, a solver's output | as the host decides |

Tools address a file as `/<mount>/<path>`; `parseAddress` picks the longest known mount, `canonicalPath` refuses traversal, encoding and aliases (FILES-5), and `mountRouter(table)` confines every call to a mount in the table.

## Providers

```ts
import { memoryProvider, directoryProvider, githubProvider, readonly, snapshotDirectory, memoryReceipts } from "@boring/files";

const receipts = memoryReceipts();                                            // or your own ReceiptLog, recording in your transaction
const workspace = memoryProvider({ seed: { "notes/today.md": "" }, receipts }); // the default virtual filesystem; revisions are a counter, every revision stays readable
const code = readonly(directoryProvider({ root: "./src" }));                   // a real folder; revision = content hash + mtime; symlinks out of the root refused
const repo = githubProvider({ owner, repo, ref: "main", auth: () => token, write: {} }); // a repository over the REST API; revision = <blob sha>.<commit sha>
const seeded = memoryProvider({ seed: snapshotDirectory("./docs") });         // a memory provider from a folder snapshot
```

Every provider: `stat`, `read` (optionally pinned to a revision: exact or `unavailable`), `list`, `write` (`{ create: true }` or `{ expectedRevision }`), `remove(expectedRevision)`. A write or removal returns its `Receipt` (`address`, `id`, `before`, `after`, `effect`, `at`) and records it in the `ReceiptLog` inside the same critical section as the change (FILES-7). Refusals are `FileProviderError`s with a code: `conflict` (with the current revision), `exists`, `missing`, `bad-address`, `readonly`, `unavailable`, `unverified`.

The GitHub provider lets GitHub decide conflicts (the blob sha goes in the request; a 409 is a conflict here), never reports a success it did not see a commit for (FILES-8), asks `auth()` per request and stores nothing, and is read-only on a pinned ref or without `write`.

The same conformance suite ([test/files/suite.ts](../../test/files/suite.ts)) runs against the three providers.

## Over HTTP, in a browser

`@boring/files/web` is the package without `node:fs`: the contract, addresses, the memory and read-only providers, and the HTTP transport. The server mounts `fileRoutes({ basePath: "/files", resolve })`, a fetch handler; `resolve(request)` returns the session's mount table and the `Effect` its receipts carry, so nothing in a request names the actor (BORING-1). The page uses `httpFiles({ endpoint: "/files" })`, a `FileProvider` whose refusals are the same `FileProviderError`s and whose transport failures are `unverified`, never success (FILES-8). The conformance suite runs against it ([test/files/routes.test.ts](../../test/files/routes.test.ts)). The tree and the other viewers are in [`@boring/viewers`](../viewers).

## Not yet

A SQLite provider; a byte-level read for binary files (images are text or data URLs today).
