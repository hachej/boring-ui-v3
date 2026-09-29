/** The context rebuilt for every message: here the notes come with the request. */
export function context(input) {
  return { notes: Array.isArray(input.notes) ? input.notes : [] };
}
