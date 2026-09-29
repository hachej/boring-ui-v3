/**
 * The library's own words (AGENT-14): what the loop writes to a model (history labels, repair and
 * refusal prompts) and to a record (failure sentences). The application chooses the language its
 * people and its prompts use; a phrase may be overridden one by one. A failure also carries a
 * stable `RunFailure` kind, so a client can word it itself.
 */
export type Language = "en" | "fr";

/** Why a run failed, stable across languages: the output never passed its contract, the host revoked it, the process stopped, or anything else. */
export type RunFailure = "invalid_output" | "revoked" | "interrupted" | "error";

export type Phrases = Readonly<{
  /** Heading of the earlier turns handed to a conversation's agent, and the two speakers. */
  earlierTurns: string;
  person: string;
  agent: string;
  /** Tool result when the output tool's arguments passed the contract. */
  recorded: string;
  /** Tool result once the run was stopped. */
  stopped: string;
  /** The instructions of an agent render whose run is gone (the process restarted). */
  interruptedTask: string;
  /** Sent to the model: its output was refused and it may try again. */
  refusedRetry: (reason: string) => string;
  /** Sent to the model: its output was refused and the repairs are spent. */
  refused: (reason: string) => string;
  /** Sent to the model: it answered in text instead of calling its output tool. */
  callTool: (tool: string) => string;
  /** Sent to the model: a markdown agent answered nothing. */
  emptyAnswer: string;
  /** The run's error when its output never passed the contract (`invalid_output`). */
  invalidOutput: (reason: string) => string;
  /** The run's error for any other failure (`error`). */
  runFailed: (reason: string) => string;
  /** The run's error after a restart (`interrupted`). */
  interrupted: string;
  /** The run's error when the host no longer allows it to act (`revoked`). */
  revoked: string;
}>;

export const PHRASES: Readonly<Record<Language, Phrases>> = Object.freeze({
  en: {
    earlierTurns: "Earlier turns", person: "Person", agent: "Agent",
    recorded: "Recorded.", stopped: "Refused: this run was stopped.",
    interruptedTask: "This task was interrupted. Reply only with the word: interrupted.",
    refusedRetry: reason => `Refused: ${reason}. Call the tool again with the complete corrected output.`,
    refused: reason => `Refused: ${reason}`,
    callTool: tool => `Call the tool ${tool} with the complete output.`,
    emptyAnswer: "Empty answer: reply with the document in markdown.",
    invalidOutput: reason => `the agent did not produce a valid output: ${reason}`,
    runFailed: reason => `run failed: ${reason}`,
    interrupted: "interrupted: the process that ran this stopped",
    revoked: "the host no longer allows this run to act",
  },
  fr: {
    earlierTurns: "Échanges précédents", person: "Personne", agent: "Assistant",
    recorded: "Enregistré.", stopped: "Refusé : cette exécution a été arrêtée.",
    interruptedTask: "Cette tâche a été interrompue. Réponds seulement par le mot : interrompu.",
    refusedRetry: reason => `Refusé : ${reason}. Rappelle l'outil avec le document complet corrigé.`,
    refused: reason => `Refusé : ${reason}`,
    callTool: tool => `Appelle l'outil ${tool} avec le document complet.`,
    emptyAnswer: "Réponse vide : rends le document en markdown.",
    invalidOutput: reason => `l'agent n'a pas produit de document valide : ${reason}`,
    runFailed: reason => `l'exécution a échoué : ${reason}`,
    interrupted: "interrompu : le processus qui l'exécutait s'est arrêté",
    revoked: "l'application n'autorise plus cette exécution à agir",
  },
});

export function phrasesFor(language: Language = "en", overrides: Partial<Phrases> = {}): Phrases {
  const base = PHRASES[language];
  if (!base) throw new Error(`unknown language "${language}" (known: ${Object.keys(PHRASES).join(", ")})`);
  return Object.freeze({ ...base, ...overrides });
}
