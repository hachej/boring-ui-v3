/**
 * Front matter of a definition file: a `---` block of `key: value` lines at the top of a Markdown
 * file, then the body. The subset understood is deliberately small so that an error is always
 * explainable: scalars (quoted or bare, numbers), inline lists `[a, b]`, and one level of nested
 * `key:` blocks whose indented lines are `name: description` pairs (used by `inputs:` and `outputs:`).
 */
export type Scalar = string | number | boolean;
export type FrontMatterValue = Scalar | readonly Scalar[] | Readonly<Record<string, Scalar>>;
export type FrontMatter = Readonly<Record<string, FrontMatterValue>>;

export class DefinitionError extends Error {
  readonly file: string;
  constructor(file: string, detail: string) {
    super(`${file}: ${detail}`);
    this.file = file;
  }
}

function scalar(raw: string): Scalar {
  const value = raw.trim();
  if (/^".*"$/.test(value) || /^'.*'$/.test(value)) return value.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function inlineList(raw: string, file: string, key: string): readonly Scalar[] {
  const inner = raw.trim().slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(",").map(item => {
    const value = scalar(item);
    if (value === "") throw new DefinitionError(file, `"${key}" has an empty list item`);
    return value;
  });
}

export function parseFrontMatter(source: string, file: string): { meta: FrontMatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) throw new DefinitionError(file, "front matter block (--- ... ---) is missing");
  const meta: Record<string, FrontMatterValue> = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (/^\s/.test(line)) throw new DefinitionError(file, `line ${i + 1}: unexpected indentation ("${line.trim()}")`);
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) throw new DefinitionError(file, `line ${i + 1}: expected "key: value", got "${line}"`);
    const [, key, rest] = kv;
    if (Object.hasOwn(meta, key)) throw new DefinitionError(file, `"${key}" is defined twice`);
    if (rest.trim() === "") {
      const nested: Record<string, Scalar> = {};
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || !lines[i + 1].trim())) {
        i++;
        if (!lines[i].trim()) continue;
        const pair = /^\s+([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]);
        if (!pair) throw new DefinitionError(file, `line ${i + 1}: expected an indented "name: description" under "${key}"`);
        nested[pair[1]] = scalar(pair[2]);
      }
      meta[key] = nested;
    } else if (rest.trim().startsWith("[")) {
      if (!rest.trim().endsWith("]")) throw new DefinitionError(file, `"${key}": an inline list must close with ]`);
      meta[key] = inlineList(rest, file, key);
    } else meta[key] = scalar(rest);
  }
  return { meta, body: source.slice(match[0].length).trim() };
}

/** Reads one front-matter field with its expected shape, or throws a clear error. */
export function field(meta: FrontMatter, file: string, key: string, kind: "string", required: true): string;
export function field(meta: FrontMatter, file: string, key: string, kind: "string", required?: false): string | undefined;
export function field(meta: FrontMatter, file: string, key: string, kind: "number", required?: false): number | undefined;
export function field(meta: FrontMatter, file: string, key: string, kind: "list", required?: false): readonly string[] | undefined;
export function field(meta: FrontMatter, file: string, key: string, kind: "map", required?: false): Readonly<Record<string, string>> | undefined;
export function field(meta: FrontMatter, file: string, key: string, kind: "string" | "number" | "list" | "map", required = false): unknown {
  const value = meta[key];
  if (value === undefined || value === "") {
    if (required) throw new DefinitionError(file, `"${key}" is required in the front matter`);
    return undefined;
  }
  const bad = () => new DefinitionError(file, `"${key}" must be a ${kind === "list" ? "list like [a, b]" : kind === "map" ? "block of indented name: description lines" : kind}`);
  if (kind === "string") { if (typeof value !== "string") throw bad(); return value; }
  if (kind === "number") { if (typeof value !== "number") throw bad(); return value; }
  if (kind === "list") { if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw bad(); return value as readonly string[]; }
  if (typeof value !== "object" || Array.isArray(value)) throw bad();
  return Object.fromEntries(Object.entries(value as Record<string, Scalar>).map(([name, description]) => [name, String(description)]));
}
