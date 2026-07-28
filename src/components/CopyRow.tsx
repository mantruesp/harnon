import { useState } from "react";

export default function CopyRow({ label, value }: { label: string; value?: string }) {
  const [c, setC] = useState(false);
  if (!value) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
      padding: "9px 12px", border: "1px solid var(--line)", borderRadius: 10, background: "#fff" }}>
      <div style={{ minWidth: 0 }}>
        <div className="eyebrow" style={{ marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 13.5, wordBreak: "break-word" }}>{value}</div>
      </div>
      <button className="btn btn-ghost btn-sm" style={{ flex: "none" }} onClick={() => {
        navigator.clipboard?.writeText(String(value)); setC(true); setTimeout(() => setC(false), 1200);
      }}>{c ? "✓" : "Copy"}</button>
    </div>
  );
}
