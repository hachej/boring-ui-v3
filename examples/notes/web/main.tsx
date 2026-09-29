import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BoringChat } from "@boring/chat";

const notes = ["Buy milk tomorrow.", "Call the dentist on Monday."];

/** The page keeps only the thread id, in the URL hash, so a reload rebuilds the same transcript from the wire. */
function App() {
  const [thread] = useState(() => new URLSearchParams(location.hash.slice(1)).get("thread") ?? undefined);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 12 }}>
      <h1 style={{ margin: 0, fontSize: 18 }}>Notes</h1>
      <ul>{notes.map(n => <li key={n}>{n}</li>)}</ul>
      <div style={{ flex: 1, minHeight: 0 }}>
        <BoringChat endpoint="/agent" conversation="questions" inputs={{ notes }} thread={thread}
          onEvent={event => { if (event.kind === "run" && event.run.thread !== thread) history.replaceState(null, "", `#thread=${event.run.thread}`); }} />
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
