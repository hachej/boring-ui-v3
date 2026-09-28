------------------------------ MODULE Execution ------------------------------
EXTENDS Naturals, FiniteSets

(*
Race model for one run of one actor against one file or record: start, admission,
observation, a concurrent human write, revocation, cancellation and commit
interleave freely. `receipt` records the facts that held at the moment of the
commit, so the invariants speak about that moment and not about a later state
(a human write or a cancellation after the commit is legal and changes nothing
about the receipt).
*)

CONSTANT Run, Actor, Resource, MaxRevision
VARIABLE runStatus, admitted, revoked, revision, observed, receipt

vars == <<runStatus, admitted, revoked, revision, observed, receipt>>

NoReceipt == [taken |-> FALSE, running |-> TRUE, revoked |-> FALSE, stale |-> FALSE]

Init ==
  /\ runStatus = "pending"
  /\ admitted = FALSE
  /\ revoked = FALSE
  /\ revision = 1
  /\ observed = 0
  /\ receipt = NoReceipt

Start ==
  /\ runStatus = "pending"
  /\ runStatus' = "running"
  /\ UNCHANGED <<admitted, revoked, revision, observed, receipt>>

Admit ==
  /\ runStatus = "running"
  /\ revoked = FALSE
  /\ admitted' = TRUE
  /\ UNCHANGED <<runStatus, revoked, revision, observed, receipt>>

Observe ==
  /\ runStatus = "running"
  /\ admitted
  /\ revoked = FALSE
  /\ observed' = revision
  /\ UNCHANGED <<runStatus, admitted, revoked, revision, receipt>>

HumanWrite ==
  /\ revision < MaxRevision
  /\ revision' = revision + 1
  /\ UNCHANGED <<runStatus, admitted, revoked, observed, receipt>>

Revoke ==
  /\ revoked' = TRUE
  /\ UNCHANGED <<runStatus, admitted, revision, observed, receipt>>

Cancel ==
  /\ runStatus = "running"
  /\ runStatus' = "cancelled"
  /\ UNCHANGED <<admitted, revoked, revision, observed, receipt>>

Commit ==
  /\ ~receipt.taken
  /\ revision < MaxRevision
  /\ admitted
  /\ runStatus = "running"
  /\ ~revoked
  /\ observed = revision
  /\ receipt' = [taken |-> TRUE, running |-> runStatus = "running", revoked |-> revoked, stale |-> observed # revision]
  /\ revision' = revision + 1
  /\ UNCHANGED <<runStatus, admitted, revoked, observed>>

Next == Start \/ Admit \/ Observe \/ HumanWrite \/ Revoke \/ Cancel \/ Commit
Spec == Init /\ [][Next]_vars

ReceiptImpliesRunning == receipt.taken => receipt.running
NoStaleCommit == receipt.taken => ~receipt.stale
NoRevokedCommit == receipt.taken => ~receipt.revoked

=============================================================================
