/**
 * One canonical spelling for every address (FILES-5). Policy and storage compare exactly the string
 * `canonicalPath` returns; anything it refuses never reaches a provider.
 *
 * A path is a `/`-joined list of segments. A segment holds letters, digits, `.`, `_`, `-` and spaces;
 * `.` and `..` are not segments; `\`, `%`, `:` and control characters are refused rather than
 * interpreted, so no encoding or alias can name a file the canonical form cannot.
 */
import { FileProviderError } from "./errors.ts";
import type { FileAddress } from "./index.ts";

const SEGMENT = /^[\p{L}\p{N}._\- ]+$/u;

export const MOUNTS = { code: "code", workspace: "workspace", shared: "shared" } as const;
const MOUNT = /^(?:[a-z][a-z0-9-]*|mnt\/[a-z][a-z0-9-]*)$/;

export const isMountName = (name: string): boolean => MOUNT.test(name);
/** The mount name of an attached filesystem: `/mnt/<name>`. */
export const attachedMount = (name: string): string => {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new FileProviderError({ code: "bad-address" }, `mount name "${name}" must match [a-z][a-z0-9-]*`);
  return `mnt/${name}`;
};

/** The canonical relative path, or a bad-address refusal. "" is the mount root. */
export function canonicalPath(input: string): string {
  if (typeof input !== "string") throw new FileProviderError({ code: "bad-address" }, "path must be a string");
  const text = input.normalize("NFC");
  for (const ch of text) { const code = ch.codePointAt(0)!; if (code < 0x20 || code === 0x7f || ch === "\\" || ch === "%" || ch === ":") throw new FileProviderError({ code: "bad-address" }, `path "${input}" contains a refused character`); }
  const segments = text.split("/").filter(segment => segment !== "");
  for (const segment of segments) {
    if (segment === "." || segment === "..") throw new FileProviderError({ code: "bad-address" }, `path "${input}" traverses`);
    if (!SEGMENT.test(segment) || segment.trim() !== segment) throw new FileProviderError({ code: "bad-address" }, `path "${input}" has an invalid segment "${segment}"`);
  }
  return segments.join("/");
}

/**
 * `/workspace/notes/a.md` → { mount: "workspace", path: "notes/a.md" }; `/mnt/repo/src` → { mount: "mnt/repo", path: "src" }.
 * The mount is the longest known mount that prefixes the text; an unknown mount is a bad address.
 */
export function parseAddress(text: string, mounts: readonly string[]): FileAddress {
  if (typeof text !== "string" || !text.startsWith("/")) throw new FileProviderError({ code: "bad-address" }, `address "${String(text)}" must start with /<mount>/`);
  const segments = text.split("/").filter(Boolean);
  const candidates = [...mounts].filter(isMountName).sort((a, b) => b.length - a.length);
  for (const mount of candidates) {
    const parts = mount.split("/");
    if (parts.every((part, i) => segments[i] === part)) return { mount, path: canonicalPath(segments.slice(parts.length).join("/")) };
  }
  throw new FileProviderError({ code: "bad-address" }, `address "${text}" names no mount available here (${mounts.join(", ") || "none"})`);
}

export const formatAddress = (address: FileAddress): string => `/${address.mount}${address.path ? `/${address.path}` : ""}`;
