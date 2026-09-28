import platform.formal.Boring

namespace Boring.Job

inductive Status
  | pending | running | completed | failed | cancelled
  deriving DecidableEq

def resolved : Status → Prop
  | .completed | .failed | .cancelled => True
  | _ => False

structure Contract where
  accepts : Boring.State → Prop
  success : Boring.State → Prop

def ChildAuthoritySafe (parent child : Boring.Environment) : Prop :=
  child.authority.le parent.authority

theorem child_authority_transitive
    {parent child grandchild : Boring.Environment}
    (hc : ChildAuthoritySafe parent child)
    (hg : ChildAuthoritySafe child grandchild) :
    ChildAuthoritySafe parent grandchild :=
  Boring.Authority.le_trans hg hc

end Boring.Job
