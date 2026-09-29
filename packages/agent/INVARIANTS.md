# Agent laws

An agent is a definition in files (`agents/<name>/agent.md`) that the runtime turns into runs on Flue: one message in, one validated output out, helper tool calls in between. Jobs (`jobs/<name>/JOB.md`) start predeclared children; conversations (`conversations/<name>/CONVERSATION.md`) add history to one agent. The runtime is durable: its threads, runs, jobs, events, usage and receipts live in SQLite. It reaches files only through the `files` contract and records only through the host's tools. The host is the application that embeds it, and the [Host contract](src/index.ts) is the only way authority enters.

## AGENT-1 — a run is durable and ends once

A run is recorded before it starts and reaches exactly one terminal state. After a restart the loop resumes or fails the run from its records; it never re-executes an effect that already has a receipt.

## AGENT-2 — admission before effect

A tool declared as mutating runs only after the host admitted the call for this actor, thread and grants. The handler receives issued operations, never a provider, a database handle or a credential.

## AGENT-3 — declared tools only

An agent sees exactly the tools its definition declares, intersected with what the host allows for the actor. No tool appears because a file, a manifest or a model mentioned it.

## AGENT-4 — effects are attributed

Every effect a run makes carries the actor, the thread, the run and the tool, and the revisions it observed and produced. A run's text says nothing about what changed; the receipts do.

## AGENT-5 — human decisions are records

A question to the person and an approval are rows with compare-and-set, answered from the person's session. An approval binds one revision; a later revision needs a new decision. A model cannot write either row.

## AGENT-6 — stop means stop

After a cancel or a revocation no further effect commits for that run; effects already committed stay. A commit that started under a valid grant and lands after revocation is rejected.

## AGENT-7 — credentials live in the host

Model, provider and sandbox credentials are supplied by the host at mount time. They never appear in an agent definition, a tool result, a thread record or the wire.

## AGENT-8 — the host is the only source of authority

Who the actor is, what they may request, whether a run is still allowed to act, and which mounts and tools exist are answers the host gives through the Host contract. The loop caches none of them past the moment they were given.

## AGENT-9 — roles belong to the application

The library defines no role. An actor carries the application's roles as opaque strings, and every decision that depends on them (which tools are offered, which mounts, who may request a run, who may answer a question or approve) is asked of the host. The loop never compares role strings itself.

## AGENT-10 — every model call is metered

No model call happens without a usage row in the store naming actor, thread, run, agent, model and tokens, and the host is handed that row before the run continues. Budgets and quotas are host decisions taken through `mayRequest` and `isActive`; the loop supplies the numbers, never the policy.

## AGENT-11 — request-work is idempotent by key

A request that carries an idempotency key is recorded once per actor and key. Repeating it with the same request returns the recorded run, job or message; repeating it with a different request is refused. The key binds the caller, the target and the operation, never the model's output.

## AGENT-12 — a job's composition is predeclared

A job definition names the agents it may start. The plan a job makes for one input is frozen when the job starts, a child runs only under its running parent, and the parent completes only from completed children. A plan that names an undeclared agent is refused before anything is recorded.

## AGENT-13 — a page command is a request, answered once by the bound page

A page registers the commands it offers on a thread; registering grants nothing. A command is offered to a run only when its definition names it and the host allows it. Running it creates a request record bound to the page instance and the target the page reported; that page, for that actor, answers it once, and the answer says whether the page acted locally or the application committed something. A request nobody answers expires; a page that leaves or moves target ends its open requests. A page command never shadows a backend tool and never receives authority the run did not have.
