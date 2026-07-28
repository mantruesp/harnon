export default function Toggle({
  on, set, label, hint,
}: {
  on: boolean;
  set: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="toggle" onClick={() => set(!on)}>
      <span className={"track" + (on ? " on" : "")}><span className="knob" /></span>
      <span>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{label}</span>
        {hint && <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>{hint}</span>}
      </span>
    </label>
  );
}
