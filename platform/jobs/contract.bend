# Minimal formal Job contract algebra. Facts are deliberately small and product-agnostic.
import Base

type Stage is Data:
  Audio{}
  DraftTranscript{}
  ApprovedTranscript{}

# What a Job promises: the stage it needs, the stage it delivers, and whether the
# delivering effect must be authorized and attributed.
type Contract is Data:
  Contract{input_stage: Stage, output_stage: Stage, requires_authority: Bool, requires_attribution: Bool}

# What the host recorded when a Job completed.
type Evidence is Data:
  Evidence{source_revision: U32, output_revision: U32, stage: Stage, authorized: Bool, attributed: Bool}

def stage_eq(a: Stage, b: Stage) -> Bool:
  match a b:
    case Audio{} Audio{}: True{}
    case DraftTranscript{} DraftTranscript{}: True{}
    case ApprovedTranscript{} ApprovedTranscript{}: True{}
    case _ _: False{}

def input_of(c: Contract) -> Stage:
  match c:
    case Contract{i, _, _, _}: i

def output_of(c: Contract) -> Stage:
  match c:
    case Contract{_, o, _, _}: o

def accepts(c: Contract, e: Evidence) -> Bool:
  match c e:
    case Contract{_, o, ra, rt} Evidence{_, _, s, auth, attr}:
      Bool.and(stage_eq(s, o), Bool.and(Bool.or(Bool.not(ra), auth), Bool.or(Bool.not(rt), attr)))

# Sequential compatibility is semantic: the first Job's promised stage must be the second's required stage.
def compatible(first: Contract, second: Contract) -> Bool:
  stage_eq(output_of(first), input_of(second))

def compose(first: Contract, second: Contract) -> Contract:
  match first second:
    case Contract{i, _, a1, t1} Contract{_, o, a2, t2}:
      Contract{i, o, Bool.or(a1, a2), Bool.or(t1, t2)}
