// The digest job: plan one summarise child per note; collect the summaries in order.
export function plan(input) {
  const notes = Array.isArray(input.notes) ? input.notes : [];
  if (!notes.length) throw new Error("notes: at least one note is required");
  return notes.map(note => ({ agent: "summarise", input: { note } }));
}

export function collect(results) {
  return { summaries: results.map(r => r.output) };
}
