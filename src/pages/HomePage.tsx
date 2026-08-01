import { Fragment, useEffect, useState } from "react";
import { useModels } from "../hooks/useModels";
import { useLocalHelper } from "../hooks/useLocalHelper";
import { useResume } from "../hooks/useResume";
import { useJobSearch } from "../hooks/useJobSearch";
import { useApplicationKit } from "../hooks/useApplicationKit";
import MatchRing from "../components/MatchRing";
import Toggle from "../components/Toggle";
import JobCard from "../components/JobCard";
import KitBlock from "../components/KitBlock";
import AutofillSheet from "../components/AutofillSheet";

const STEPS: [string, number][] = [["Resume", 1], ["Matches", 2], ["Apply", 3]];

export default function HomePage({ autoLoadId }: { autoLoadId?: string }) {
  const [error, setError] = useState("");

  const models = useModels();
  const localReady = useLocalHelper();
  const resume = useResume(models.selectedModel, setError);
  const jobSearch = useJobSearch(resume.analysis, models.selectedModel, !!models.hasWebSearch, setError);
  const kit = useApplicationKit(resume.resumeContent, resume.resumeText, models.selectedModel, setError);

  // Deep link support: /r/:id auto-loads a saved resume on this browser,
  // the same way typing the ID into the "Used Harnon before?" box would.
  useEffect(() => {
    if (!autoLoadId) return;
    (async () => {
      const ok = await resume.loadById(autoLoadId);
      if (ok) {
        jobSearch.resetForNewResume();
        kit.closeKit();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoadId]);

  async function handleLoadById() {
    const ok = await resume.loadById();
    if (ok) {
      jobSearch.resetForNewResume();
      kit.closeKit();
    }
  }

  // Derived, not independent state: stage 3 once any job is confirmed,
  // stage 2 once a resume has been analyzed/loaded, else stage 1.
  const stage = jobSearch.jobs && jobSearch.jobs.length > 0 ? 3 : resume.analysis ? 2 : 1;

  return (
    <div className="harnon">
      <div className="wrap">
        {/* header */}
        <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
          <svg width="30" height="30" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="9" r="3" stroke="#0E7C7B" strokeWidth="2.2" />
            <path d="M16 12v14M9 20a7 7 0 0 0 14 0M8 17h3M21 17h3" stroke="#0E7C7B" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <div style={{ flex: 1 }}>
            <h1 className="display" style={{ fontSize: 22, lineHeight: 1 }}>Harnon</h1>
            <div className="eyebrow" style={{ marginTop: 3 }}>Résumé in · matches out · applications ready</div>
          </div>
          {models.availableModels.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="eyebrow" style={{ margin: 0 }}>Model</span>
              <select value={models.selectedModel} onChange={(e) => models.setSelectedModel(e.target.value)}
                style={{ font: "inherit", fontSize: 13, fontWeight: 600, color: "var(--ink)",
                  background: "#fff", border: "1px solid var(--line)", borderRadius: 9,
                  padding: "7px 10px", outline: "none", cursor: "pointer", maxWidth: 220 }}>
                {models.availableModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}{m.free ? " (free)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
        </header>

        {models.currentModel?.id && !models.currentModel.webSearch && (
          <div style={{ background: "var(--signal-050)", border: "1px solid #ECD8A7", borderRadius: 10,
            padding: "8px 14px", fontSize: 12.5, color: "var(--warn)", marginBottom: 6 }}>
            <strong>{models.currentModel.label}</strong> is free but doesn't support live web search — job listings
            come from the model's training data and can't be verified as still open. Switch to a Claude model
            for live search and verification.
          </div>
        )}

        {/* stepper */}
        <div className="steps">
          {STEPS.map(([lbl, n], i) => (
            <Fragment key={n}>
              {i > 0 && <span className="bar" style={{ width: 26, height: 1.5, background: "var(--line)" }} />}
              <span className={"step" + (stage >= n ? " on" : "")}>
                <span className="dot">{n}</span>{lbl}
              </span>
            </Fragment>
          ))}
        </div>

        {error && <div className="err" style={{ marginBottom: 18 }}>{error}</div>}

        {/* Returning user — load by ID */}
        <div className="card" style={{ padding: "14px 18px", marginBottom: 18, display: "flex",
          gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span className="eyebrow" style={{ flex: "none" }}>Used Harnon on this device before?</span>
          <input type="text" value={resume.idInput} onChange={(e) => resume.setIdInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleLoadById(); }}
            placeholder="Enter your Harnon ID (e.g. HRN-K7M2P)"
            style={{ flex: "1 1 200px", maxWidth: 320, textTransform: "uppercase" }} />
          <button className="btn btn-ghost btn-sm" disabled={resume.loadingId || !resume.idInput.trim()} onClick={handleLoadById}>
            {resume.loadingId ? <><span className="spin spin-ink" /> Loading…</> : "Load my resume"}
          </button>
          <span style={{ fontSize: 11.5, color: "var(--muted)", flexBasis: "100%" }}>
            Saved resumes live only in this browser's storage — an ID won't work on a different device or browser.
          </span>
        </div>

        {/* STEP 1 — resume */}
        <section className="card" style={{ padding: 22, marginBottom: 18 }}>
          <div className="eyebrow">Step 1 — Your resume</div>
          <h2 className="display" style={{ fontSize: 18, margin: "6px 0 4px" }}>Add your resume</h2>
          <p style={{ color: "var(--muted)", fontSize: 13.5, margin: "0 0 16px" }}>
            Upload a PDF or paste the text. Harnon reads it to understand your background and find real matches.
          </p>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => resume.fileRef.current?.click()}>
              ⬆ Upload PDF or .txt
            </button>
            <input ref={resume.fileRef} type="file" accept=".pdf,.txt,.md" onChange={resume.onFile} style={{ display: "none" }} />
            {resume.resumePdf && <span className="chip">📄 {resume.resumePdf.name}</span>}
          </div>

          {!resume.resumePdf && (
            <textarea rows={7} placeholder="…or paste your resume text here"
              value={resume.resumeText} onChange={(e) => resume.setResumeText(e.target.value)} />
          )}

          <div style={{ marginTop: 16 }}>
            <button className="btn btn-primary" disabled={!resume.hasResume || resume.analyzing} onClick={resume.analyzeResume}>
              {resume.analyzing ? <><span className="spin" /> Reading your resume…</> : "Review my resume →"}
            </button>
          </div>
        </section>

        {/* STEP 2 — review + search controls */}
        {resume.analysis && (
          <section className="card" style={{ padding: 22, marginBottom: 18 }}>
            {resume.savedId && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                background: "var(--primary-050)", border: "1px solid #CFE7E5", borderRadius: 10,
                padding: "8px 12px", marginBottom: 16 }}>
                <span style={{ fontSize: 13 }}>Saved as</span>
                <span className="mono" style={{ fontWeight: 700, color: "var(--primary-600)", fontSize: 14 }}>{resume.savedId}</span>
                <button className="btn btn-ghost btn-sm" style={{ padding: "4px 10px" }}
                  onClick={() => navigator.clipboard?.writeText(resume.savedId)}>Copy ID</button>
                <button className="btn btn-ghost btn-sm" style={{ padding: "4px 10px" }}
                  onClick={() => navigator.clipboard?.writeText(window.location.origin + "/r/" + resume.savedId)}>Copy link</button>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Enter this next time on this browser to skip the upload — it isn't stored on a server, so it won't follow you to another device.</span>
              </div>
            )}
            <div className="eyebrow">Step 2 — Review & matches</div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, margin: "8px 0 6px", flexWrap: "wrap" }}>
              <MatchRing score={resume.analysis.score} />
              <div>
                <h2 className="display" style={{ fontSize: 18 }}>{resume.analysis.profile?.headline || "Resume review"}</h2>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>Resume strength score</div>
              </div>
            </div>
            {resume.analysis.summary && <p style={{ fontSize: 14, lineHeight: 1.55 }}>{resume.analysis.summary}</p>}

            {resume.analysis.profile?.topSkills?.length > 0 && (
              <div style={{ margin: "12px 0 4px" }}>
                {resume.analysis.profile.topSkills.slice(0, 10).map((s, i) => <span key={i} className="chip">{s}</span>)}
              </div>
            )}

            {resume.analysis.improvements?.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div className="eyebrow" style={{ marginBottom: 8 }}>What to improve</div>
                <ul className="fix" style={{ paddingLeft: 18, margin: 0, fontSize: 13.5, lineHeight: 1.5 }}>
                  {resume.analysis.improvements.map((im, i) => (
                    <li key={i}><span className="issue">{im.issue}</span><span className="arrow">→</span>{im.fix}</li>
                  ))}
                </ul>
              </div>
            )}

            <hr className="divider" style={{ margin: "20px 0" }} />

            <div className="eyebrow" style={{ marginBottom: 10 }}>Find matching jobs</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Toggle on={jobSearch.visa} set={jobSearch.setVisa} label="Only visa-sponsoring employers"
                hint="Any work visa — H-1B, TN, O-1, E-3, L-1, green card, etc." />
              <Toggle on={jobSearch.remote} set={jobSearch.setRemote} label="Prefer remote / hybrid" />
              <div>
                <label className="eyebrow" style={{ display: "block", marginBottom: 6 }}>Location</label>
                <input type="text" value={jobSearch.location} onChange={(e) => jobSearch.setLocation(e.target.value)}
                  placeholder="e.g. United States, or New York, NY" style={{ maxWidth: 320 }} />
              </div>
            </div>

            <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <button className="btn btn-primary" disabled={jobSearch.searching} onClick={jobSearch.startSearch}>
                {jobSearch.searching
                  ? <><span className="spin" /> {jobSearch.searchPhase === "verifying" ? "Checking postings are still open…" : "Searching live listings…"}</>
                  : "Find matching jobs →"}
              </button>
              {jobSearch.searching && (
                <>
                  <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                    Batch {jobSearch.batchProgress.n} of up to {jobSearch.batchProgress.max}, checking up to 10 real links at a time up to 20{
                      models.hasWebSearch ? " — each batch spends a couple of live-search calls" : ""
                    }.
                  </span>
                  <button className="btn btn-ghost btn-sm" onClick={jobSearch.stopSearch}>Stop</button>
                </>
              )}
            </div>
          </section>
        )}

        {/* STEP 3 — job results */}
        {jobSearch.jobs && (
          <section style={{ marginBottom: 18 }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>
              Step 3 — {jobSearch.jobs.length} with verified links{jobSearch.searching ? " · finding more…" : " · apply"}
            </div>
            {jobSearch.jobs.length === 0 && jobSearch.searching && (
              <div className="card" style={{ padding: 20, fontSize: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span className="spin spin-ink" /> Searching and verifying the first roles… (batch {jobSearch.batchProgress.n} of up to {jobSearch.batchProgress.max})
                <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={jobSearch.stopSearch}>Stop</button>
              </div>
            )}
            {jobSearch.jobs.length === 0 && !jobSearch.searching && (
              <div className="card" style={{ padding: 20, fontSize: 14 }}>
                No matches with a working, still-open link came back{jobSearch.hiddenCount > 0 ? " (" + jobSearch.hiddenCount + " were dead links or already-filled roles)" : ""}. Try turning off the visa filter or broadening the location, then search again.
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {jobSearch.jobs.map((job, i) => <JobCard key={i} job={job} onPrepare={kit.prepareApplication} />)}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
              {jobSearch.searching && jobSearch.jobs.length > 0 && (
                <>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)" }}>
                    <span className="spin spin-ink" /> Finding more roles ({jobSearch.jobs.length} so far · batch {jobSearch.batchProgress.n}/{jobSearch.batchProgress.max})…
                  </span>
                  <button className="btn btn-ghost btn-sm" onClick={jobSearch.stopSearch}>Stop</button>
                </>
              )}
              {!jobSearch.searching && jobSearch.jobs.length > 0 && (
                <button className="btn btn-ghost btn-sm" onClick={jobSearch.loadMore}>Search for more →</button>
              )}
            </div>

            {jobSearch.unconfirmedJobs.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => jobSearch.setShowUnconfirmed((s) => !s)}>
                  {jobSearch.showUnconfirmed ? "Hide" : "Show"} {jobSearch.unconfirmedJobs.length} unverified link{jobSearch.unconfirmedJobs.length > 1 ? "s" : ""} {jobSearch.showUnconfirmed ? "▴" : "▾"}
                </button>
                <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "6px 0 0" }}>
                  These are real matches whose link couldn't be checked automatically — big job boards like LinkedIn and Indeed block automated requests. The links are probably fine; they just couldn't be confirmed from our server.
                </p>
                {jobSearch.showUnconfirmed && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
                    {jobSearch.unconfirmedJobs.map((job, i) => <JobCard key={i} job={job} onPrepare={kit.prepareApplication} muted />)}
                  </div>
                )}
              </div>
            )}

            <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 12 }}>
              {jobSearch.jobs.length > 0 && jobSearch.hiddenCount > 0 && (
                <>Left out {jobSearch.hiddenCount} listing{jobSearch.hiddenCount > 1 ? "s" : ""} whose link was dead, or whose page says the role is filled or no longer accepting applications. </>
              )}
              A verified link means the posting page loads — not that the role is still accepting applications. Confirm on the employer's site before applying.
            </p>
          </section>
        )}

        {/* application kit modal */}
        {kit.activeJob && (
          <div className="overlay" onClick={(e) => { if ((e.target as HTMLElement).classList.contains("overlay")) kit.closeKit(); }}>
            <div className="sheet">
              <div style={{ padding: "20px 22px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div>
                  <div className="eyebrow">Application kit</div>
                  <h2 className="display" style={{ fontSize: 18, marginTop: 4 }}>{kit.activeJob.title}</h2>
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>{kit.activeJob.company}</div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={kit.closeKit}>Close</button>
              </div>
              <div style={{ padding: 22 }}>
                {kit.buildingKit && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--muted)", fontSize: 14, padding: "18px 0" }}>
                    <span className="spin spin-ink" /> Tailoring your summary and cover letter…
                  </div>
                )}
                {kit.kit && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                    <KitBlock title="Tailored resume summary" text={kit.kit.tailoredSummary} />
                    {kit.kit.emphasize?.length > 0 && (
                      <div>
                        <div className="eyebrow" style={{ marginBottom: 8 }}>Lead with these</div>
                        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.55 }}>
                          {kit.kit.emphasize.map((x, i) => <li key={i}>{x}</li>)}
                        </ul>
                      </div>
                    )}
                    {kit.kit.autofill && <AutofillSheet data={kit.kit.autofill} />}
                    <KitBlock title="Cover letter" text={kit.kit.coverLetter} letter />
                    {kit.kit.prepNotes?.length > 0 && (
                      <div>
                        <div className="eyebrow" style={{ marginBottom: 8 }}>Before you send</div>
                        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.55, color: "var(--muted)" }}>
                          {kit.kit.prepNotes.map((x, i) => <li key={i}>{x}</li>)}
                        </ul>
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 16, alignItems: "center" }}>
                      {kit.activeJob.postingUrl && (
                        <a className="btn btn-primary btn-sm" href={kit.activeJob.postingUrl} target="_blank" rel="noopener noreferrer">
                          Open application page ↗
                        </a>
                      )}
                      {localReady ? (
                        <button className="btn btn-ghost btn-sm" disabled={kit.applyState.status === "working"}
                          onClick={() => kit.autoApplyLocal(kit.activeJob!)}>
                          {kit.applyState.status === "working"
                            ? <><span className="spin spin-ink" /> Auto-applying…</>
                            : "⚡ Auto-apply in Chromium"}
                        </button>
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>
                          ⚡ Auto-apply appears here when the local helper is running
                        </span>
                      )}
                    </div>
                    {kit.applyState.msg && (
                      <div style={{ fontSize: 12.5, marginTop: -8,
                        color: kit.applyState.status === "error" ? "#9A3B32" : kit.applyState.status === "done" ? "var(--good)" : "var(--muted)" }}>
                        {kit.applyState.msg}
                      </div>
                    )}
                    <p style={{ fontSize: 11.5, color: "var(--muted)", margin: 0 }}>
                      Harnon drafts everything for you. Auto-apply fills the form in a real Chromium and then stops so you can review and submit yourself — job portals need your login, and it never solves CAPTCHAs or submits blindly.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <footer style={{ textAlign: "center", marginTop: 40, fontSize: 11.5, color: "var(--muted)" }}>
          Harnon uses live web search — verify details before applying.
        </footer>
      </div>
    </div>
  );
}
