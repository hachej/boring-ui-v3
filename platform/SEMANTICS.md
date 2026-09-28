# Platform semantics

Boring is modeled as a state-transition system. The executable mathematical definition is [formal/Boring.lean](formal/Boring.lean).

## Kernel

- `State` — authoritative platform state relevant to a specification.
- `Environment` — Job/Actor-bound admitted authority.
- `Operation` — an effect request.
- `Admitted(env, op)` — the operation matches the Environment's Job, Actor and authority.
- `Step(s, env, op, s')` — a specification-defined legal transition.
- `Invariant : State → Prop` — a property that must hold for reachable states.
- `Reachable` — states produced from an initial state by zero or more Steps.

The central induction theorem in Lean is:

```text
initial states satisfy I
+
every Step preserves I
----------------------
every reachable state satisfies I
```

## Local extension

Each semantic owner extends this kernel beside its implementation:

```text
platform/jobs/Job.lean
platform/resources/Resource.lean
platform/actors/Actor.lean
platform/environments/Environment.lean
```

Reusable Jobs may extend it too, beside their `SPEC.md`, once they exist (layer 3 in [the roadmap](../docs/architecture/ROADMAP.md)).

Lean checks abstract semantic laws. TLA+ explores bounded concurrency/interleavings. Runtime tests exercise concrete correspondence cases; none of these currently proves TypeScript refinement. See [formal scope and commands](formal/README.md).

Do not encode presentation details or incidental implementation choices in Lean. Add a formal definition when its truth should survive a change of UI, provider or runtime.
