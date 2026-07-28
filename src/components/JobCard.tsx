import type { JobPosting } from "../types";
import MatchRing from "./MatchRing";
import VisaPill from "./VisaPill";

export default function JobCard({
  job, onPrepare, muted,
}: {
  job: JobPosting;
  onPrepare: (job: JobPosting) => void;
  muted?: boolean;
}) {
  return (
    <div className="job" style={muted ? { opacity: 0.82 } : undefined}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <MatchRing score={job.matchScore} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div>
              <h3 className="display" style={{ fontSize: 16 }}>{job.title}</h3>
              <div style={{ fontSize: 13.5, color: "var(--ink)", fontWeight: 600 }}>{job.company}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                {job.location}{job.remote ? " · Remote" : ""}{job.salary ? " · " + job.salary : ""}
                {job.source ? " · " + job.source : ""}
              </div>
              <div style={{ fontSize: 12, color: job.status === "open" ? "var(--good)" : "var(--warn)", fontWeight: 600, marginTop: 4 }}>
                {job.status === "open" ? "✓ Confirmed open" : job.status === "unconfirmed" ? "◐ Not confirmed open" : "◐ Unverified (no live search)"}
                {job.checkedNote ? " · " + job.checkedNote : ""}
              </div>
            </div>
            <div style={{ textAlign: "right", flex: "none" }}>
              <VisaPill status={job.visaSponsorship} />
              {job.visaNote && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>{job.visaNote}</div>}
            </div>
          </div>
          {job.matchReasons?.length > 0 && (
            <ul style={{ margin: "10px 0 0", paddingLeft: 16, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>
              {job.matchReasons.slice(0, 3).map((r, j) => <li key={j}>{r}</li>)}
            </ul>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button className="btn btn-primary btn-sm" onClick={() => onPrepare(job)}>
              Prepare application
            </button>
            {job.postingUrl && (
              <a className="btn btn-ghost btn-sm" href={job.postingUrl} target="_blank" rel="noopener noreferrer">
                View posting ↗
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
