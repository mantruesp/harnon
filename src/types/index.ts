export interface ModelInfo {
  id: string;
  label: string;
  free: boolean;
  webSearch: boolean;
  provider: "anthropic" | "groq" | "gemini";
}

export interface ResumeProfile {
  name: string;
  headline: string;
  targetTitles: string[];
  yearsExperience: number;
  seniority: string;
  topSkills: string[];
  industries: string[];
}

export interface ResumeImprovement {
  issue: string;
  fix: string;
}

export interface ResumeAnalysis {
  profile: ResumeProfile;
  score: number;
  summary: string;
  strengths: string[];
  improvements: ResumeImprovement[];
  atsKeywords: string[];
  resumeText?: string;
}

export interface ResumeRecord {
  id: string;
  createdAt: number;
  analysis: ResumeAnalysis;
  resumeText: string;
}

export type VisaStatus = "stated" | "likely" | "unknown";
export type JobStatus = "open" | "unconfirmed" | "unverified";

export interface JobPosting {
  title: string;
  company: string;
  location: string;
  remote: boolean;
  matchScore: number;
  matchReasons: string[];
  visaSponsorship: VisaStatus;
  visaNote: string;
  salary: string;
  postingUrl: string;
  source: string;
  status?: JobStatus;
  checkedNote?: string;
}

export interface ScreeningAnswer {
  q: string;
  a: string;
}

export interface ApplicationAutofill {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  website: string;
  currentTitle: string;
  yearsExperience: string;
  workAuthorization: string;
  requiresSponsorship: string;
  desiredSalary: string;
  availability: string;
  willRelocate: string;
  screeningAnswers: ScreeningAnswer[];
}

export interface ApplicationKit {
  tailoredSummary: string;
  coverLetter: string;
  emphasize: string[];
  autofill: ApplicationAutofill;
  prepNotes: string[];
}

export interface UrlCheckResult {
  url: string;
  ok: boolean | null;
  status: number | null;
  reason: string;
}

export interface UrlCheckResponse {
  results: UrlCheckResult[];
}

export interface BatchProgress {
  n: number;
  max: number;
}

export type SearchPhase = "" | "searching" | "verifying";

export interface ApplyState {
  status: "idle" | "working" | "done" | "error";
  msg: string;
}

export interface ResumePdf {
  name: string;
  data: string;
}
