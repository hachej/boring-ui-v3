------------------------------ MODULE Execution ------------------------------
EXTENDS Naturals, FiniteSets

(*
Cross-noun race model for one Job, one Actor and one Resource: start, admission,
observation, a concurrent human write, revocation, cancellation and commit
interleave freely. `receipt` records the facts that held at the moment of the
commit, so the invariants speak about that moment and not about a later state
(a human write or a cancellation after the commit is legal and changes nothing
about the receipt).
*)

CONSTANT Job, Actor, Resource, MaxRevision
VARIABLE jobStatus, admitted, revoked, revision, observed, receipt

vars == <<jobStatus, admitted, revoked, revision, observed, receipt>>

NoReceipt == [taken |-> FALSE, running |-> TRUE, revoked |-> FALSE, stale |-> FALSE]

Init ==
  /\ jobStatus = "pending"
  /\ admitted = FALSE
  /\ revoked = FALSE
  /\ revision = 1
  /\ observed = 0
  /\ receipt = NoReceipt

Start ==
  /\ jobStatus = "pending"
  /\ jobStatus' = "running"
  /\ UNCHANGED <<admitted, revoked, revision, observed, receipt>>

Admit ==
  /\ jobStatus = "running"
  /\ revoked = FALSE
  /\ admitted' = TRUE
  /\ UNCHANGED <<jobStatus, revoked, revision, observed, receipt>>

Observe ==
  /\ jobStatus = "running"
  /\ admitted
  /\ revoked = FALSE
  /\ observed' = revision
  /\ UNCHANGED <<jobStatus, admitted, revoked, revision, receipt>>

HumanWrite ==
  /\ revision < MaxRevision
  /\ revision' = revision + 1
  /\ UNCHANGED <<jobStatus, admitted, revoked, observed, receipt>>

Revoke ==
  /\ revoked' = TRUE
  /\ UNCHANGED <<jobStatus, admitted, revision, observed, receipt>>

Cancel ==
  /\ jobStatus = "running"
  /\ jobStatus' = "cancelled"
  /\ UNCHANGED <<admitted, revoked, revision, observed, receipt>>

Commit ==
  /\ ~receipt.taken
  /\ revision < MaxRevision
  /\ admitted
  /\ jobStatus = "running"
  /\ ~revoked
  /\ observed = revision
  /\ receipt' = [taken |-> TRUE, running |-> jobStatus = "running", revoked |-> revoked, stale |-> observed # revision]
  /\ revision' = revision + 1
  /\ UNCHANGED <<jobStatus, admitted, revoked, observed>>

Next == Start \/ Admit \/ Observe \/ HumanWrite \/ Revoke \/ Cancel \/ Commit
Spec == Init /\ [][Next]_vars

ReceiptImpliesRunning == receipt.taken => receipt.running
NoStaleCommit == receipt.taken => ~receipt.stale
NoRevokedCommit == receipt.taken => ~receipt.revoked

=============================================================================
