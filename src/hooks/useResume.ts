import { useRef, useState } from "react";
import { callClaude, extractJson, makeId } from "../api/client";
import type { ClaudeContent } from "../api/client";
import { loadResumeRecord, saveResume } from "../storage";
import type { ResumeAnalysis, ResumePdf } from "../types";

export function useResume(selectedModel: string, setError: (msg: string) => void) {
  const [resumeText, setResumeText] = useState("");
  const [resumePdf, setResumePdf] = useState<ResumePdf | null>(null);
  const [analysis, setAnalysis] = useState<ResumeAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const [savedId, setSavedId] = useState("");
  const [idInput, setIdInput] = useState("");
  const [loadingId, setLoadingId] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  const hasResume = !!resumePdf || resumeText.trim().length > 40;

  // Prefer the already-extracted plain text over resending the raw PDF —
  // once analyzeResume has extracted resumeText once, every later call
  // (e.g. one per "Prepare application" click) reuses the cheap text form
  // instead of re-sending the full PDF document each time.
  function resumeContent(instruction: string): ClaudeContent {
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

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
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
      const { text } = await callClaude({ content: resumeContent(instruction), maxTokens: needsTranscript ? 4096 : 2048, model: selectedModel });
      const parsed = extractJson<ResumeAnalysis>(text);
      const rt = resumeText.trim() ? resumeText : (parsed.resumeText || "");
      if (!resumeText.trim() && parsed.resumeText) setResumeText(parsed.resumeText);
      setAnalysis(parsed);
      const id = makeId();
      setSavedId(id);
      saveResume(id, parsed, rt);
    } catch (e: any) { setError(e.message); }
    setAnalyzing(false);
  }

  // Returns true on success so callers can orchestrate resetting other
  // (unrelated) parts of the app's state — e.g. clearing a previous job
  // search — without this hook needing to know about them.
  async function loadById(idOverride?: string): Promise<boolean> {
    const id = (idOverride ?? idInput).trim().toUpperCase();
    if (!id) return false;
    setError(""); setLoadingId(true);
    let ok = false;
    try {
      const rec = loadResumeRecord(id);
      if (!rec) throw new Error("No saved resume found for " + id + ". Double-check the code, or upload your resume to create a new one.");
      setAnalysis(rec.analysis);
      setResumeText(rec.resumeText || rec.analysis?.resumeText || "");
      setResumePdf(null);
      setSavedId(rec.id || id);
      ok = true;
    } catch (e: any) { setError(e.message); }
    setLoadingId(false);
    return ok;
  }

  return {
    resumeText, setResumeText, resumePdf, analysis, analyzing,
    savedId, idInput, setIdInput, loadingId, hasResume, fileRef,
    onFile, analyzeResume, loadById, resumeContent,
  };
}
