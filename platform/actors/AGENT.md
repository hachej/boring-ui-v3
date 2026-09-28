# Agent configuration

An Agent is a configured Actor. Its [four Actor laws](INVARIANTS.md) own identity/provenance, output versus effect, requested versus admitted access, and credential separation. This page does not define another invariant namespace.

The configuration binds Actor identity to versioned definition, instruction and skill Resources, model selection where needed, and declared tool/file needs. The runtime pairs that configuration with a Job and an issued Environment; the declaration itself grants nothing.

Exact executable fields belong to the TypeScript contract when implemented, rather than a second schema in Markdown. Identity references come from [the neutral type boundary](../identity.ts); configured behavior remains owned here.

Sessions are interaction history. Their persistence and replay protocol can be added when a consumer needs it, without moving outcome authority into a transcript.

The host policy, executor and provider are trusted code. Model-facing tools receive issued operation closures; import checks constrain source dependencies but do not sandbox arbitrary JavaScript. Generic capabilities, budgets, live model integration and durable definition provenance require their own evidence in [VERIFY.json](VERIFY.json).

Consumer rationales (which agents a product needs, what they may touch) live with the consumer; the platform holds no second Agent specification for any product.

The v0 [AgentDefinition and execution types](agent.ts) declare the platform's `read_file` / `write_file` tools and the app's manifest tools, plus bounded grants. Each tool carries its own model-facing metadata; an app's tools are data (`tools.json`) run by the app's handler over admitted operations. The runtime that pairs this definition with a Job, selects exactly the declared tools, runs the execution as a Flue conversation (or an in-process loop for deterministic tests) and completes the Job from what the effect log says its Environment wrote is infrastructure, not part of the kernel; it arrives with layer 2 of [the roadmap](../../docs/architecture/ROADMAP.md).
