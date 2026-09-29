/**
 * A real folder as a mount. The revision of a file is `<sha256 of content, 16 hex>-<mtime ms>`: the
 * hash says what the content is, the mtime keeps a recreate later than a removal (FILES-4). Writes go
 * through a temporary file and a rename under one in-process lock, and the receipt is recorded inside
 * that lock (FILES-7). A path whose parent resolves outside the root (a symlink) is refused (FILES-5).
 * Only the current revision is readable; another is `unavailable` (SPEC §2.2 exact resolution).
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { FileProviderError } from "./errors.ts";
import type { Effect, Entry, FileAddress, FileProvider, FileRef, ReadOptions, Receipt, WriteCondition } from "./contract.ts";
import type { ReceiptLog } from "./receipts.ts";

export type DirectoryProviderOptions = Readonly<{ root: string; receipts?: ReceiptLog }>;

const hash = (content: string | Buffer) => createHash("sha256").update(content).digest("hex").slice(0, 16);

/** A flat `path → content` snapshot of a folder (text files only), the seed of a memory provider. */
export function snapshotDirectory(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`);
      else if (entry.isFile()) out[`${prefix}${entry.name}`] = readFileSync(full, "utf8");
    }
  };
  walk(root, "");
  return out;
}

export function directoryProvider(options: DirectoryProviderOptions): FileProvider {
  mkdirSync(options.root, { recursive: true });
  const root = realpathSync(options.root);
  const id = (path: string) => `dir:${root}${sep}${path}`;
  let lock: Promise<void> = Promise.resolve();
  const locked = async <T>(work: () => T): Promise<T> => {
    const previous = lock;
    let release!: () => void;
    lock = new Promise<void>(r => { release = r; });
    await previous;
    try { return work(); } finally { release(); }
  };

  /** The absolute path of an address, refused when a symlink or an alias would carry it outside the root. */
  const absolute = (address: FileAddress, mustExist: boolean): string | null => {
    const target = resolve(root, address.path);
    if (target !== root && !target.startsWith(root + sep)) throw new FileProviderError({ code: "bad-address" }, `${address.path} leaves the mount`);
    let probe = target;
    while (!existsSync(probe)) { const parent = dirname(probe); if (parent === probe) break; probe = parent; }
    const real = realpathSync(probe);
    if (real !== root && !real.startsWith(root + sep)) throw new FileProviderError({ code: "bad-address" }, `${address.path} resolves outside the mount`);
    if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new FileProviderError({ code: "bad-address" }, `${address.path} is a symlink`);
    if (!existsSync(target)) { if (mustExist) return null; }
    return target;
  };
  const revisionOf = (file: string): string => `${hash(readFileSync(file))}-${Math.floor(statSync(file).mtimeMs)}`;
  const refOf = (address: FileAddress, file: string): FileRef => ({ id: id(address.path), revision: revisionOf(file) });
  const receipt = (address: FileAddress, before: string | null, after: string | null, effect: Effect): Receipt => {
    const row: Receipt = { address, id: id(address.path), before, after, effect, at: new Date().toISOString() };
    options.receipts?.record(row);
    return row;
  };

  return {
    async stat(address) {
      const file = absolute(address, true);
      return file && statSync(file).isFile() ? refOf(address, file) : null;
    },
    async read(address, readOptions: ReadOptions = {}) {
      const file = absolute(address, true);
      if (!file || !statSync(file).isFile()) {
        if (readOptions.revision !== undefined) throw new FileProviderError({ code: "unavailable", requested: readOptions.revision, current: null });
        throw new FileProviderError({ code: "missing" }, address.path);
      }
      const ref = refOf(address, file);
      if (readOptions.revision !== undefined && readOptions.revision !== ref.revision) throw new FileProviderError({ code: "unavailable", requested: readOptions.revision, current: ref.revision }, `${address.path} is at ${ref.revision}; a directory keeps no earlier revision`);
      return { ref, content: readFileSync(file, "utf8") };
    },
    async list(address) {
      const dir = absolute(address, true);
      if (!dir || !statSync(dir).isDirectory()) throw new FileProviderError({ code: "missing" }, address.path);
      const entries: Entry[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const path = address.path ? `${address.path}/${entry.name}` : entry.name;
        if (entry.isDirectory()) entries.push({ path, kind: "dir" });
        else if (entry.isFile()) entries.push({ path, kind: "file", ref: { id: id(path), revision: revisionOf(join(dir, entry.name)) } });
      }
      return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    },
    write(address, content, condition: WriteCondition, effect) {
      if (!address.path) throw new FileProviderError({ code: "bad-address" }, "the mount root is not a file");
      return locked(() => {
        const file = absolute(address, false)!;
        const exists = existsSync(file) && statSync(file).isFile();
        const before = exists ? revisionOf(file) : null;
        if ("create" in condition) { if (exists) throw new FileProviderError({ code: "exists" }, address.path); }
        else {
          if (!exists) throw new FileProviderError({ code: "missing" }, address.path);
          if (before !== condition.expectedRevision) throw new FileProviderError({ code: "conflict", current: before }, `${address.path} is at ${before}, not ${condition.expectedRevision}`);
        }
        mkdirSync(dirname(file), { recursive: true });
        const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
        writeFileSync(temp, content);
        renameSync(temp, file);
        // Two writes in one millisecond would share an mtime: move this one forward so the revision changes.
        const previousMtime = before ? Number(before.split("-").pop()) : 0;
        if (Math.floor(statSync(file).mtimeMs) <= previousMtime) { const t = new Date(previousMtime + 1); utimesSync(file, t, t); }
        return receipt(address, before, revisionOf(file), effect);
      });
    },
    remove(address, expectedRevision, effect) {
      return locked(() => {
        const file = absolute(address, true);
        if (!file || !statSync(file).isFile()) throw new FileProviderError({ code: "missing" }, address.path);
        const before = revisionOf(file);
        if (before !== expectedRevision) throw new FileProviderError({ code: "conflict", current: before }, `${address.path} is at ${before}, not ${expectedRevision}`);
        unlinkSync(file);
        return receipt(address, before, null, effect);
      });
    },
  };
}

/** For tests: the relative form of an absolute path under a root. */
export const relativeTo = (root: string, file: string) => relative(root, file).split(sep).join("/");
