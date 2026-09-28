# Job invariants

## JOB-1 — Job is outcome, realization is replaceable

A Job binds an exact definition Resource revision and its immutable outcome contract. Replacing its Actor, realization, provider or Experience cannot silently weaken the goal, acceptance conditions, constraints or assumptions in that contract. A registry indexes definition Resources; it grants no authority.

## JOB-2 — recursive composition preserves completion

A parent succeeds only when its required children and acceptance conditions satisfy its composition contract. The implementation states when that required set is frozen and how replanning is represented.

## JOB-3 — history is not rewritten

Retry or recomposition preserves the identity and evidence of prior completed, failed or cancelled work. An independent attempt identity needs demonstrated scheduling/recovery semantics; it is not a default new noun.

## JOB-4 — reusable contracts are explicit and product-agnostic

Each root `jobs/<name>/` declares purpose, input/output Resource contracts, Actor requirements, Environment needs, invariants and verification in `SPEC.md`. Product schemas, prompts, acceptance rules and UI assumptions stay in product repositories. Declaring a need does not grant authority.


## JOB-CONTRACT-1 — composition must satisfy semantic contracts

A reusable Job definition may carry a formal contract over its required input state, promised successful output state, required authority, attribution and explicit assumptions.

Sequential composition is valid only when the first Job's promised postcondition satisfies the next Job's precondition; matching value shapes alone is insufficient.

A stronger enclosing goal is satisfied only when the composed contract establishes that stronger outcome. In particular, producing a draft transcript does not satisfy a goal requiring an approved transcript.

Formal success does not manufacture domain truth: empirical or expert claims such as transcription accuracy remain assumptions/evidence unless independently checkable.


## JOB-5 — requesting work is an admitted effect

Creating a Job changes authoritative platform state. An Experience or Actor may request work, but the platform admits Job creation against trusted Actor/context policy before persisting it.

## JOB-6 — approval is a revision-bound human Job

Approval is not a Boolean field an Agent may manufacture. It is evidence produced by a human-Actor Job whose input identifies an exact Resource revision and whose output records that Actor's decision for that revision. A later Resource revision requires a new decision when approval is required.
