// The existing application's page: a records list and one open record, plus the chat in a side column.
// The page registers two commands the agent may request; the application's backend keeps the only
// effect path (UI-BOUNDARY-3): `open_record` and `highlight` are local, the status change is a fetch.
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { BoringChat, createChatClient, useAgentUi, type PageCommand } from "@boring/chat";

type Record = { id: string; title: string; status: string; version: number };

function App() {
  const client = useMemo(() => createChatClient({ endpoint: "/agent" }), []);
  const [records, setRecords] = useState<Record[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [thread, setThread] = useState<string | undefined>();
  const [log, setLog] = useState<string[]>([]);
  useEffect(() => { fetch("/api/records").then(r => r.json()).then(setRecords); }, []);
  const current = records.find(r => r.id === selected);

  const commands: PageCommand[] = [
    { name: "open_record", description: "Open a record on the page by id.", input: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      handler: async input => { const { id } = input as { id: string }; if (!records.some(r => r.id === id)) return { outcome: "denied", detail: "no such record" }; setSelected(id); return { outcome: "applied", detail: { opened: id } }; } },
    { name: "highlight", description: "Highlight a field of the open record: title or status.", input: { type: "object", properties: { field: { type: "string", enum: ["title", "status"] } }, required: ["field"] },
      handler: async input => { setHighlight((input as { field: string }).field); return { outcome: "applied" }; } },
  ];
  // The target the page shows: a request made while r1 was open is stale once r2 is (UI-BOUNDARY-4).
  const { page } = useAgentUi({ client, thread, commands, target: current ? { kind: "record", id: current.id, version: String(current.version) } : undefined, onAnswer: (request, result) => setLog(l => [...l, `${request.command} → ${result.outcome}`]) });

  const advance = async () => {
    if (!current) return;
    const next = current.status === "draft" ? "review" : "done";
    const result = await (await fetch(`/api/records/${current.id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: next, version: current.version }) })).json();
    if (result.outcome === "committed") setRecords(rs => rs.map(r => r.id === current.id ? { ...r, status: next, version: result.evidence.version } : r));
    setLog(l => [...l, `status → ${result.outcome}`]);
  };

  return (
    <>
      <section>
        <h1>Records</h1>
        <ul id="records">{records.map(r => <li key={r.id} data-record={r.id} data-selected={r.id === selected ? "" : undefined} onClick={() => setSelected(r.id)}>{r.id} · {r.title} · {r.status}</li>)}</ul>
        {current && <article id="open"><h2 data-highlight={highlight === "title" ? "" : undefined}>{current.title}</h2><p data-highlight={highlight === "status" ? "" : undefined}>status: <b id="status">{current.status}</b> (v{current.version})</p><button id="advance" onClick={advance} disabled={current.status === "done"}>Move forward</button></article>}
        <p id="page" data-page={page} style={{ color: "#8b7d6b", fontSize: 12 }}>page instance {page}</p>
        <ol id="log">{log.map((line, i) => <li key={i}>{line}</li>)}</ol>
      </section>
      <aside><BoringChat endpoint="/agent" conversation="chat" client={client} onThread={setThread} placeholder="Ask the operator" /></aside>
    </>
  );
}

createRoot(document.getElementById("app")!).render(<App />);
