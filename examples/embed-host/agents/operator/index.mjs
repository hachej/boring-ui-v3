import { OutputError } from "@boring/agent";

export const buildMessage = input => `# Request\n\n${String(input.text ?? "").trim()}`;
export function validate(markdown) {
  if (typeof markdown !== "string" || !markdown.trim()) throw new OutputError("empty answer");
  return markdown.trim();
}
export const asText = markdown => markdown;
