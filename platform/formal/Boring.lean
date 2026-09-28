namespace Boring

abbrev JobId := String
abbrev ResourceId := String
abbrev ActorId := String
abbrev EnvironmentId := String
abbrev RoomId := String

structure Authority where
  grants : String → Bool

def Authority.le (child parent : Authority) : Prop :=
  ∀ capability, child.grants capability = true → parent.grants capability = true

theorem Authority.le_refl (a : Authority) : a.le a := by
  intro capability h
  exact h

theorem Authority.le_trans {a b c : Authority} (hab : a.le b) (hbc : b.le c) : a.le c := by
  intro capability h
  exact hbc capability (hab capability h)

structure State where
  revision : ResourceId → Nat

structure Environment where
  id : EnvironmentId
  job : JobId
  actor : ActorId
  authority : Authority

structure Operation where
  job : JobId
  actor : ActorId
  capability : String

def Admitted (env : Environment) (op : Operation) : Prop :=
  op.job = env.job ∧
  op.actor = env.actor ∧
  env.authority.grants op.capability = true

abbrev Invariant := State → Prop

def Preserves (Step : State → Environment → Operation → State → Prop)
    (I : Invariant) : Prop :=
  ∀ s env op s', I s → Step s env op s' → I s'

inductive Reachable
    (Init : State → Prop)
    (Step : State → Environment → Operation → State → Prop) : State → Prop
  | init {s} : Init s → Reachable Init Step s
  | step {s env op s'} :
      Reachable Init Step s →
      Step s env op s' →
      Reachable Init Step s'

theorem invariant_of_reachable
    (Init : State → Prop)
    (Step : State → Environment → Operation → State → Prop)
    (I : Invariant)
    (initial : ∀ s, Init s → I s)
    (preserved : Preserves Step I) :
    ∀ s, Reachable Init Step s → I s := by
  intro s h
  induction h with
  | init hi => exact initial _ hi
  | step hr hs ih => exact preserved _ _ _ _ ih hs

end Boring
