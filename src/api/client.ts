import type { UrlCheckResult } from "../types";

// All model calls go through our own backend (/api/claude), which holds the
// provider API keys server-side. The browser never sees them.
const API = "/api/claude";

export type ClaudeContentBlock =
  | { type: "text"; text: string }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

export type ClaudeContent = string | ClaudeContentBlock[];

export interface ClaudeTool {
  type: string;
  name: string;
}

export interface CallClaudeOptions {
  system?: string;
  content: ClaudeContent;
  tools?: ClaudeTool[];
  maxTokens?: number;
  model: string;
}

// When a model hits its token limit mid-array, salvage whatever complete
// top-level elements came through instead of discarding the whole batch —
// e.g. 4 of 6 job listings is still useful, and previously a single truncated
// batch would throw and abort the entire multi-batch search loop.
export function salvageJsonArray(t: string): unknown[] | null {
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

export function extractJson<T = any>(raw: string): T {
  if (!raw) throw new Error("Claude returned an empty response.");
  const t = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/g, "").trim();
  try { return JSON.parse(t); } catch (e) { /* fall through */ }
  const oi = t.indexOf("{"), ai = t.indexOf("[");
  let start: number, close: string;
  if (ai !== -1 && (oi === -1 || ai < oi)) { start = ai; close = "]"; }
  else { start = oi; close = "}"; }
  if (start === -1) throw new Error("Couldn't find structured data in the response.");
  const end = t.lastIndexOf(close);
  if (end !== -1 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch (e) { /* fall through */ }
  }
  if (close === "]") {
    const salvaged = salvageJsonArray(t);
    if (salvaged && salvaged.length) return salvaged as T;
  }
  throw new Error("The response was cut off. Try again.");
}

export interface CallClaudeResult {
  text: string;
  // Real urls Claude's web_search tool actually returned, straight from the
  // API response — independent of anything the model claims in its final
  // text. Empty when no search happened (free models, or a search-capable
  // model that chose not to search this turn).
  groundedUrls: string[];
}

export async function callClaude({ system, content, tools, maxTokens = 4096, model }: CallClaudeOptions): Promise<CallClaudeResult> {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, content, tools, max_tokens: maxTokens, model }),
  });
  if (!res.ok) {
    let msg = "The request failed (" + res.status + "). Please try again.";
    try {
      const j = await res.json();
      if (j && j.error) msg = typeof j.error === "string" ? j.error : (j.error.message || msg);
    } catch (_) { /* ignore body-parse failure, keep default msg */ }
    throw new Error(msg);
  }
  const data = await res.json();
  const text = (data.content || [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("Claude didn't return any text. Please try again.");
  return { text, groundedUrls: Array.isArray(data.groundedUrls) ? data.groundedUrls : [] };
}

export function makeId(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous I/L/O/0/1
  let s = "";
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return "HRN-" + s;
}

// Real HTTP reachability check, run server-side (the browser can't fetch
// arbitrary third-party origins itself). Returns [] on any failure so
// callers can safely treat "no data" as "don't filter anything out".
export async function checkUrls(urls: string[]): Promise<UrlCheckResult[]> {
  const list = (urls || []).filter(Boolean);
  if (!list.length) return [];
  try {
    const res = await fetch("/api/check-urls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: list }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch (e) { return []; }
}
