# Database Resource invariants

An app's database is one Resource: its own store, its own schema (the app's migrations, shipped as files), one revision. Rows are the app's business; the platform owns identity, revision, admission and receipts, exactly as it does for a file. Files and databases are the two authoritative Resource kinds of the v0 and share one grant model and one effect log.

## DATABASE-1 — one revision per committed write

Every write is one transaction: all of its statements commit, the revision advances by one, and the receipt lands in the same transaction; a failed statement leaves rows, revision and log untouched. Reads never advance the revision and identify the revision their rows come from. A write may name the revision it observed, and a stale one changes nothing, so an app's read-modify-write cannot silently lose a concurrent write.

## DATABASE-2 — app tools are declared, validated and admitted

An app declares its tools as data: name, description, input schema, whether the tool mutates. The platform validates every call against the declared schema and admits it on the database (write for a mutating tool, read otherwise) before the app's handler runs; the handler receives admitted operations only and never the provider. A manifest cannot redeclare a platform tool.
