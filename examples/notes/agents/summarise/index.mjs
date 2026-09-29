// The summariser's contract: how its message is built from the inputs, what a valid output is,
// and how the output reads as text. Validation errors are phrased for the model: the runtime sends
// them back for a repair attempt.
import { OutputError } from "@boring/agent";

const fail = message => { throw new OutputError(message); };

/** input: { rules, note } */
export function buildMessage(input) {
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (!note) throw new Error("note is required");
  return `# Rules\n\n${input.rules.trim()}\n\n---\n\n# Note\n\n${note}`;
}

export function validate(output) {
  if (!output || typeof output !== "object") fail("expected an object");
  const { title, summary, tags } = output;
  if (typeof title !== "string" || !title.trim()) fail("title: text expected");
  if (title.length > 80) fail("title: at most 80 characters");
  if (typeof summary !== "string" || !summary.trim()) fail("summary: text expected");
  if (!Array.isArray(tags) || tags.length > 3) fail("tags: a list of at most three tags");
  if (tags.some(tag => typeof tag !== "string" || tag !== tag.toLowerCase())) fail("tags: lowercase words");
  return { title: title.trim(), summary: summary.trim(), tags };
}

export const asText = output => `**${output.title}**\n\n${output.summary}\n\n${output.tags.map(t => `#${t}`).join(" ")}`;
