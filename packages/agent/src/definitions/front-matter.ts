/**
 * Front matter of a definition file: a `---` block at the top of a Markdown file, then the body.
 * The subset understood is deliberately small so that an error is always explainable:
 * scalars (quoted or bare, numbers, booleans), inline lists `[a, b]`, inline maps
 * `{ type: string, required: true }`, and nested blocks by indentation (used by `inputs:`,
 * `outputs:`). A field's expected shape is checked by `field` and `inputSchema`.
 */
export type Scalar = string | number | boolean;
export type FrontMatterValue = Scalar | readonly Scalar[] | { readonly [key: string]: FrontMatterValue };
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

/** Splits on commas outside quotes, brackets and braces. */
function splitItems(inner: string): string[] {
  const items: string[] = [];
  let depth = 0, quote: string | null = null, current = "";
  for (const ch of inner) {
    if (quote) { current += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === "[" || ch === "{") depth++;
    if (ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) { items.push(current); current = ""; continue; }
    current += ch;
  }
  if (current.trim()) items.push(current);
  return items;
}

function inlineValue(raw: string, file: string, key: string, line: number): FrontMatterValue {
  const value = raw.trim();
  if (value.startsWith("[")) {
    if (!value.endsWith("]")) throw new DefinitionError(file, `line ${line}: "${key}": an inline list must close with ]`);
    return splitItems(value.slice(1, -1)).map(item => {
      const s = scalar(item);
      if (s === "") throw new DefinitionError(file, `line ${line}: "${key}" has an empty list item`);
      return s;
    });
  }
  if (value.startsWith("{")) {
    if (!value.endsWith("}")) throw new DefinitionError(file, `line ${line}: "${key}": an inline map must close with }`);
    const map: Record<string, FrontMatterValue> = {};
    for (const item of splitItems(value.slice(1, -1))) {
      const pair = /^\s*([A-Za-z_][\w-]*):\s*([\s\S]*)$/.exec(item);
      if (!pair) throw new DefinitionError(file, `line ${line}: "${key}": expected "name: value" inside { }, got "${item.trim()}"`);
      map[pair[1]] = inlineValue(pair[2], file, `${key}.${pair[1]}`, line);
    }
    return map;
  }
  return scalar(value);
}

type Line = { indent: number; key: string; rest: string; number: number };

function parseBlock(lines: Line[], start: number, indent: number, file: string): { value: Record<string, FrontMatterValue>; next: number } {
  const value: Record<string, FrontMatterValue> = {};
  let i = start;
  while (i < lines.length && lines[i].indent >= indent) {
    const line = lines[i];
    if (line.indent !== indent) throw new DefinitionError(file, `line ${line.number}: unexpected indentation ("${line.key}")`);
    if (Object.hasOwn(value, line.key)) throw new DefinitionError(file, `line ${line.number}: "${line.key}" is defined twice`);
    if (line.rest === "") {
      const next = lines[i + 1];
      if (next && next.indent > indent) { const block = parseBlock(lines, i + 1, next.indent, file); value[line.key] = block.value; i = block.next; }
      else { value[line.key] = ""; i++; }
    } else { value[line.key] = inlineValue(line.rest, file, line.key, line.number); i++; }
  }
  return { value, next: i };
}

export function parseFrontMatter(source: string, file: string): { meta: FrontMatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) throw new DefinitionError(file, "front matter block (--- ... ---) is missing");
  const lines: Line[] = [];
  match[1].split(/\r?\n/).forEach((text, index) => {
    if (!text.trim() || text.trim().startsWith("#")) return;
    const kv = /^(\s*)([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(text);
    if (!kv) throw new DefinitionError(file, `line ${index + 1}: expected "key: value", got "${text.trim()}"`);
    lines.push({ indent: kv[1].length, key: kv[2], rest: (kv[3] ?? "").trim(), number: index + 1 });
  });
  if (lines.length && lines[0].indent !== 0) throw new DefinitionError(file, `line ${lines[0].number}: unexpected indentation ("${lines[0].key}")`);
  const { value, next } = parseBlock(lines, 0, 0, file);
  if (next < lines.length) throw new DefinitionError(file, `line ${lines[next].number}: unexpected indentation ("${lines[next].key}")`);
  return { meta: value, body: source.slice(match[0].length).trim() };
}

const isMap = (value: unknown): value is Record<string, FrontMatterValue> => typeof value === "object" && value !== null && !Array.isArray(value);

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
  if (!isMap(value)) throw bad();
  const map: Record<string, string> = {};
  for (const [name, description] of Object.entries(value)) { if (isMap(description) || Array.isArray(description)) throw bad(); map[name] = String(description); }
  return map;
}

