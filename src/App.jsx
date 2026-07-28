import React, { useState, useEffect, useRef } from "react";
import { saveResume, loadResumeRecord } from "./storage.js";

/* ============================================================
   Harnon — résumé in, matches out, applications ready.
   A working tool: it reads your resume, searches the live web
   for matching US roles, flags visa sponsorship, and drafts
   tailored application materials. All AI work runs through the
   Anthropic API (Claude). Nothing is mocked.
   ============================================================ */

const STYLE = `
:root{
  --bg:#EAF0EE; --surface:#FFFFFF; --ink:#12243A; --muted:#5E7286;
  --primary:#0E7C7B; --primary-600:#0B6463; --primary-050:#E1F1F0;
  --signal:#C77C1E; --signal-050:#FBF0DD;
  --good:#0F8A5F; --good-050:#E4F4EC;
  --warn:#8A6D2F;
  --line:#D8E2DF;
  --shadow:0 1px 2px rgba(18,36,58,.05),0 10px 30px rgba(18,36,58,.07);
  --radius:16px;
}
*{box-sizing:border-box}
.harnon{font-family:'Inter',system-ui,-apple-system,sans-serif;color:var(--ink);
  background:radial-gradient(120% 80% at 50% -10%,#F3F7F6 0%,var(--bg) 60%);min-height:100vh;
  -webkit-font-smoothing:antialiased;}
.display{font-family:'Space Grotesk','Inter',sans-serif;letter-spacing:-.01em}
.mono{font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,monospace}
.wrap{max-width:940px;margin:0 auto;padding:28px 20px 80px}
.eyebrow{font-family:'JetBrains Mono',ui-monospace,monospace;text-transform:uppercase;
  letter-spacing:.16em;font-size:10.5px;color:var(--muted)}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);
  box-shadow:var(--shadow)}
h1,h2,h3{margin:0}
.btn{font-family:inherit;font-weight:600;font-size:14px;border-radius:11px;padding:11px 18px;
  cursor:pointer;border:1px solid transparent;transition:background .15s,transform .05s,box-shadow .15s;
  display:inline-flex;align-items:center;gap:8px;line-height:1}
.btn:active{transform:translateY(1px)}
.btn:disabled{opacity:.5;cursor:not-allowed}
.btn-primary{background:var(--primary);color:#fff}
.btn-primary:hover:not(:disabled){background:var(--primary-600)}
.btn-ghost{background:#fff;border-color:var(--line);color:var(--ink)}
.btn-ghost:hover:not(:disabled){border-color:var(--primary);color:var(--primary-600)}
.btn-sm{padding:8px 13px;font-size:13px;border-radius:9px}
textarea,input[type=text]{width:100%;font-family:inherit;font-size:14px;color:var(--ink);
  background:#fff;border:1px solid var(--line);border-radius:12px;padding:13px 14px;outline:none;
  transition:border-color .15s,box-shadow .15s}
textarea:focus,input[type=text]:focus{border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-050)}
textarea::placeholder,input::placeholder{color:#9AAAB4}
select:focus{border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-050)}
.chip{display:inline-flex;align-items:center;background:var(--primary-050);color:var(--primary-600);
  border-radius:999px;padding:5px 11px;font-size:12px;font-weight:600;margin:0 6px 6px 0}
.steps{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:14px 0 26px}
.step{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--muted);font-weight:600}
.step .dot{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:11px;
  border:1.5px solid var(--line);background:#fff;color:var(--muted);font-family:'JetBrains Mono',monospace}
.step.on .dot{background:var(--primary);border-color:var(--primary);color:#fff}
.step.on{color:var(--ink)}
.step .bar{width:26px;height:1.5px;background:var(--line)}
.toggle{display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none}
.track{width:42px;height:24px;border-radius:999px;background:var(--line);position:relative;transition:background .18s;flex:none}
.track.on{background:var(--primary)}
.knob{position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#fff;
  box-shadow:0 1px 3px rgba(0,0,0,.2);transition:left .18s}
.track.on .knob{left:20px}
.pill{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:4px 10px;font-size:11.5px;font-weight:700}
.pill-stated{background:var(--good-050);color:var(--good)}
.pill-likely{background:var(--signal-050);color:var(--signal)}
.pill-unknown{background:#EEF2F1;color:var(--muted)}
.link{color:var(--primary-600);font-weight:600;text-decoration:none;border-bottom:1px solid transparent;transition:border-color .15s}
.link:hover{border-color:var(--primary-600)}
.fix li{margin-bottom:10px}
.fix .issue{font-weight:600}
.fix .arrow{color:var(--primary);font-weight:700;margin:0 4px}
.spin{width:16px;height:16px;border:2px solid rgba(255,255,255,.45);border-top-color:#fff;border-radius:50%;
  animation:sp .7s linear infinite}
.spin-ink{border-color:rgba(14,124,123,.25);border-top-color:var(--primary)}
@keyframes sp{to{transform:rotate(360deg)}}
.job{border:1px solid var(--line);border-radius:14px;padding:16px;background:#fff;transition:border-color .15s,box-shadow .15s}
.job:hover{border-color:#BFD3CF;box-shadow:0 6px 18px rgba(18,36,58,.06)}
.divider{height:1px;background:var(--line);border:none;margin:0}
.err{background:#FBEDEC;border:1px solid #F0C9C4;color:#9A3B32;border-radius:12px;padding:12px 14px;font-size:13.5px}
.letter{white-space:pre-wrap;font-size:13.5px;line-height:1.6;color:var(--ink)}
.overlay{position:fixed;inset:0;background:rgba(18,36,58,.42);display:flex;align-items:flex-start;
  justify-content:center;padding:24px 16px;overflow-y:auto;z-index:50}
.sheet{background:var(--surface);border-radius:18px;max-width:720px;width:100%;box-shadow:0 24px 60px rgba(0,0,0,.3);margin:auto}
a.rawlink{word-break:break-all}
@media (max-width:560px){.wrap{padding:20px 14px 70px}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
:focus-visible{outline:2px solid var(--primary);outline-offset:2px;border-radius:6px}
`;

