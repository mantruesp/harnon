import { useState } from "react";
import { callClaude, extractJson } from "../api/client";
import type { ClaudeContent } from "../api/client";
import type { ApplicationKit, ApplyState, JobPosting } from "../types";

export function useApplicationKit(
  resumeContent: (instruction: string) => ClaudeContent,
  resumeText: string,
  selectedModel: string,
  setError: (msg: string) => void,
) {
  const [activeJob, setActiveJob] = useState<JobPosting | null>(null);
  const [kit, setKit] = useState<ApplicationKit | null>(null);
  const [buildingKit, setBuildingKit] = useState(false);
  const [applyState, setApplyState] = useState<ApplyState>({ status: "idle", msg: "" });

  function closeKit() {
    setActiveJob(null);
    setKit(null);
  }

  async function prepareApplication(job: JobPosting) {
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
      setKit(extractJson<ApplicationKit>(text));
    } catch (e: any) { setError(e.message); setActiveJob(null); }
    setBuildingKit(false);
  }

  async function autoApplyLocal(job: JobPosting) {
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
    } catch (e: any) {
      setApplyState({ status: "error", msg: "Couldn't reach the local helper. Make sure it's running (node server.js). " + (e.message || "") });
    }
  }

  return { activeJob, kit, buildingKit, applyState, prepareApplication, autoApplyLocal, closeKit };
}
