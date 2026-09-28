------------------------------ MODULE Lifecycle ------------------------------
EXTENDS Naturals, FiniteSets

(*
The Job lifecycle as job.ts implements it, for one parent and a bounded set
of children: children are created only while the parent is pending (the
composition freezes when it starts), a child runs only under a running
parent, the parent completes only from completed children, fails only once
every child has resolved, and cancellation cascades. Every transition may
interleave with every other; the invariants are the laws JOB-2 and JOB-3
state, checked over all reachable states.
*)

CONSTANT Children
VARIABLE parent, child, createdWhile

vars == <<parent, child, createdWhile>>
Status == {"absent", "pending", "running", "completed", "failed", "cancelled"}
Terminal == {"completed", "failed", "cancelled"}
Created == {c \in Children : child[c] # "absent"}

Init ==
  /\ parent = "pending"
  /\ child = [c \in Children |-> "absent"]
  /\ createdWhile = [c \in Children |-> "none"]

CreateChild(c) ==
  /\ child[c] = "absent"
  /\ parent = "pending"
  /\ child' = [child EXCEPT ![c] = "pending"]
  /\ createdWhile' = [createdWhile EXCEPT ![c] = parent]
  /\ UNCHANGED parent

StartParent ==
  /\ parent = "pending"
  /\ parent' = "running"
  /\ UNCHANGED <<child, createdWhile>>

StartChild(c) ==
  /\ child[c] = "pending"
  /\ parent = "running"
  /\ child' = [child EXCEPT ![c] = "running"]
  /\ UNCHANGED <<parent, createdWhile>>

ResolveChild(c, outcome) ==
  /\ child[c] = "running"
  /\ outcome \in {"completed", "failed"}
  /\ child' = [child EXCEPT ![c] = outcome]
  /\ UNCHANGED <<parent, createdWhile>>

CancelChild(c) ==
  /\ child[c] \in {"pending", "running"}
  /\ child' = [child EXCEPT ![c] = "cancelled"]
  /\ UNCHANGED <<parent, createdWhile>>

CompleteParent ==
  /\ parent = "running"
  /\ \A c \in Created : child[c] = "completed"
  /\ parent' = "completed"
  /\ UNCHANGED <<child, createdWhile>>

FailParent ==
  /\ parent = "running"
  /\ \A c \in Created : child[c] \in Terminal
  /\ parent' = "failed"
  /\ UNCHANGED <<child, createdWhile>>

CancelParent ==
  /\ parent \in {"pending", "running"}
  /\ parent' = "cancelled"
  /\ child' = [c \in Children |-> IF child[c] \in {"pending", "running"} THEN "cancelled" ELSE child[c]]
  /\ UNCHANGED createdWhile

Next ==
  \/ StartParent \/ CompleteParent \/ FailParent \/ CancelParent
  \/ \E c \in Children : CreateChild(c) \/ StartChild(c) \/ CancelChild(c)
  \/ \E c \in Children, o \in {"completed", "failed"} : ResolveChild(c, o)

Spec == Init /\ [][Next]_vars

TypeOK == parent \in Status /\ \A c \in Children : child[c] \in Status

\* JOB-2: a parent succeeds only from completed children.
NoPrematureParentCompletion == parent = "completed" => \A c \in Created : child[c] = "completed"

\* JOB-2: the required set is frozen when the parent starts.
FrozenComposition == \A c \in Created : createdWhile[c] = "pending"

\* A child never runs without a running parent.
ChildRunsUnderRunningParent == \A c \in Children : child[c] = "running" => parent = "running"

\* JOB-3: a terminal parent leaves no unresolved child behind.
TerminalParentResolvesChildren == parent \in Terminal => \A c \in Created : child[c] \in Terminal

=============================================================================
