# Why this architecture method

A small kernel makes agent-generated changes easier to review: there are fewer places to own state, grant authority or reinterpret a result. Complexity comes from composing existing concepts.

A concept earns primitive status when concrete consumers need an independent identity, lifecycle or authority boundary that composition cannot express clearly. A folder, class or useful product word is insufficient evidence.

The working loop is:

1. Identify the outcome and the owner of each state transition.
2. Describe the relationships and a counterexample to each important guarantee.
3. Put the guarantee beside its owner and choose evidence that can actually test it.
4. Build one consumer path; use failures to revise the contract.

Static dependency rules suit import checks. Ordering, stale state and revocation suit state exploration. Runtime behavior needs runtime evidence. General proofs become useful when the semantics are stable enough to justify a theorem. Safety and eventual progress are separate questions; uncontrolled providers cannot promise unconditional completion.

The canonical evidence rule is [BORING-5](../../INVARIANTS.md#boring-5--evidence-matches-the-claim). [FORMAL.md](FORMAL.md) records the bounds and assumptions of the models; this page does not define another verification protocol.

## Influences

Lauren Tan's Dune examples and the Poteto workflow motivated obvious ownership, enforced boundaries and moving recurring review corrections into durable checks. The talk (Lauren Tan, @poteto, on cursor-compile and verification skills) is credited here; its transcript is kept privately with the hub's sources, and the pattern is public in [poteto/verification-skill-example](https://github.com/poteto/verification-skill-example). That records the influence; it does not supply the platform's vocabulary.

[The library's design](LIBRARY.md) applies this method; an application's own rationale lives in that application. Executable contracts and laws live under `packages/`.
