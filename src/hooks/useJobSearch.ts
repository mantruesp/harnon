import { useRef, useState } from "react";
import { callClaude, checkUrls, extractJson } from "../api/client";
import type { CallClaudeOptions } from "../api/client";
import type { BatchProgress, JobPosting, ResumeAnalysis, SearchPhase } from "../types";

function jobKey(j: Pick<JobPosting, "title" | "company">): string {
  return (j.title || "").toLowerCase().trim() + "|" + (j.company || "").toLowerCase().trim();
}

export function useJobSearch(
  analysis: ResumeAnalysis | null,
  selectedModel: string,
  hasWebSearch: boolean,
  setError: (msg: string) => void,
) {
  const [visa, setVisa] = useState(true);
  const [remote, setRemote] = useState(false);
  const [location, setLocation] = useState("United States");

  const [jobs, setJobs] = useState<JobPosting[] | null>(null);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [unconfirmedJobs, setUnconfirmedJobs] = useState<JobPosting[]>([]);
  const [showUnconfirmed, setShowUnconfirmed] = useState(false);
  const uncRef = useRef<JobPosting[]>([]);

  const [searching, setSearching] = useState(false);
  const [searchPhase, setSearchPhase] = useState<SearchPhase>("");
  const [batchProgress, setBatchProgress] = useState<BatchProgress>({ n: 0, max: 0 });
  const stopRef = useRef(false);

  async function searchBatch(knownKeys: string[]): Promise<JobPosting[]> {
    const p = analysis?.profile || {};
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
      "Use web search to find 10 real, currently-open job postings in the United States that match this candidate. " +
      filters + exclude +
      "Candidate profile: " + JSON.stringify(p) + ". " +
      "For each posting, find the actual application/listing URL (LinkedIn, Indeed, or the company careers page). " +
      "After searching, respond with ONLY a JSON array (no markdown, no prose). Each item schema:\n" +
      '{"title":string,"company":string,"location":string,"remote":boolean,' +
      '"matchScore":number(0-100),"matchReasons":[string up to 3],' +
      '"visaSponsorship":"stated"|"likely"|"unknown","visaNote":string(which visa types this employer is known to sponsor, e.g. "H-1B & TN", or ""),' +
      '"salary":string(or ""),"postingUrl":string,"source":string}. ' +
      "Base matchScore on real overlap with the candidate's skills and seniority. Only include postings you actually found.";
    const opts: CallClaudeOptions = {
      content: instruction,
      system: "You are a diligent US job-search assistant. " + (hasWebSearch ? "Only return postings backed by real search results with working URLs." : "Return the best real postings you know of with real company career-page or LinkedIn URLs. Use your training data since live search is not available."),
      maxTokens: 4096,
      model: selectedModel,
    };
    if (hasWebSearch) opts.tools = [{ type: "web_search_20250305", name: "web_search" }];
    const text = await callClaude(opts);
    const arr = extractJson<any>(text);
    return Array.isArray(arr) ? arr : arr.jobs || [];
  }

  async function verifyBatch(cands: JobPosting[]): Promise<{ openOnes: JobPosting[]; unconfirmedOnes: JobPosting[]; hidden: number }> {
    // Without web search we can't verify live — pass all through as unverified
    if (!hasWebSearch) {
      return { openOnes: cands.map((j) => ({ ...j, status: "unverified" as const, checkedNote: "No live search on this model" })), unconfirmedOnes: [], hidden: 0 };
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
    let verified: any[] = [];
    try {
      const vtext = await callClaude({
        content: verifyInstruction,
        system: "You verify job postings against live web results. Never mark a posting open unless the search results support it.",
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        maxTokens: 4096,
        model: selectedModel,
      });
      const varr = extractJson<any>(vtext);
      verified = Array.isArray(varr) ? varr : varr.jobs || [];
    } catch (e) { verified = []; }
    const byKey: Record<string, any> = {};
    verified.forEach((v) => { byKey[jobKey(v)] = v; });
    const openOnes: JobPosting[] = [];
    const unconfirmedOnes: JobPosting[] = [];
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
  async function runBatches(targetCount: number, seed: JobPosting[]) {
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
      let cand: JobPosting[];
      try { cand = await searchBatch(acc.map(jobKey)); }
      catch (e: any) { setError(e.message); break; }
      if (stopRef.current) break;
      cand = (cand || []).filter((c) => !acc.some((a) => jobKey(a) === jobKey(c)));
      if (cand.length === 0) { emptyStreak++; if (emptyStreak >= 3) break; continue; }
      // Only positions with a POSITIVELY CONFIRMED working link get shown —
      // a job with no URL, a confirmed-dead one (404/410/5xx), or one we
      // simply couldn't confirm (blocked by the site's bot detection, a
      // timeout, or the check itself failing) are all dropped here. This is
      // deliberately strict: inconclusive is not the same as working, so it
      // no longer passes.
      cand = cand.filter((c) => c.postingUrl);
      if (cand.length === 0) { emptyStreak++; if (emptyStreak >= 3) break; continue; }
      try {
        const urlResults = await checkUrls(cand.map((c) => c.postingUrl));
        const goodUrls = new Set(urlResults.filter((r) => r.ok === true).map((r) => r.url));
        cand = cand.filter((c) => goodUrls.has(c.postingUrl));
      } catch (e) {
        cand = []; // couldn't even run the check — nothing here is confirmed, so nothing qualifies
      }
      if (cand.length === 0) { emptyStreak++; if (emptyStreak >= 3) break; continue; }
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
      if (acc.length === before) { emptyStreak++; if (emptyStreak >= 3) break; }
      else { emptyStreak = 0; acc.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0)); setJobs([...acc]); }
    }
    setJobs([...acc.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0))]);
    setSearching(false); setSearchPhase("");
  }

  function startSearch() {
    setJobs([]); setHiddenCount(0); uncRef.current = []; setUnconfirmedJobs([]); setShowUnconfirmed(false);
    runBatches(20, []);
  }
  function loadMore() { runBatches((jobs ? jobs.length : 0) + 20, jobs || []); }
  function stopSearch() { stopRef.current = true; }

  // Used when a different resume is loaded (by ID) — matches the original
  // app's exact reset scope, which deliberately does not clear
  // unconfirmedJobs (only a fresh startSearch() does that).
  function resetForNewResume() {
    setJobs(null);
    setHiddenCount(0);
  }

  return {
    visa, setVisa, remote, setRemote, location, setLocation,
    jobs, hiddenCount, unconfirmedJobs, showUnconfirmed, setShowUnconfirmed,
    searching, searchPhase, batchProgress,
    startSearch, loadMore, stopSearch, resetForNewResume,
  };
}
