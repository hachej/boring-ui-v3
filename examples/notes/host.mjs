// A development Host for the notes app: one actor from a header the app's own server trusts
// (this is the application's auth; the library never reads the header itself), every tool
// allowed, no mounts, usage printed. A real application implements this over its session.
export function devHost({ log = () => {} } = {}) {
  return {
    async resolveActor(request) {
      const id = request.headers.get("x-dev-actor");
      return id ? { id, roles: ["member"] } : null;
    },
    async mayRequest() { return true; },
    async isActive() { return true; },
    async mounts() { return {}; },
    async allowedTools() { return ["lookup"]; },
    async mayAnswer() { return true; },
    async onUsage(usage) { log(usage); },
  };
}

/** The one helper tool the sample registers: a glossary lookup with no side effect. */
export const tools = [{
  name: "lookup",
  description: "Look up a term in the glossary.",
  input: { type: "object", properties: { term: { type: "string" } }, required: ["term"] },
  handler: async ({ term }) => ({ term, definition: `${term}: no entry in the sample glossary` }),
}];
