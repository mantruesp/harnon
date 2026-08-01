import { useRef, useState } from "react";
import { callClaude, checkUrls, extractJson } from "../api/client";
import type { CallClaudeOptions } from "../api/client";
import type { BatchProgress, JobPosting, ResumeAnalysis, SearchPhase, UrlCheckResult } from "../types";

function jobKey(j: Pick<JobPosting, "title" | "company">): string {
  return (j.title || "").toLowerCase().trim() + "|" + (j.company || "").toLowerCase().trim();
}

function normalizeUrl(u: string): string {
  return (u || "").trim().replace(/\/+$/, "");
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
    // Models default to "filling gaps helpfully" from training data unless
    // told plainly not to — this is the actual mechanism behind hallucinated
    // job details and URLs, not a rare failure. Spelled out as an explicit
    // extraction-vs-generation rule rather than left implicit.
    const groundingRule =
      "CRITICAL: you may only report a title, company, location, salary, or postingUrl that appears verbatim in your search tool results. " +
      "Do not infer, complete, or construct any of these from general knowledge or pattern-matching on what a listing 'usually' looks like. " +
      "If a detail isn't in the search results, omit it (empty string) rather than guessing. " +
      "Never modify, shorten, reformat, or reconstruct a URL — copy it exactly as it appeared in the search results, or leave postingUrl empty.";
    const opts: CallClaudeOptions = {
      content: instruction,
      system: "You are a diligent US job-search assistant. " +
        (hasWebSearch
          ? "Only return postings backed by real search results with working URLs. " + groundingRule
          : "Return the best real postings you know of with real company career-page or LinkedIn URLs. Use your training data since live search is not available."),
      maxTokens: 4096,
      model: selectedModel,
      // Deliberately NOT disabling thinking here, unlike the other two calls:
      // Anthropic documents that a thinking-disabled Sonnet 5 is less likely to
      // reach for tools or consider searching. This call's entire job is to
      // search, and a batch that quietly skips search produces ungrounded
      // results — the exact failure the grounding check exists to catch.
      // Effort is the safe lever instead.
      effort: "medium",
    };
    // max_uses matters a lot: without it Claude decides how many searches to
    // run, and production logs showed a single call doing 22 searches and
    // pulling 181 pages into context. At $10/1k searches plus the tokens for
    // all that content, an uncapped multi-batch run can cost dollars per
    // click. 5 is plenty to find 10 postings.
    if (hasWebSearch) opts.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }];
    const { text, groundedUrls } = await callClaude(opts);
    const arr = extractJson<any>(text);
    const jobs: JobPosting[] = Array.isArray(arr) ? arr : arr.jobs || [];
    if (!hasWebSearch) return jobs;
    // Belt and suspenders on top of the prompt rule above: cross-check every
    // claimed postingUrl against the REAL urls the search tool returned in
    // this response (not the model's retelling of them). A url that isn't
    // an exact match either got altered or was never grounded at all —
    // either way, it doesn't survive. This still runs even when
    // groundedUrls is empty (the model chose not to search this turn), in
    // which case every postingUrl correctly gets cleared, since none of
    // them are grounded in anything real.
    const grounded = new Set(groundedUrls.map(normalizeUrl));
    return jobs.map((j) => (j.postingUrl && !grounded.has(normalizeUrl(j.postingUrl)) ? { ...j, postingUrl: "" } : j));
  }

  // Sorts candidates using ONLY the cheap, deterministic HTTP link check.
  //
  // This replaces what used to be a second web-search LLM call per batch that
  // asked the model to judge whether each posting was "still open". That call
  // doubled the cost and latency of every batch while producing the weakest
  // signal in the pipeline (a model inferring open-ness from search snippets),
  // and it was strictly instructed never to guess "open" — so most real jobs
  // came back "unconfirmed" anyway. The HTTP check already proves the harder,
  // more useful fact: the link resolves to a live page.
  //
  // Honest about what each bucket means:
  //   ok:true  -> the posting URL loads (main list)
  //   ok:null  -> couldn't confirm; the site blocked the check (403/429) or
  //               timed out. NOT evidence the job is gone, so these are shown
  //               in the collapsible tier rather than discarded — this is what
  //               was wrongly dropping ZipRecruiter/Indeed/LinkedIn results.
  //   ok:false -> a real 404/410/5xx. Genuinely dead; dropped.
  function sortByLinkHealth(
    cands: JobPosting[],
    results: UrlCheckResult[],
  ): { openOnes: JobPosting[]; unconfirmedOnes: JobPosting[]; hidden: number } {
    const byUrl = new Map(results.map((r) => [r.url, r]));
    const openOnes: JobPosting[] = [];
    const unconfirmedOnes: JobPosting[] = [];
    let hidden = 0;
    cands.forEach((j) => {
      const r = byUrl.get(j.postingUrl);
      if (r && r.ok === true) {
        openOnes.push({ ...j, status: "open", checkedNote: "Link verified" });
      } else if (r && r.ok === false) {
        hidden++; // dead link (Boeing-404 case), or the page itself says the role is filled/closed
      } else {
        unconfirmedOnes.push({
          ...j,
          status: "unconfirmed",
          checkedNote: r?.status ? `Site blocked the link check (HTTP ${r.status})` : "Couldn't reach the link to check it",
        });
      }
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
    // Each batch is now ONE search call (was two), capped at 5 searches, so
    // a full run is bounded at roughly 6 calls / 30 searches instead of the
    // previous worst case of ~28 calls and several hundred searches.
    const MAX_BATCHES = 6;
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
      // A job with no usable URL can't be applied to, so it's still dropped.
      cand = cand.filter((c) => c.postingUrl);
      if (cand.length === 0) { emptyStreak++; if (emptyStreak >= 3) break; continue; }
      setSearchPhase("verifying");
      let urlResults: UrlCheckResult[] = [];
      try {
        urlResults = await checkUrls(cand.map((c) => c.postingUrl));
      } catch (e) { urlResults = []; }
      // Free models can't be link-checked meaningfully (no live search means
      // the URLs are training-data recall), so they keep the honest
      // "unverified" label rather than claiming a verified link.
      const { openOnes, unconfirmedOnes, hidden } = hasWebSearch
        ? sortByLinkHealth(cand, urlResults)
        : { openOnes: cand.map((j) => ({ ...j, status: "unverified" as const, checkedNote: "No live search on this model" })), unconfirmedOnes: [], hidden: 0 };
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
