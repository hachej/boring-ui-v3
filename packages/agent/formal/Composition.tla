---------------------------- MODULE Composition ----------------------------
EXTENDS Naturals, FiniteSets

(*
AGENT-12: a job's composition is predeclared. A plan names one agent per
child slot; the job starts only when every agent is declared, and refuses
before recording anything otherwise. The plan is frozen at start: a child is
recorded only from it. A child runs only under its running parent. The parent
completes only from completed children; when it fails or is cancelled, every
child still open is cancelled in the same step, so a terminal parent leaves no
recorded child unresolved. Children carry their own status: a terminal child never
changes again, whatever happens to the parent.
*)

CONSTANTS Slots, Agents, Declared
VARIABLES plan, agent, parent, child
vars == <<plan, agent, parent, child>>

Terminal == {"completed", "failed", "cancelled"}
Open(s) == child[s] \in {"pending", "running"}

Init ==
  /\ plan \in (SUBSET Slots) \ {{}}
  /\ agent \in [plan -> Agents]
  /\ parent = "pending"
  /\ child = [s \in Slots |-> "none"]

(* Start only a plan whose agents are all declared. *)
Start ==
  /\ parent = "pending"
  /\ \A s \in plan : agent[s] \in Declared
  /\ parent' = "running"
  /\ UNCHANGED <<plan, agent, child>>

(* A plan naming an undeclared agent is refused; no child is ever recorded. *)
Refuse ==
  /\ parent = "pending"
  /\ \E s \in plan : agent[s] \notin Declared
  /\ parent' = "refused"
  /\ UNCHANGED <<plan, agent, child>>

(* A child is recorded from the frozen plan, under its running parent. *)
Record(s) ==
  /\ parent = "running"
  /\ s \in plan
  /\ child[s] = "none"
  /\ child' = [child EXCEPT ![s] = "pending"]
  /\ UNCHANGED <<plan, agent, parent>>

StartChild(s) ==
  /\ parent = "running"
  /\ child[s] = "pending"
  /\ child' = [child EXCEPT ![s] = "running"]
  /\ UNCHANGED <<plan, agent, parent>>

EndChild(s, outcome) ==
  /\ child[s] = "running"
  /\ child' = [child EXCEPT ![s] = outcome]
  /\ UNCHANGED <<plan, agent, parent>>

(* The parent completes only once every planned child completed. *)
CompleteParent ==
  /\ parent = "running"
  /\ \A s \in plan : child[s] = "completed"
  /\ parent' = "completed"
  /\ UNCHANGED <<plan, agent, child>>

(* A failed or cancelled child fails the parent; its open siblings are cancelled with it. *)
FailParent ==
  /\ parent = "running"
  /\ \E s \in plan : child[s] \in {"failed", "cancelled"}
  /\ parent' = "failed"
  /\ child' = [s \in Slots |-> IF Open(s) THEN "cancelled" ELSE child[s]]
  /\ UNCHANGED <<plan, agent>>

(* The person stops the job: every open child stops with it; ended ones keep their status. *)
CancelParent ==
  /\ parent = "running"
  /\ parent' = "cancelled"
  /\ child' = [s \in Slots |-> IF Open(s) THEN "cancelled" ELSE child[s]]
  /\ UNCHANGED <<plan, agent>>

Next ==
  \/ Start \/ Refuse \/ CompleteParent \/ FailParent \/ CancelParent
  \/ \E s \in Slots : Record(s) \/ StartChild(s) \/ \E o \in Terminal : EndChild(s, o)

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ parent \in {"pending", "refused", "running"} \cup Terminal
  /\ \A s \in Slots : child[s] \in {"none", "pending", "running"} \cup Terminal

(* Refused before anything is recorded; started only with declared agents. *)
Predeclared ==
  /\ parent = "refused" => \A s \in Slots : child[s] = "none"
  /\ parent \in {"running"} \cup Terminal => \A s \in plan : agent[s] \in Declared

(* Frozen at start: no child outside the plan is ever recorded. *)
Frozen == \A s \in Slots : child[s] # "none" => s \in plan

ChildUnderRunningParent == \A s \in Slots : child[s] = "running" => parent = "running"

ParentFromCompletedChildren == parent = "completed" => \A s \in plan : child[s] = "completed"

NoUnresolvedChild == parent \in Terminal => \A s \in Slots : ~Open(s)

(* A child's terminal status is its own: nothing, including the parent's end, rewrites it. *)
ChildStatusIsOwn == [][\A s \in Slots : child[s] \in Terminal => child'[s] = child[s]]_vars

=============================================================================