// All model calls go through our own backend (/api/claude), which holds the
// Anthropic API key server-side. The browser never sees the key.
const API = "/api/claude";

/* ---- helpers ---- */

// When a model hits its token limit mid-array, salvage whatever complete
// top-level elements came through instead of discarding the whole batch —
// e.g. 4 of 6 job listings is still useful, and previously a single truncated
// batch would throw and abort the entire multi-batch search loop.
function salvageJsonArray(t) {
  const start = t.indexOf("[");
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false, lastSafe = -1, closedFully = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "[" || c === "{") { depth++; continue; }
    if (c === "]" || c === "}") {
      depth--;
      if (depth === 1) lastSafe = i + 1;
      else if (depth === 0) { lastSafe = i + 1; closedFully = true; break; }
    }
  }
  if (lastSafe === -1) return null;
  const candidate = closedFully ? t.slice(start, lastSafe) : t.slice(start, lastSafe) + "]";
  try {
    const parsed = JSON.parse(candidate);
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) { return null; }
}

function extractJson(raw) {
  if (!raw) throw new Error("Claude returned an empty response.");
  let t = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/g, "").trim();
  try { return JSON.parse(t); } catch (e) {}
  const oi = t.indexOf("{"), ai = t.indexOf("[");
  let start, close;
  if (ai !== -1 && (oi === -1 || ai < oi)) { start = ai; close = "]"; }
  else { start = oi; close = "}"; }
  if (start === -1) throw new Error("Couldn't find structured data in the response.");
  const end = t.lastIndexOf(close);
  if (end !== -1 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch (e) {}
  }
  if (close === "]") {
    const salvaged = salvageJsonArray(t);
    if (salvaged && salvaged.length) return salvaged;
  }
  throw new Error("The response was cut off. Try again.");
}

async function callClaude({ system, content, tools, maxTokens = 4096, model }) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, content, tools, max_tokens: maxTokens, model }),
  });
  if (!res.ok) {
    let msg = "The request failed (" + res.status + "). Please try again.";
    try { const j = await res.json(); if (j && j.error) msg = typeof j.error === "string" ? j.error : (j.error.message || msg); } catch (_) {}
    throw new Error(msg);
  }
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("Claude didn't return any text. Please try again.");
  return text;
}

function makeId() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous I/L/O/0/1
  let s = "";
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return "HRN-" + s;
}

function MatchRing({ score }) {
  const r = 20, c = 2 * Math.PI * r, pct = Math.max(0, Math.min(100, score || 0));
  const col = pct >= 80 ? "#0F8A5F" : pct >= 60 ? "#0E7C7B" : "#C77C1E";
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" style={{ flex: "none" }}>
      <circle cx="26" cy="26" r={r} fill="none" stroke="#E3EAE8" strokeWidth="5" />
      <circle cx="26" cy="26" r={r} fill="none" stroke={col} strokeWidth="5" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} transform="rotate(-90 26 26)" />
      <text x="26" y="30" textAnchor="middle" fontSize="14" fontWeight="700" fill={col}
        fontFamily="'Space Grotesk',sans-serif">{pct}</text>
    </svg>
  );
}

function VisaPill({ status }) {
  const map = {
    stated: ["pill-stated", "✓ Sponsorship stated"],
    likely: ["pill-likely", "◐ Likely sponsor"],
    unknown: ["pill-unknown", "· Sponsorship unclear"],
  };
  const [cls, label] = map[status] || map.unknown;
  return <span className={"pill " + cls}>{label}</span>;
}

