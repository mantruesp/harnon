// Resume persistence for the hosted app.
// Kept in the browser's localStorage so a saved summary stays private to this
// device — your resume (name, email, phone) is never sent to a shared database.
// If you later want cross-device access by ID, swap this for Firestore behind auth.

import type { ResumeAnalysis, ResumeRecord } from "./types";

const keyFor = (id: string) => "harnon:resume:" + id;

export function saveResume(id: string, analysis: ResumeAnalysis, resumeText: string): void {
  try {
    localStorage.setItem(keyFor(id), JSON.stringify({ id, createdAt: Date.now(), analysis, resumeText }));
  } catch (e) {
    // best-effort: private browsing or full storage shouldn't break the flow
  }
}

export function loadResumeRecord(id: string): ResumeRecord | null {
  try {
    const raw = localStorage.getItem(keyFor(id));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
