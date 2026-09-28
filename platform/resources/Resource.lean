import platform.formal.Boring

namespace Boring.Resource

structure Write where
  resource : Boring.ResourceId
  expectedRevision : Nat

abbrev current (s : Boring.State) (w : Write) : Prop :=
  s.revision w.resource = w.expectedRevision

def commit (s : Boring.State) (w : Write) : Boring.State :=
  if current s w then
    { revision := fun id => if id = w.resource then s.revision id + 1 else s.revision id }
  else s

theorem stale_write_is_noop (s : Boring.State) (w : Write)
    (h : ¬ current s w) :
    commit s w = s := by
  simp [commit, h]

end Boring.Resource
