import platform.formal.Boring

namespace Boring.Environment

def derive (parent requested : Boring.Authority) : Boring.Authority :=
  { grants := fun capability =>
      parent.grants capability && requested.grants capability }

theorem derive_le_parent (parent requested : Boring.Authority) :
    (derive parent requested).le parent := by
  intro capability h
  simp [derive] at h
  exact h.1

theorem derive_le_requested (parent requested : Boring.Authority) :
    (derive parent requested).le requested := by
  intro capability h
  simp [derive] at h
  exact h.2

theorem admitted_binds_job_actor (env : Boring.Environment) (op : Boring.Operation)
    (h : Boring.Admitted env op) :
    op.job = env.job ∧ op.actor = env.actor := by
  exact ⟨h.1, h.2.1⟩

end Boring.Environment
