import { useState } from "react";

export default function KitBlock({
  title, text, letter,
}: {
  title: string;
  text?: string;
  letter?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div className="eyebrow">{title}</div>
        <button className="btn btn-ghost btn-sm" onClick={() => {
          navigator.clipboard?.writeText(text || "");
          setCopied(true); setTimeout(() => setCopied(false), 1500);
        }}>{copied ? "Copied ✓" : "Copy"}</button>
      </div>
      <div className={letter ? "letter" : ""} style={letter ? { background: "#F7FAF9", border: "1px solid var(--line)", borderRadius: 12, padding: 16 } : { fontSize: 14, lineHeight: 1.55 }}>
        {text}
      </div>
    </div>
  );
}
