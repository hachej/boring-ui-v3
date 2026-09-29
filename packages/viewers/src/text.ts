/** Text helpers the markdown viewer's tools share: exact edits, a line diff for proposals, headings. No I/O. */

/** One exact replacement: `find` must occur exactly once in the text it applies to. */
export type Edit = Readonly<{ find: string; replace: string }>;

export type EditsResult = { ok: true; text: string } | { ok: false; reason: string; edit: number };

/** Applies edits in order; an edit whose `find` is absent or ambiguous refuses the whole patch (nothing half-applied). */
export function applyEdits(text: string, edits: readonly Edit[]): EditsResult {
  let out = text;
  for (const [i, edit] of edits.entries()) {
    if (!edit.find) return { ok: false, reason: "an edit needs a non-empty find", edit: i };
    const first = out.indexOf(edit.find);
    if (first < 0) return { ok: false, reason: `edit ${i}: the text to replace is not in the document`, edit: i };
    if (out.indexOf(edit.find, first + 1) >= 0) return { ok: false, reason: `edit ${i}: the text to replace occurs more than once; include more context`, edit: i };
    out = out.slice(0, first) + edit.replace + out.slice(first + edit.find.length);
  }
  return { ok: true, text: out };
}

export type DiffLine = Readonly<{ kind: "same" | "add" | "remove"; text: string }>;

/** A line diff (LCS) between two texts, for showing a proposal the person accepts or rejects. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n"), b = after.split("\n");
  // Trim the common prefix and suffix first: proposals usually touch a few lines of a long document.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const midA = a.slice(start, endA), midB = b.slice(start, endB);
  const table = Array.from({ length: midA.length + 1 }, () => Array.from({ length: midB.length + 1 }, () => 0));
  for (let i = midA.length - 1; i >= 0; i--) for (let j = midB.length - 1; j >= 0; j--) table[i]![j] = midA[i] === midB[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const out: DiffLine[] = a.slice(0, start).map(text => ({ kind: "same" as const, text }));
  let i = 0, j = 0;
  while (i < midA.length || j < midB.length) {
    if (i < midA.length && j < midB.length && midA[i] === midB[j]) { out.push({ kind: "same", text: midA[i]! }); i++; j++; }
    else if (j < midB.length && (i >= midA.length || table[i]![j + 1]! >= table[i + 1]![j]!)) { out.push({ kind: "add", text: midB[j]! }); j++; }
    else { out.push({ kind: "remove", text: midA[i]! }); i++; }
  }
  for (const text of a.slice(endA)) out.push({ kind: "same", text });
  return out;
}

export type Heading = Readonly<{ id: string; level: number; text: string; line: number; index: number }>;

const slug = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-") || "section";

/** ATX headings outside fenced code, with stable slugs (`intro`, `intro-1` for a repeat). */
export function headingsOf(markdown: string): Heading[] {
  const out: Heading[] = [];
  const seen = new Map<string, number>();
  let fence: string | null = null;
  for (const [line, raw] of markdown.split("\n").entries()) {
    const f = /^\s{0,3}(```|~~~)/.exec(raw);
    if (f) { fence = fence === null ? f[1]! : fence === f[1] ? null : fence; continue; }
    if (fence) continue;
    const m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(raw);
    if (!m) continue;
    const text = m[2]!.trim();
    const base = slug(text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.push({ id: n ? `${base}-${n}` : base, level: m[1]!.length, text, line, index: out.length });
  }
  return out;
}
