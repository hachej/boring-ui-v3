# @boring/files

Files under mounts, with revisions and receipts. One provider contract serves the file tree, the HTTP endpoints and an agent's file tools, so a person, a page and a model never disagree about which file is current.

Laws: [INVARIANTS.md](INVARIANTS.md). Evidence: [VERIFY.json](VERIFY.json). Contract: [src/index.ts](src/index.ts).

Planned contents: address canonicalisation, a SQLite provider, a directory provider, a remote-sandbox adapter, HTTP routes, the `FileTree` component and its data hook.