function Toggle({ on, set, label, hint }) {
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

function JobCard({ job, onPrepare, muted }) {
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

export default function App() {
  const [stage, setStage] = useState(1); // 1 resume, 2 matches, 3 apply
  const [resumeText, setResumeText] = useState("");
  const [resumePdf, setResumePdf] = useState(null); // {name, data}
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);

  const [visa, setVisa] = useState(true);
  const [remote, setRemote] = useState(false);
  const [location, setLocation] = useState("United States");
  const [jobs, setJobs] = useState(null);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [unconfirmedJobs, setUnconfirmedJobs] = useState([]);
  const [showUnconfirmed, setShowUnconfirmed] = useState(false);
  const uncRef = useRef([]);
  const [searching, setSearching] = useState(false);
  const [searchPhase, setSearchPhase] = useState(""); // "" | "searching" | "verifying"
  const [batchProgress, setBatchProgress] = useState({ n: 0, max: 0 });

  const [savedId, setSavedId] = useState("");
  const [idInput, setIdInput] = useState("");
  const [loadingId, setLoadingId] = useState(false);

  const [activeJob, setActiveJob] = useState(null);
  const [kit, setKit] = useState(null);
  const [buildingKit, setBuildingKit] = useState(false);
  const [applyState, setApplyState] = useState({ status: "idle", msg: "" });
  const [localReady, setLocalReady] = useState(false);

  const [error, setError] = useState("");
  const fileRef = useRef();
  const stopRef = useRef(false);

  // Model selector
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("");
  const currentModel = availableModels.find((m) => m.id === selectedModel) || {};
  const hasWebSearch = currentModel.webSearch === true;

  useEffect(() => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;600&display=swap";
    document.head.appendChild(l);
    const s = document.createElement("style");
    s.textContent = STYLE;
    document.head.appendChild(s);
  }, []);

  // Fetch available models from the backend
  useEffect(() => {
    fetch("/api/models")
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => {
        const list = d.models || [];
        setAvailableModels(list);
        if (list.length > 0 && !selectedModel) {
          // Default to Sonnet — the best cost/capability balance with live
          // search — regardless of the order /api/models happens to return.
          const preferred = list.find((m) => m.id === "claude-sonnet-5") || list[0];
          setSelectedModel(preferred.id);
        }
      })
      .catch(() => {});
  }, []);

  // Detect the local auto-apply helper (only reachable when running on the user's machine)
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    fetch("http://localhost:8787/ping", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(() => { if (!cancelled) setLocalReady(true); })
      .catch(() => {})
      .finally(() => clearTimeout(t));
    return () => { cancelled = true; ctrl.abort(); };
  }, []);

  const hasResume = resumePdf || resumeText.trim().length > 40;

  // Prefer the already-extracted plain text over resending the raw PDF —
  // once analyzeResume has extracted resumeText once, every later call
  // (e.g. one per "Prepare application" click) reuses the cheap text form
  // instead of re-sending the full PDF document each time.
  function resumeContent(instruction) {
    if (resumeText.trim()) {
      return instruction + "\n\n--- RESUME TEXT ---\n" + resumeText;
    }
    if (resumePdf) {
      return [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: resumePdf.data } },
        { type: "text", text: instruction },
      ];
    }
    return instruction;
  }

  function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError("");
    if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) {
      const r = new FileReader();
      r.onload = () => { setResumePdf({ name: f.name, data: String(r.result).split(",")[1] }); setResumeText(""); };
      r.onerror = () => setError("Couldn't read that PDF. Try pasting the text instead.");
      r.readAsDataURL(f);
    } else {
      const r = new FileReader();
      r.onload = () => { setResumeText(String(r.result)); setResumePdf(null); };
      r.onerror = () => setError("Couldn't read that file. Try pasting the text instead.");
      r.readAsText(f);
    }
  }

  async function analyzeResume() {
    setError(""); setAnalyzing(true); setAnalysis(null);
    try {
      // Only ask the model to transcribe the resume when we don't already
      // have plain text (i.e. a PDF was uploaded) — when text was pasted,
      // re-generating it as output is pure wasted tokens on every analysis.
      const needsTranscript = !resumeText.trim();
      const instruction =
        "You are a senior technical recruiter and resume coach. Review this resume for a US job search. " +
        "Respond with ONLY one valid JSON object, no markdown, no commentary. Schema:\n" +
        '{"profile":{"name":string,"headline":string,"targetTitles":[string],"yearsExperience":number,' +
        '"seniority":string,"topSkills":[string],"industries":[string]},' +
        '"score":number(0-100),"summary":string,' +
        '"strengths":[string],' +
        '"improvements":[{"issue":string,"fix":string}],' +
        '"atsKeywords":[string]' +
        (needsTranscript ? ',"resumeText":string(the full resume as clean plain text, so it can be reused later)}' : "}");
      const text = await callClaude({ content: resumeContent(instruction), maxTokens: needsTranscript ? 4096 : 2048, model: selectedModel });
      const parsed = extractJson(text);
      const rt = resumeText.trim() ? resumeText : (parsed.resumeText || "");
      if (!resumeText.trim() && parsed.resumeText) setResumeText(parsed.resumeText);
      setAnalysis(parsed);
      const id = makeId();
      setSavedId(id);
      saveResume(id, parsed, rt);
      setStage(2);
    } catch (e) { setError(e.message); }
    setAnalyzing(false);
  }

  async function loadById() {
    const id = idInput.trim().toUpperCase();
    if (!id) return;
    setError(""); setLoadingId(true);
    try {
      const rec = await loadResumeRecord(id);
      if (!rec) throw new Error("No saved resume found for " + id + ". Double-check the code, or upload your resume to create a new one.");
      setAnalysis(rec.analysis);
      setResumeText(rec.resumeText || rec.analysis?.resumeText || "");
      setResumePdf(null);
      setSavedId(rec.id || id);
      setJobs(null); setActiveJob(null); setKit(null); setHiddenCount(0);
      setStage(2);
    } catch (e) { setError(e.message); }
    setLoadingId(false);
  }

  function jobKey(j) {
    return (j.title || "").toLowerCase().trim() + "|" + (j.company || "").toLowerCase().trim();
  }

  async function searchBatch(knownKeys) {
    const p = analysis.profile || {};
    const filters =
      (visa
        ? "REQUIRED: only include employers that sponsor work visas of ANY type (H-1B, TN/USMCA, O-1, E-3, L-1, cap-exempt, green-card/PERM, etc.) or postings that explicitly state visa sponsorship for international candidates. Do NOT restrict to H-1B only. "
        : "") +
      (remote ? "Prefer remote or hybrid roles. " : "") +
      "Location focus: " + (location || "United States") + ". ";
    // Only hint the most recent keys — we still hard-dedupe every candidate
    // against the full accumulator client-side, so this list only needs to
    // steer the model, not guarantee uniqueness. Keeping it short saves
    // meaningfully on repeated input tokens across up to 14 batches.
    const exclude = knownKeys.length
      ? "Do NOT repeat any of these already-found roles: " + knownKeys.slice(-15).join("; ") + ". Find DIFFERENT postings. "
      : "";
    const instruction =
      "Use web search to find 6 real, currently-open job postings in the United States that match this candidate. " +
      filters + exclude +
      "Candidate profile: " + JSON.stringify(p) + ". " +
      "For each posting, find the actual application/listing URL (LinkedIn, Indeed, or the company careers page). " +
      "After searching, respond with ONLY a JSON array (no markdown, no prose). Each item schema:\n" +
      '{"title":string,"company":string,"location":string,"remote":boolean,' +
      '"matchScore":number(0-100),"matchReasons":[string up to 3],' +
      '"visaSponsorship":"stated"|"likely"|"unknown","visaNote":string(which visa types this employer is known to sponsor, e.g. "H-1B & TN", or ""),' +
      '"salary":string(or ""),"postingUrl":string,"source":string}. ' +
      "Base matchScore on real overlap with the candidate's skills and seniority. Only include postings you actually found.";
    const opts = {
      content: instruction,
      system: "You are a diligent US job-search assistant. " + (hasWebSearch ? "Only return postings backed by real search results with working URLs." : "Return the best real postings you know of with real company career-page or LinkedIn URLs. Use your training data since live search is not available."),
      maxTokens: 4096,
      model: selectedModel,
    };
    if (hasWebSearch) opts.tools = [{ type: "web_search_20250305", name: "web_search" }];
    const text = await callClaude(opts);
    const arr = extractJson(text);
    return Array.isArray(arr) ? arr : arr.jobs || [];
  }

  async function verifyBatch(cands) {
    // Without web search we can't verify live — pass all through as unverified
    if (!hasWebSearch) {
      return { openOnes: cands.map((j) => ({ ...j, status: "unverified", checkedNote: "No live search on this model" })), unconfirmedOnes: [], hidden: 0 };
    }
    const today = new Date().toISOString().slice(0, 10);
    const verifyInstruction =
      "Today is " + today + ". Use web search to verify whether each of these job postings is REAL and STILL ACCEPTING APPLICATIONS right now. " +
      "For each, search the role + company (and the posting URL if useful) and judge whether it is still live — not filled, expired, or removed. " +
      "Respond with ONLY a JSON array. Keep the same order and ADD to each item: " +
      '"status":"open"|"closed"|"unconfirmed" and "checkedNote":string(short reason, e.g. "Active on LinkedIn, posted recently" or "Listing no longer found"). ' +
      "Mark \"open\" ONLY when search results support that it is still accepting applications. If evidence is missing, use \"unconfirmed\". Never guess \"open\". " +
      "Postings to verify: " +
      JSON.stringify(cands.map((j) => ({ title: j.title, company: j.company, location: j.location, postingUrl: j.postingUrl, source: j.source })));
    let verified = [];
    try {
      const vtext = await callClaude({
        content: verifyInstruction,
        system: "You verify job postings against live web results. Never mark a posting open unless the search results support it.",
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        maxTokens: 4096,
        model: selectedModel,
      });
      const varr = extractJson(vtext);
      verified = Array.isArray(varr) ? varr : varr.jobs || [];
    } catch (e) { verified = []; }
    const byKey = {};
    verified.forEach((v) => { byKey[jobKey(v)] = v; });
    const openOnes = [];
    const unconfirmedOnes = [];
    let hidden = 0;
    cands.forEach((j) => {
      const v = byKey[jobKey(j)];
      if (v && v.status === "open") openOnes.push({ ...j, status: "open", checkedNote: v.checkedNote || "" });
      else if (v && v.status === "closed") hidden++; // confirmed no longer accepting applications — genuinely not worth showing
      else unconfirmedOnes.push({ ...j, status: "unconfirmed", checkedNote: (v && v.checkedNote) || "Couldn't confirm this is still open." });
    });
    return { openOnes, unconfirmedOnes, hidden };
  }

  // Streams results in: keeps searching + verifying batches, appending, until targetCount confirmed-open.
  async function runBatches(targetCount, seed) {
    if (!analysis) return;
    stopRef.current = false;
    setError(""); setSearching(true);
    const acc = [...seed];
    if (acc.length === 0) setJobs([]); // render the results section immediately
    let emptyStreak = 0, batches = 0;
    const MAX_BATCHES = 14;
    setBatchProgress({ n: 0, max: MAX_BATCHES });
    while (acc.length < targetCount && batches < MAX_BATCHES && !stopRef.current) {
      batches++;
      setBatchProgress({ n: batches, max: MAX_BATCHES });
      setSearchPhase("searching");
      let cand;
      try { cand = await searchBatch(acc.map(jobKey)); }
      catch (e) { setError(e.message); break; }
      if (stopRef.current) break;
      cand = (cand || []).filter((c) => !acc.some((a) => jobKey(a) === jobKey(c)));
      if (cand.length === 0) { emptyStreak++; if (emptyStreak >= 2) break; continue; }
      setSearchPhase("verifying");
      const { openOnes, unconfirmedOnes, hidden } = await verifyBatch(cand);
      if (stopRef.current) break;
      const before = acc.length;
      openOnes.forEach((o) => { if (!acc.some((a) => jobKey(a) === jobKey(o))) acc.push(o); });
      if (unconfirmedOnes && unconfirmedOnes.length) {
        unconfirmedOnes.forEach((u) => {
          if (!acc.some((a) => jobKey(a) === jobKey(u)) && !uncRef.current.some((x) => jobKey(x) === jobKey(u))) {
            uncRef.current.push(u);
          }
        });
        setUnconfirmedJobs([...uncRef.current]);
      }
      if (hidden) setHiddenCount((h) => h + hidden);
      if (acc.length === before) { emptyStreak++; if (emptyStreak >= 2) break; }
      else { emptyStreak = 0; acc.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0)); setJobs([...acc]); setStage(3); }
    }
    setJobs([...acc.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0))]);
    if (acc.length > 0) setStage(3);
    setSearching(false); setSearchPhase("");
  }

  function startSearch() { setJobs([]); setHiddenCount(0); uncRef.current = []; setUnconfirmedJobs([]); setShowUnconfirmed(false); runBatches(20, []); }
  function loadMore() { runBatches((jobs ? jobs.length : 0) + 20, jobs || []); }
  function stopSearch() { stopRef.current = true; }

  async function autoApplyLocal(job) {
    setApplyState({ status: "working", msg: "Opening Chromium and filling the application…" });
    try {
      const profile = { ...((kit && kit.autofill) || {}), resumeText };
      const r = await fetch("http://localhost:8787/apply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job, profile }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || "Auto-apply failed.");
      setApplyState({ status: "done", msg: "Filled " + data.filled + " field(s). Review everything in the Chromium window, then submit it yourself." });
    } catch (e) {
      setApplyState({ status: "error", msg: "Couldn't reach the local helper. Make sure it's running (node server.js). " + (e.message || "") });
    }
  }

  async function prepareApplication(job) {
    setActiveJob(job); setKit(null); setBuildingKit(true); setError(""); setApplyState({ status: "idle", msg: "" });
    try {
      const instruction =
        "You are an expert application writer. Using the candidate's resume and this specific job, produce tailored materials. " +
        "Job: " + JSON.stringify({ title: job.title, company: job.company, location: job.location, source: job.source, url: job.postingUrl }) + ". " +
        "Respond with ONLY valid JSON (no markdown). Schema:\n" +
        '{"tailoredSummary":string(2-3 sentence resume headline tuned to this role),' +
        '"coverLetter":string(concise, specific, ~250 words, ready to send, no placeholders except [Company] if truly unknown),' +
        '"emphasize":[string(3-5 resume points to lead with for this role)],' +
        '"autofill":{"fullName":string,"email":string(from resume, else ""),"phone":string(from resume, else ""),' +
        '"location":string,"linkedin":string(or ""),"website":string(or ""),"currentTitle":string,' +
        '"yearsExperience":string,' +
        '"workAuthorization":string(what to put for US work authorization based on the resume; if unclear, "Confirm your status"),' +
        '"requiresSponsorship":string("Yes"|"No"|"Confirm"),' +
        '"desiredSalary":string(a reasonable range for this role and location, or ""),' +
        '"availability":string(e.g. "Available with 2 weeks notice" or "Confirm"),' +
        '"willRelocate":string("Yes"|"No"|"Confirm"),' +
        '"screeningAnswers":[{"q":string,"a":string}] (write ready-to-paste answers to 4-5 common portal questions tailored to THIS job and company, e.g. "Why do you want to work here?", "Describe your most relevant experience", "What is your greatest strength?")},' +
        '"prepNotes":[string(2-4 quick tips: keywords to add, likely interview themes, or gaps to address)]}';
      const text = await callClaude({ content: resumeContent(instruction), maxTokens: 4096, model: selectedModel });
      setKit(extractJson(text));
    } catch (e) { setError(e.message); setActiveJob(null); }
    setBuildingKit(false);
  }

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
          {availableModels.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="eyebrow" style={{ margin: 0 }}>Model</span>
              <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}
                style={{ font: "inherit", fontSize: 13, fontWeight: 600, color: "var(--ink)",
                  background: "#fff", border: "1px solid var(--line)", borderRadius: 9,
                  padding: "7px 10px", outline: "none", cursor: "pointer", maxWidth: 220 }}>
                {availableModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}{m.free ? " (free)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
        </header>

        {currentModel.id && !currentModel.webSearch && (
          <div style={{ background: "var(--signal-050)", border: "1px solid #ECD8A7", borderRadius: 10,
            padding: "8px 14px", fontSize: 12.5, color: "var(--warn)", marginBottom: 6 }}>
            <strong>{currentModel.label}</strong> is free but doesn't support live web search — job listings
            come from the model's training data and can't be verified as still open. Switch to a Claude model
            for live search and verification.
          </div>
        )}

        {/* stepper */}
        <div className="steps">
          {[["Resume", 1], ["Matches", 2], ["Apply", 3]].map(([lbl, n], i) => (
            <React.Fragment key={n}>
              {i > 0 && <span className="bar" style={{ width: 26, height: 1.5, background: "var(--line)" }} />}
              <span className={"step" + (stage >= n ? " on" : "")}>
                <span className="dot">{n}</span>{lbl}
              </span>
            </React.Fragment>
          ))}
        </div>

        {error && <div className="err" style={{ marginBottom: 18 }}>{error}</div>}

        {/* Returning user — load by ID */}
        <div className="card" style={{ padding: "14px 18px", marginBottom: 18, display: "flex",
          gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span className="eyebrow" style={{ flex: "none" }}>Used Harnon on this device before?</span>
          <input type="text" value={idInput} onChange={(e) => setIdInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") loadById(); }}
            placeholder="Enter your Harnon ID (e.g. HRN-K7M2P)"
            style={{ flex: "1 1 200px", maxWidth: 320, textTransform: "uppercase" }} />
          <button className="btn btn-ghost btn-sm" disabled={loadingId || !idInput.trim()} onClick={loadById}>
            {loadingId ? <><span className="spin spin-ink" /> Loading…</> : "Load my resume"}
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
            <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
              ⬆ Upload PDF or .txt
            </button>
            <input ref={fileRef} type="file" accept=".pdf,.txt,.md" onChange={onFile} style={{ display: "none" }} />
            {resumePdf && <span className="chip">📄 {resumePdf.name}</span>}
          </div>

          {!resumePdf && (
            <textarea rows={7} placeholder="…or paste your resume text here"
              value={resumeText} onChange={(e) => setResumeText(e.target.value)} />
          )}

          <div style={{ marginTop: 16 }}>
            <button className="btn btn-primary" disabled={!hasResume || analyzing} onClick={analyzeResume}>
              {analyzing ? <><span className="spin" /> Reading your resume…</> : "Review my resume →"}
            </button>
          </div>
        </section>

        {/* STEP 2 — review + search controls */}
        {analysis && (
          <section className="card" style={{ padding: 22, marginBottom: 18 }}>
            {savedId && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                background: "var(--primary-050)", border: "1px solid #CFE7E5", borderRadius: 10,
                padding: "8px 12px", marginBottom: 16 }}>
                <span style={{ fontSize: 13 }}>Saved as</span>
                <span className="mono" style={{ fontWeight: 700, color: "var(--primary-600)", fontSize: 14 }}>{savedId}</span>
                <button className="btn btn-ghost btn-sm" style={{ padding: "4px 10px" }}
                  onClick={() => navigator.clipboard?.writeText(savedId)}>Copy ID</button>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Enter this next time on this browser to skip the upload — it isn't stored on a server, so it won't follow you to another device.</span>
              </div>
            )}
            <div className="eyebrow">Step 2 — Review & matches</div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, margin: "8px 0 6px", flexWrap: "wrap" }}>
              <MatchRing score={analysis.score} />
              <div>
                <h2 className="display" style={{ fontSize: 18 }}>{analysis.profile?.headline || "Resume review"}</h2>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>Resume strength score</div>
              </div>
            </div>
            {analysis.summary && <p style={{ fontSize: 14, lineHeight: 1.55 }}>{analysis.summary}</p>}

            {analysis.profile?.topSkills?.length > 0 && (
              <div style={{ margin: "12px 0 4px" }}>
                {analysis.profile.topSkills.slice(0, 10).map((s, i) => <span key={i} className="chip">{s}</span>)}
              </div>
            )}

            {analysis.improvements?.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div className="eyebrow" style={{ marginBottom: 8 }}>What to improve</div>
                <ul className="fix" style={{ paddingLeft: 18, margin: 0, fontSize: 13.5, lineHeight: 1.5 }}>
                  {analysis.improvements.map((im, i) => (
                    <li key={i}><span className="issue">{im.issue}</span><span className="arrow">→</span>{im.fix}</li>
                  ))}
                </ul>
              </div>
            )}

            <hr className="divider" style={{ margin: "20px 0" }} />

            <div className="eyebrow" style={{ marginBottom: 10 }}>Find matching jobs</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Toggle on={visa} set={setVisa} label="Only visa-sponsoring employers"
                hint="Any work visa — H-1B, TN, O-1, E-3, L-1, green card, etc." />
              <Toggle on={remote} set={setRemote} label="Prefer remote / hybrid" />
              <div>
                <label className="eyebrow" style={{ display: "block", marginBottom: 6 }}>Location</label>
                <input type="text" value={location} onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. United States, or New York, NY" style={{ maxWidth: 320 }} />
              </div>
            </div>

            <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <button className="btn btn-primary" disabled={searching} onClick={startSearch}>
                {searching
                  ? <><span className="spin" /> {searchPhase === "verifying" ? "Checking postings are still open…" : "Searching live listings…"}</>
                  : "Find matching jobs →"}
              </button>
              {searching && (
                <>
                  <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                    Batch {batchProgress.n} of up to {batchProgress.max}, loading 5 at a time up to 20{
                      hasWebSearch ? " — each batch spends a couple of live-search calls" : ""
                    }.
                  </span>
                  <button className="btn btn-ghost btn-sm" onClick={stopSearch}>Stop</button>
                </>
              )}
            </div>
          </section>
        )}

        {/* STEP 3 — job results */}
        {jobs && (
          <section style={{ marginBottom: 18 }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>
              Step 3 — {jobs.length} confirmed open{searching ? " · finding more…" : " · apply"}
            </div>
            {jobs.length === 0 && searching && (
              <div className="card" style={{ padding: 20, fontSize: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span className="spin spin-ink" /> Searching and verifying the first roles… (batch {batchProgress.n} of up to {batchProgress.max})
                <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={stopSearch}>Stop</button>
              </div>
            )}
            {jobs.length === 0 && !searching && (
              <div className="card" style={{ padding: 20, fontSize: 14 }}>
                Nothing came back that we could confirm is still open{hiddenCount > 0 ? " (" + hiddenCount + " confirmed closed and left out)" : ""}. Try turning off the visa filter or broadening the location, then search again.
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {jobs.map((job, i) => <JobCard key={i} job={job} onPrepare={prepareApplication} />)}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
              {searching && jobs.length > 0 && (
                <>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)" }}>
                    <span className="spin spin-ink" /> Finding more roles ({jobs.length} so far · batch {batchProgress.n}/{batchProgress.max})…
                  </span>
                  <button className="btn btn-ghost btn-sm" onClick={stopSearch}>Stop</button>
                </>
              )}
              {!searching && jobs.length > 0 && (
                <button className="btn btn-ghost btn-sm" onClick={loadMore}>Search for more →</button>
              )}
            </div>

            {unconfirmedJobs.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowUnconfirmed((s) => !s)}>
                  {showUnconfirmed ? "Hide" : "Show"} {unconfirmedJobs.length} unconfirmed match{unconfirmedJobs.length > 1 ? "es" : ""} {showUnconfirmed ? "▴" : "▾"}
                </button>
                <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "6px 0 0" }}>
                  These looked like real matches but a live check couldn't confirm they're still accepting applications — worth a manual look rather than discarding.
                </p>
                {showUnconfirmed && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
                    {unconfirmedJobs.map((job, i) => <JobCard key={i} job={job} onPrepare={prepareApplication} muted />)}
                  </div>
                )}
              </div>
            )}

            <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 12 }}>
              {jobs.length > 0 && hiddenCount > 0 && (
                <>Left out {hiddenCount} listing{hiddenCount > 1 ? "s" : ""} confirmed no longer accepting applications. </>
              )}
              Roles above are verified as currently open, but postings can close at any time — reconfirm on the employer's site before applying.
            </p>
          </section>
        )}

        {/* application kit modal */}
        {activeJob && (
          <div className="overlay" onClick={(e) => { if (e.target.classList.contains("overlay")) { setActiveJob(null); setKit(null); } }}>
            <div className="sheet">
              <div style={{ padding: "20px 22px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div>
                  <div className="eyebrow">Application kit</div>
                  <h2 className="display" style={{ fontSize: 18, marginTop: 4 }}>{activeJob.title}</h2>
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>{activeJob.company}</div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => { setActiveJob(null); setKit(null); }}>Close</button>
              </div>
              <div style={{ padding: 22 }}>
                {buildingKit && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--muted)", fontSize: 14, padding: "18px 0" }}>
                    <span className="spin spin-ink" /> Tailoring your summary and cover letter…
                  </div>
                )}
                {kit && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                    <KitBlock title="Tailored resume summary" text={kit.tailoredSummary} />
                    {kit.emphasize?.length > 0 && (
                      <div>
                        <div className="eyebrow" style={{ marginBottom: 8 }}>Lead with these</div>
                        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.55 }}>
                          {kit.emphasize.map((x, i) => <li key={i}>{x}</li>)}
                        </ul>
                      </div>
                    )}
                    {kit.autofill && <AutofillSheet data={kit.autofill} />}
                    <KitBlock title="Cover letter" text={kit.coverLetter} letter />
                    {kit.prepNotes?.length > 0 && (
                      <div>
                        <div className="eyebrow" style={{ marginBottom: 8 }}>Before you send</div>
                        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.55, color: "var(--muted)" }}>
                          {kit.prepNotes.map((x, i) => <li key={i}>{x}</li>)}
                        </ul>
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 16, alignItems: "center" }}>
                      {activeJob.postingUrl && (
                        <a className="btn btn-primary btn-sm" href={activeJob.postingUrl} target="_blank" rel="noopener noreferrer">
                          Open application page ↗
                        </a>
                      )}
                      {localReady ? (
                        <button className="btn btn-ghost btn-sm" disabled={applyState.status === "working"}
                          onClick={() => autoApplyLocal(activeJob)}>
                          {applyState.status === "working"
                            ? <><span className="spin spin-ink" /> Auto-applying…</>
                            : "⚡ Auto-apply in Chromium"}
                        </button>
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>
                          ⚡ Auto-apply appears here when the local helper is running
                        </span>
                      )}
                    </div>
                    {applyState.msg && (
                      <div style={{ fontSize: 12.5, marginTop: -8,
                        color: applyState.status === "error" ? "#9A3B32" : applyState.status === "done" ? "var(--good)" : "var(--muted)" }}>
                        {applyState.msg}
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

function KitBlock({ title, text, letter }) {
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

function CopyRow({ label, value }) {
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

function AutofillSheet({ data }) {
  const [allCopied, setAllCopied] = useState(false);
  const fields = [
    ["Full name", "fullName"], ["Email", "email"], ["Phone", "phone"], ["Location", "location"],
    ["LinkedIn", "linkedin"], ["Website / portfolio", "website"], ["Current title", "currentTitle"],
    ["Years of experience", "yearsExperience"], ["US work authorization", "workAuthorization"],
    ["Requires sponsorship?", "requiresSponsorship"], ["Desired salary", "desiredSalary"],
    ["Availability / notice", "availability"], ["Open to relocation?", "willRelocate"],
  ];
  const present = fields.filter(([, k]) => data[k]);
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
