import type { Filesystem } from "../../environments/filesystem.js";
import { conditionSchema, object, string, writeCondition } from "./input.js";

export function filesystemAgentTools(fs: Filesystem) {
  return Object.freeze({
    read_file: {
      description: "Read a text file and learn its current revision.",
      input: { type: "object", required: ["mount", "path"], properties: { mount: { type: "string" }, path: { type: "string" } } },
      async run(value: unknown) {
        const input = object(value);
        const path = string(input, "path");
        const result = await fs.read({ mount: string(input, "mount"), path });
        return { path, content: result.content, revision: result.ref.revision };
      }
    },
    write_file: {
      description: "Write a text file: create it, or replace the revision you observed.",
      input: { type: "object", required: ["mount", "path", "content"], properties: { mount: { type: "string" }, path: { type: "string" }, content: { type: "string" }, ...conditionSchema } },
      async run(value: unknown) {
        const input = object(value);
        const path = string(input, "path");
        const ref = await fs.write({ mount: string(input, "mount"), path, content: string(input, "content"), ...writeCondition(input) });
        return { ok: true, path, revision: ref.revision };
      }
    }
  });
}
