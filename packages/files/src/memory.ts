/**
 * The default virtual filesystem: files in memory, seeded from an object or a directory snapshot.
 * Revisions are one monotonic counter per provider, so a removed revision is never current again
 * (FILES-4), and every revision ever issued stays readable for exact resolution (SPEC §2.2).
 */
import { FileProviderError, type Effect, type Entry, type FileAddress, type FileProvider, type FileRef, type ReadOptions, type Receipt, type WriteCondition } from "./index.ts";
import type { ReceiptLog } from "./receipts.ts";

export type MemoryProviderOptions = Readonly<{
  /** path → content. Paths are canonical relative paths. */
  seed?: Readonly<Record<string, string>>;
  receipts?: ReceiptLog;
  /** Distinguishes identities across instances; random by default. */
  name?: string;
}>;

let instances = 0;

export function memoryProvider(options: MemoryProviderOptions = {}): FileProvider {
  const name = options.name ?? `m${++instances}-${Math.random().toString(36).slice(2, 8)}`;
  const files = new Map<string, { revision: string; content: string }>();
  const history = new Map<string, string>(); // revision → content
  let seq = 0;
  const next = () => String(++seq);
  const id = (path: string) => `memory:${name}:${path}`;
  for (const [path, content] of Object.entries(options.seed ?? {})) { const revision = next(); files.set(path, { revision, content }); history.set(revision, content); }
  const receipt = (address: FileAddress, before: string | null, after: string | null, effect: Effect): Receipt => {
    const row: Receipt = { address, id: id(address.path), before, after, effect, at: new Date().toISOString() };
    options.receipts?.record(row);
    return row;
  };

  return {
    async stat(address) {
      const file = files.get(address.path);
      return file ? { id: id(address.path), revision: file.revision } : null;
    },
    async read(address, readOptions: ReadOptions = {}) {
      const file = files.get(address.path);
      if (readOptions.revision !== undefined) {
        const content = history.get(readOptions.revision);
        if (content === undefined) throw new FileProviderError({ code: "unavailable", requested: readOptions.revision, current: file?.revision ?? null }, `revision ${readOptions.revision} of ${address.path} is unavailable`);
        return { ref: { id: id(address.path), revision: readOptions.revision }, content };
      }
      if (!file) throw new FileProviderError({ code: "missing" }, address.path);
      return { ref: { id: id(address.path), revision: file.revision }, content: file.content };
    },
    async list(address) {
      const prefix = address.path ? `${address.path}/` : "";
      if (address.path && !files.has(address.path) && ![...files.keys()].some(p => p.startsWith(prefix))) throw new FileProviderError({ code: "missing" }, address.path);
      const seen = new Map<string, Entry>();
      for (const [path, file] of files) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash < 0) seen.set(rest, { path, kind: "file", ref: { id: id(path), revision: file.revision } });
        else { const dir = `${prefix}${rest.slice(0, slash)}`; if (!seen.has(rest.slice(0, slash))) seen.set(rest.slice(0, slash), { path: dir, kind: "dir" }); }
      }
      return [...seen.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    },
    async write(address, content, condition: WriteCondition, effect) {
      if (!address.path) throw new FileProviderError({ code: "bad-address" }, "the mount root is not a file");
      const current = files.get(address.path);
      if ("create" in condition) { if (current) throw new FileProviderError({ code: "exists" }, address.path); }
      else {
        if (!current) throw new FileProviderError({ code: "missing" }, address.path);
        if (current.revision !== condition.expectedRevision) throw new FileProviderError({ code: "conflict", current: current.revision }, `${address.path} is at ${current.revision}, not ${condition.expectedRevision}`);
      }
      const revision = next();
      files.set(address.path, { revision, content });
      history.set(revision, content);
      return receipt(address, current?.revision ?? null, revision, effect);
    },
    async remove(address, expectedRevision, effect) {
      const current = files.get(address.path);
      if (!current) throw new FileProviderError({ code: "missing" }, address.path);
      if (current.revision !== expectedRevision) throw new FileProviderError({ code: "conflict", current: current.revision }, `${address.path} is at ${current.revision}, not ${expectedRevision}`);
      files.delete(address.path);
      next(); // the removal takes a revision of its own, so a recreate lands later than anything before it
      return receipt(address, current.revision, null, effect);
    },
  };
}

/** The `id` a memory provider issues, exported for tests that check identities differ across providers. */
export const memoryIdOf = (name: string, path: string) => `memory:${name}:${path}`;
