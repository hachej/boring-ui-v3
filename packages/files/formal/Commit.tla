------------------------------- MODULE Commit -------------------------------
EXTENDS Naturals, FiniteSets
CONSTANTS Writers, MaxRevision
VARIABLES revision, exists, state, baseRevision, badCommit
vars == <<revision, exists, state, baseRevision, badCommit>>

Init ==
  /\ revision = 1
  /\ exists = TRUE
  /\ state = [w \in Writers |-> "idle"]
  /\ baseRevision = [w \in Writers |-> 0]
  /\ badCommit = FALSE

Read(w) ==
  /\ exists
  /\ state[w] = "idle"
  /\ state' = [state EXCEPT ![w] = "running"]
  /\ baseRevision' = [baseRevision EXCEPT ![w] = revision]
  /\ UNCHANGED <<revision, exists, badCommit>>

CommitWrite(w) ==
  /\ state[w] = "running"
  /\ exists
  /\ baseRevision[w] = revision
  /\ revision < MaxRevision
  /\ badCommit' = (badCommit \/ ~(exists /\ baseRevision[w] = revision))
  /\ revision' = revision + 1
  /\ state' = [state EXCEPT ![w] = "committed"]
  /\ UNCHANGED <<exists, baseRevision>>

Reject(w) ==
  /\ state[w] = "running"
  /\ ~exists \/ baseRevision[w] # revision
  /\ state' = [state EXCEPT ![w] = "rejected"]
  /\ UNCHANGED <<revision, exists, baseRevision, badCommit>>

HumanWrite ==
  /\ exists
  /\ revision < MaxRevision
  /\ revision' = revision + 1
  /\ UNCHANGED <<exists, state, baseRevision, badCommit>>

Delete ==
  /\ exists
  /\ revision < MaxRevision
  /\ revision' = revision + 1
  /\ exists' = FALSE
  /\ UNCHANGED <<state, baseRevision, badCommit>>

Create ==
  /\ ~exists
  /\ revision < MaxRevision
  /\ revision' = revision + 1
  /\ exists' = TRUE
  /\ UNCHANGED <<state, baseRevision, badCommit>>

Next ==
  \/ \E w \in Writers : Read(w) \/ CommitWrite(w) \/ Reject(w)
  \/ HumanWrite
  \/ Delete
  \/ Create

Spec == Init /\ [][Next]_vars
TypeOK == revision \in 1..MaxRevision /\ exists \in BOOLEAN
NoStaleCommit == ~badCommit
=============================================================================
