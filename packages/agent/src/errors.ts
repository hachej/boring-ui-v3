/**
 * Error classes shared by the runtime and the definitions, apart from src/index.ts so that no runtime
 * module imports a value back from the package entry (no import cycle).
 */

/** Thrown by a definition's validator; its message goes back to the model for a repair. */
export class OutputError extends Error {}
