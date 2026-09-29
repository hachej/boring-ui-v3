// The scripted assistant: deterministic, keyword-driven, and it uses each viewer's tools the way a model would —
// through the page commands the mounted viewers registered, and the file tools for writes the page does not own.
//
//   "list"                      tree_list /workspace/notes
//   "open <address>"            tree_select <address>                 (the tree opens it for the person)
//   "go to <heading>"           markdown_go_to_heading
//   "risk" | "propose"          markdown_read_document → markdown_propose_patch (a diff the person accepts)
//   "apply"                     markdown_read_document → markdown_apply_patch at the revision read
//   "note"                      write_file /workspace/notes/agent-note.md (the tree shows it after its refresh)
//   "zoom" | "image"            image_describe → image_zoom → image_annotate
//   "code"                      read_file /code/README.md
//   "draw" | "sticky"           canvas_get_shapes → canvas_create_shapes (a box and a sticky note, saved with a receipt)
//   "move"                      canvas_get_shapes → canvas_update_shapes on the first shape, bound to the version read
// A tool result reaches the model as text, JSON possibly encoded twice (the tool's value, then the transcript).
const parse = text => { let value = text; for (let i = 0; i < 2 && typeof value === "string"; i++) { try { value = JSON.parse(value); } catch { break; } } return value; };

export const scriptedModel = {
  kind: "fake",
  script: request => {
    const last = request.messages.map(m => m.role).lastIndexOf("user");
    const asked = (request.messages[last]?.content ?? "").split("# Request").pop().trim();
    const results = request.messages.slice(last + 1).filter(m => m.role === "tool").map(m => parse(m.content));
    const has = name => request.tools.some(t => t.name === name);
    const say = text => ({ text });
    const calls = (...list) => ({ toolCalls: list.map(([name, args]) => ({ name, arguments: args })) });
    const lower = asked.toLowerCase();
    const outcome = r => (r && typeof r === "object" && "outcome" in r ? r.outcome : typeof r === "string" ? r : JSON.stringify(r));

    if (/\bopen\b/.test(lower)) {
      const address = /\/(workspace|code)\/[\w./ -]+/.exec(asked)?.[0]?.trim() ?? "/workspace/notes/plan.md";
      if (!has("tree_select")) return say("There is no file tree on the page to open it with.");
      if (!results.length) return calls(["tree_select", { path: address }]);
      return say(`Opened ${address}: ${outcome(results[0])}.`);
    }
    if (/go to/.test(lower)) {
      const heading = asked.replace(/.*go to/i, "").trim() || "Risks";
      if (!results.length) return calls(["markdown_go_to_heading", { heading }]);
      return say(`Scrolled to ${heading}: ${outcome(results[0])}.`);
    }
    if (/risk|propose|apply/.test(lower)) {
      if (!has("markdown_read_document")) return say("Open a markdown document first; I edit it through the editor's tools.");
      if (!results.length) return calls(["markdown_read_document", {}]);
      if (results.length === 1) {
        const doc = results[0]?.detail ?? {};
        const content = typeof doc.content === "string" ? doc.content : "";
        const risks = "- A stale save overwriting newer work: the editor saves at the revision it read.\n- A tool that grants more than the page: every tool is admitted by the host.";
        const edits = content.includes("None yet.") ? [{ find: "None yet.", replace: risks }]
          : content.includes("## Risks") ? [{ find: "## Risks", replace: "## Risks\n\n- A viewer that keeps truth of its own: it lists and reads again on refresh." }]
          : [{ find: content.split("\n").find(l => l.trim()) ?? "", replace: `${content.split("\n").find(l => l.trim()) ?? ""}\n\n## Risks\n\n${risks}` }];
        return /apply/.test(lower) && has("markdown_apply_patch")
          ? calls(["markdown_apply_patch", { edits, revision: doc.revision }])
          : calls(["markdown_propose_patch", { edits, summary: "Name two risks" }]);
      }
      return say(`${outcome(results[1]) === "proposed" ? "I proposed two risks; accept or reject the change in the editor." : `The patch was ${outcome(results[1])}.`}`);
    }
    if (/\bnote\b/.test(lower)) {
      if (!results.length) return calls(["write_file", { path: "/workspace/notes/agent-note.md", content: "# Agent note\n\nWritten by the assistant through the file tools.\n", mode: "create" }]);
      return say(results[0]?.error ? `I could not write the note: ${results[0].error}` : `I wrote /workspace/notes/agent-note.md at revision ${results[0]?.revision}.`);
    }
    if (/zoom|image/.test(lower)) {
      if (!has("image_describe")) return say("Open an image first.");
      if (!results.length) return calls(["image_describe", {}]);
      if (results.length === 1) return calls(["image_zoom", { level: 2 }]);
      if (results.length === 2) { const d = results[0]?.detail ?? {}; return calls(["image_annotate", { x: Math.round((d.width ?? 100) / 4), y: Math.round((d.height ?? 100) / 4), width: Math.round((d.width ?? 100) / 2), height: Math.round((d.height ?? 100) / 2), label: "look here" }]); }
      const d = results[0]?.detail ?? {};
      return say(`The image is ${d.width}×${d.height} (${d.mime}); I zoomed to 200% and highlighted its centre.`);
    }
    if (/draw|sticky|move/.test(lower)) {
      if (!has("canvas_get_shapes")) return say("Open a canvas first.");
      if (!results.length) return calls(["canvas_get_shapes", {}]);
      const board = results[0]?.detail ?? {};
      if (results.length === 1) {
        if (/move/.test(lower)) {
          const first = board.shapes?.[0];
          if (!first) return say("The canvas is empty; nothing to move.");
          return calls(["canvas_update_shapes", { updates: [{ id: first.id, x: first.x + 120, color: "green" }], version: board.version }]);
        }
        return calls(["canvas_create_shapes", { version: board.version, shapes: [
          { type: "geo", geo: "rectangle", x: 80, y: 80, w: 220, h: 100, text: "Viewers", color: "green" },
          { type: "note", x: 360, y: 80, text: "Risk: a stale save", color: "yellow" },
        ] }]);
      }
      const r = results[1];
      return say(`The canvas change was ${outcome(r)}${r?.evidence?.receipt ? ` (revision ${r.evidence.receipt.after})` : ""}.`);
    }
    if (/\bcode\b/.test(lower)) {
      if (!results.length) return calls(["read_file", { path: "/code/README.md" }]);
      return say(`The application's README says: ${String(results[0]?.content ?? "").split("\n").find(l => l && !l.startsWith("#"))}`);
    }
    if (/\blist\b/.test(lower) && has("tree_list")) {
      if (!results.length) return calls(["tree_list", { path: "/workspace/notes" }]);
      return say(`Your notes: ${(results[0]?.detail?.entries ?? []).map(e => e.path.split("/").pop()).join(", ")}.`);
    }
    return say("Try: open /workspace/notes/plan.md, name a risk, apply a risk, write a note, zoom the image, read the code.");
  },
};