/** One input of an agent, job or conversation, as JSON schema: what a client renders as a field. */
export type InputProperty = Readonly<{ type: "string" | "number" | "integer" | "boolean" | "array" | "object"; description?: string; enum?: readonly Scalar[]; items?: Readonly<{ type: "string" | "number" | "integer" | "boolean" | "object" }>; default?: Scalar }>;
export type InputSchema = Readonly<{ type: "object"; properties: Readonly<Record<string, InputProperty>>; required: readonly string[] }>;
const TYPES = ["string", "number", "integer", "boolean", "array", "object"] as const;
export const EMPTY_INPUTS: InputSchema = { type: "object", properties: {}, required: [] };

/**
 * `inputs:` as a JSON-schema object. A plain description is a required-less string;
 * a map `{ type, description, required, enum, items, default }` declares the rest.
 */
export function inputSchema(meta: FrontMatter, file: string, key = "inputs"): InputSchema {
  const value = meta[key];
  if (value === undefined || value === "") return EMPTY_INPUTS;
  if (!isMap(value)) throw new DefinitionError(file, `"${key}" must be a block of indented name: description (or name: { type, description, required }) lines`);
  const properties: Record<string, InputProperty> = {};
  const required: string[] = [];
  for (const [name, spec] of Object.entries(value)) {
    const at = `"${key}.${name}"`;
    if (!isMap(spec)) { if (Array.isArray(spec)) throw new DefinitionError(file, `${at} must be a description or a { type, description } map`); properties[name] = { type: "string", ...(String(spec) ? { description: String(spec) } : {}) }; continue; }
    for (const known of Object.keys(spec)) if (!["type", "description", "required", "enum", "items", "default"].includes(known)) throw new DefinitionError(file, `${at}: unknown field "${known}"`);
    const type = spec.type ?? "string";
    if (!(TYPES as readonly unknown[]).includes(type)) throw new DefinitionError(file, `${at}.type must be one of ${TYPES.join(", ")} (got "${String(type)}")`);
    const property: { -readonly [K in keyof InputProperty]: InputProperty[K] } = { type: type as InputProperty["type"] };
    if (spec.description !== undefined) { if (isMap(spec.description) || Array.isArray(spec.description)) throw new DefinitionError(file, `${at}.description must be text`); property.description = String(spec.description); }
    if (spec.enum !== undefined) { if (!Array.isArray(spec.enum) || !spec.enum.length) throw new DefinitionError(file, `${at}.enum must be a list like [a, b]`); property.enum = spec.enum; }
    if (spec.items !== undefined) {
      if (type !== "array") throw new DefinitionError(file, `${at}.items applies to type: array only`);
      const items = isMap(spec.items) ? spec.items.type : spec.items;
      if (!(TYPES as readonly unknown[]).includes(items) || items === "array") throw new DefinitionError(file, `${at}.items must be one of ${TYPES.filter(t => t !== "array").join(", ")}`);
      property.items = { type: items as NonNullable<InputProperty["items"]>["type"] };
    }
    if (spec.default !== undefined) { if (isMap(spec.default) || Array.isArray(spec.default)) throw new DefinitionError(file, `${at}.default must be a scalar`); property.default = spec.default as Scalar; }
    if (spec.required !== undefined) { if (typeof spec.required !== "boolean") throw new DefinitionError(file, `${at}.required must be true or false`); if (spec.required) required.push(name); }
    properties[name] = property;
  }
  return { type: "object", properties, required };
}
