---------------------------- MODULE Idempotency ----------------------------
EXTENDS Naturals

(*
AGENT-11: request-work is idempotent by key. Several submissions of one actor
arrive concurrently, each carrying a key and a request body; the process may
restart while some are in flight, after which their callers retry. The store
keeps one row per key: the body it was recorded with and the run it created.

Reserve is atomic: looking the key up and recording it happen in one step,
as one INSERT under a primary key does. The run is recorded before it starts,
so a retry after a restart finds it (AGENT-1). A submission whose body differs
from the recorded one is refused and creates nothing.
*)

CONSTANTS Keys, Bodies, Subs, MaxRuns
VARIABLES key, body, table, status, result, nextRun, created
vars == <<key, body, table, status, result, nextRun, created>>

Runs == 1..MaxRuns
None == 0
Refused == MaxRuns + 1
Absent == [present |-> FALSE, body |-> "none", run |-> None]

Init ==
  /\ key \in [Subs -> Keys]
  /\ body \in [Subs -> Bodies]
  /\ table = [k \in Keys |-> Absent]
  /\ status = [s \in Subs |-> "new"]
  /\ result = [s \in Subs |-> None]
  /\ nextRun = 1
  /\ created = [k \in Keys |-> 0]

(* The key is free: record it with this body and a new run, in one step. *)
Reserve(s) ==
  /\ status[s] = "new"
  /\ ~table[key[s]].present
  /\ nextRun <= MaxRuns
  /\ table' = [table EXCEPT ![key[s]] = [present |-> TRUE, body |-> body[s], run |-> nextRun]]
  /\ result' = [result EXCEPT ![s] = nextRun]
  /\ status' = [status EXCEPT ![s] = "inflight"]
  /\ nextRun' = nextRun + 1
  /\ created' = [created EXCEPT ![key[s]] = @ + 1]
  /\ UNCHANGED <<key, body>>

(* The key is taken with the same body: the recorded run is the answer. *)
Repeat(s) ==
  /\ status[s] = "new"
  /\ table[key[s]].present
  /\ table[key[s]].body = body[s]
  /\ result' = [result EXCEPT ![s] = table[key[s]].run]
  /\ status' = [status EXCEPT ![s] = "done"]
  /\ UNCHANGED <<key, body, table, nextRun, created>>

(* The key is taken with another body: refused, nothing recorded. *)
Refuse(s) ==
  /\ status[s] = "new"
  /\ table[key[s]].present
  /\ table[key[s]].body # body[s]
  /\ result' = [result EXCEPT ![s] = Refused]
  /\ status' = [status EXCEPT ![s] = "done"]
  /\ UNCHANGED <<key, body, table, nextRun, created>>

Finish(s) ==
  /\ status[s] = "inflight"
  /\ status' = [status EXCEPT ![s] = "done"]
  /\ UNCHANGED <<key, body, table, result, nextRun, created>>

(* The process dies: the table and the runs persist, in-flight callers retry. *)
Restart ==
  /\ \E s \in Subs : status[s] = "inflight"
  /\ status' = [s \in Subs |-> IF status[s] = "inflight" THEN "new" ELSE status[s]]
  /\ UNCHANGED <<key, body, table, result, nextRun, created>>

Next ==
  \/ \E s \in Subs : Reserve(s) \/ Repeat(s) \/ Refuse(s) \/ Finish(s)
  \/ Restart

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ \A s \in Subs : status[s] \in {"new", "inflight", "done"}
  /\ \A s \in Subs : result[s] \in Runs \cup {None, Refused}

(* Same key, same body: one and the same run, whatever the interleaving or restart. *)
SameBodySameRun ==
  \A s, t \in Subs :
    (result[s] \in Runs /\ result[t] \in Runs /\ key[s] = key[t] /\ body[s] = body[t]) => result[s] = result[t]

(* A run is handed out only to a submission whose body is the recorded one. *)
OtherBodyRefused ==
  \A s \in Subs : (result[s] \in Runs /\ table[key[s]].present) => body[s] = table[key[s]].body

(* A key creates at most one run, across concurrency and restarts. *)
OneRunPerKey == \A k \in Keys : created[k] <= 1

=============================================================================
