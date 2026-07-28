import { useState } from "react";
import type { ApplicationAutofill } from "../types";
import CopyRow from "./CopyRow";
import KitBlock from "./KitBlock";

type FieldKey = Exclude<keyof ApplicationAutofill, "screeningAnswers">;

const FIELDS: [string, FieldKey][] = [
  ["Full name", "fullName"], ["Email", "email"], ["Phone", "phone"], ["Location", "location"],
  ["LinkedIn", "linkedin"], ["Website / portfolio", "website"], ["Current title", "currentTitle"],
  ["Years of experience", "yearsExperience"], ["US work authorization", "workAuthorization"],
  ["Requires sponsorship?", "requiresSponsorship"], ["Desired salary", "desiredSalary"],
  ["Availability / notice", "availability"], ["Open to relocation?", "willRelocate"],
];

export default function AutofillSheet({ data }: { data: ApplicationAutofill }) {
  const [allCopied, setAllCopied] = useState(false);
  const present = FIELDS.filter(([, k]) => data[k]);
  const screening = data.screeningAnswers || [];

  function copyAll() {
    const lines = present.map(([lbl, k]) => lbl + ": " + data[k]);
    screening.forEach((s) => lines.push("\n" + s.q + "\n" + s.a));
    navigator.clipboard?.writeText(lines.join("\n"));
    setAllCopied(true); setTimeout(() => setAllCopied(false), 1400);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div className="eyebrow">Autofill sheet — tap to copy into the portal</div>
        <button className="btn btn-ghost btn-sm" onClick={copyAll}>{allCopied ? "Copied all ✓" : "Copy all"}</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
        {present.map(([lbl, k]) => <CopyRow key={k} label={lbl} value={data[k]} />)}
      </div>
      {screening.length > 0 && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="eyebrow">Screening question answers</div>
          {screening.map((s, i) => <KitBlock key={i} title={s.q} text={s.a} letter />)}
        </div>
      )}
    </div>
  );
}
