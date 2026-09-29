import { createRoot } from "react-dom/client";
import { BoringChat } from "@boring/chat";

const notes = ["Buy milk tomorrow.", "Call the dentist on Monday."];
createRoot(document.getElementById("root")!).render(
  <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 12 }}>
    <h1 style={{ margin: 0, fontSize: 18 }}>Notes</h1>
    <ul>{notes.map(n => <li key={n}>{n}</li>)}</ul>
    <div style={{ flex: 1, minHeight: 0 }}>
      <BoringChat endpoint="/agent" conversation="questions" inputs={{ notes }} />
    </div>
  </div>,
);
