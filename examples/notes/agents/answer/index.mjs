import { OutputError } from "@boring/agent";

/** input: { rules, text, notes } */
export function buildMessage(input) {
  const notes = Array.isArray(input.notes) ? input.notes : [];
  const section = notes.length ? notes.map((n, i) => `## Note ${i + 1}\n\n${String(n).trim()}`).join("\n\n") : "No notes.";
  return `# Notes\n\n${section}\n\n---\n\n# Question\n\n${String(input.text ?? "").trim()}`;
}

export function validate(markdown) {
  if (typeof markdown !== "string" || !markdown.trim()) throw new OutputError("empty answer");
  if (markdown.length > 4000) throw new OutputError("too long: answer in a few sentences");
  return markdown.trim();
}

export const asText = markdown => markdown;
