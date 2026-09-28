# Why three packages

An application that wants an agent needs three things that are different in kind: somewhere to talk (a component in its page), something that acts (a loop in its backend), and a safe way for that loop to touch files (a store with revisions). They change at different speeds, are installed by different code, and one can be used without the others. So they are three packages.

`files` is first because both other packages lean on it and it depends on nothing. `agent` is second: it mounts in the application's backend and reaches files only through the contract. `chat` is last and thinnest: it renders the wire and forwards a person's words and answers.

## What a package owns

- **files** owns identity, revisions, receipts and confinement for files, and the promise that every transport sees the same file. It does not know what an agent is.
- **agent** owns threads, runs, admission, attribution, decisions and metering, and the Host contract through which the application supplies identity, roles, mounts, credentials and budgets. It does not render anything.
- **chat** owns rendering and the page-command bridge. It holds no truth and no layout.

## What the application owns

Its database and records, its authentication and roles, its credentials, its budgets, its screens and its deploy. The library asks for each of these through the Host contract and through registration, and it never takes a decision that belongs to the application.

## What lives elsewhere

A platform that builds apps, publishes versions and distributes them to many people, with identity across tenants and cells, is a consumer of this library, not part of it. Reusable work such as transcription or review is a composition an application or that platform builds with `@boring/agent`; it enters this repository only as an example.

## Method

The laws, their registries and the checker follow [METHOD.md](METHOD.md): a law has one owner, evidence matches the claim, deferrals are explicit, and a bounded model is written only where a real race exists. Two exist today, both about commits under concurrency, and they are the only formal models in the tree.
