import platform.formal.Boring

namespace Boring.Actor

structure AgentDefinition where
  actor : Boring.ActorId
  requested : Boring.Authority

def declarationIsNotAuthority
    (definition : AgentDefinition)
    (environment : Boring.Environment) : Prop :=
  environment.authority.le definition.requested

end Boring.Actor
