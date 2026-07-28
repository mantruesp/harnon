/*
  Harnon backend — multi-provider LLM proxy.

  Supports Anthropic Claude (paid, with web search), Groq (free tier),
  and Google Gemini (free tier). Keys are stored as Firebase secrets.
  The /api/models endpoint tells the frontend which providers are configured.
  The /api/llm endpoint routes to the right provider based on the model string.

  Set keys (only the ones you have — at least one is needed):
    firebase functions:secrets:set ANTHROPIC_API_KEY
    firebase functions:secrets:set GROQ_API_KEY
    firebase functions:secrets:set GEMINI_API_KEY
*/

const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const GROQ_API_KEY      = defineSecret("GROQ_API_KEY");
const GEMINI_API_KEY    = defineSecret("GEMINI_API_KEY");

const ALL_SECRETS = [ANTHROPIC_API_KEY, GROQ_API_KEY, GEMINI_API_KEY];

const DEFAULT_MODEL = "claude-sonnet-5";

// ──────────────────────── Provider configs ────────────────────────

const PROVIDERS = {
  anthropic: {
    label: "Anthropic (Claude)",
    models: [
      { id: "claude-sonnet-5",  label: "Claude Sonnet 5",  free: false, webSearch: true },
      { id: "claude-opus-4-8",  label: "Claude Opus 4.8",  free: false, webSearch: true },
      { id: "claude-sonnet-4-6",label: "Claude Sonnet 4.6", free: false, webSearch: true },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5",  free: false, webSearch: true },
    ],
  },
  groq: {
    label: "Groq (Free)",
    models: [
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B",   free: true, webSearch: false },
      { id: "llama-3.1-8b-instant",    label: "Llama 3.1 8B",    free: true, webSearch: false },
      { id: "qwen-qwq-32b",            label: "QwQ 32B",         free: true, webSearch: false },
      { id: "gemma2-9b-it",            label: "Gemma 2 9B",      free: true, webSearch: false },
    ],
  },
  gemini: {
    label: "Google Gemini (Free)",
    models: [
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash",  free: true, webSearch: false },
    ],
  },
};

function providerFor(modelId) {
  for (const [prov, cfg] of Object.entries(PROVIDERS)) {
    if (cfg.models.some((m) => m.id === modelId)) return prov;
  }
  return null;
}

function modelInfo(modelId) {
  for (const cfg of Object.values(PROVIDERS)) {
    const m = cfg.models.find((x) => x.id === modelId);
    if (m) return m;
  }
  return null;
}

// ──────────────────────── Abuse guards ────────────────────────
// Origin allowlist + a best-effort in-memory rate limiter. This deters casual
// scripted abuse and drive-by/browser-based hits against the shared Anthropic
// key. It is NOT a substitute for real attestation: a targeted attacker can
// spoof the Origin header with a direct HTTP client. If this app is ever
// opened up broadly, add Firebase App Check for real request attestation and
// consider per-user auth instead of a single shared key.

const ALLOWED_ORIGINS = new Set([
  "https://harnor.web.app",
  "https://harnor.firebaseapp.com",
  "http://localhost:5173",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
]);

const MAX_CONTENT_CHARS = 8_000_000; // generous ceiling: a multi-page PDF resume as base64 + prompt text
const MAX_SYSTEM_CHARS = 20_000;
const HARD_MAX_TOKENS = 4096;

// Best-effort per-instance limiter (Cloud Functions instances are ephemeral and
// can scale to N copies, so this bounds abuse per warm instance, not globally).
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX = 40;
const hitLog = new Map(); // ip -> [timestamps]

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.ip || "unknown";
}

function isRateLimited(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const recent = (hitLog.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  hitLog.set(ip, recent);
  if (hitLog.size > 5000) hitLog.clear(); // crude memory guard for a long-lived warm instance
  return recent.length > RATE_LIMIT_MAX;
}

// Applies CORS headers when the request's Origin is allowlisted. Returns
// whether the request should proceed.
function applyCors(req, res) {
  // Same-origin requests — which is what this app always makes, calling its
  // own /api/* via a relative path — do NOT carry an Origin header at all;
  // browsers only send one for genuinely cross-origin requests. So a missing
  // Origin is not suspicious (it's the normal, legitimate case here, along
  // with non-browser tools, which the rate limiter below guards against
  // instead). An Origin header that IS present but not on the allowlist
  // means some other website's page is trying to call this API through a
  // visitor's browser — that's the case this actually needs to reject.
  const origin = req.headers.origin;
  if (origin) {
    if (!ALLOWED_ORIGINS.has(origin)) return false;
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  return true;
}

// ──────────────────────── Anthropic call ────────────────────────

async function callAnthropic(key, { system, content, tools, max_tokens, model }) {
  const body = {
    model: model || DEFAULT_MODEL,
    max_tokens: max_tokens || 4096,
    messages: [{ role: "user", content }],
  };
  if (system) body.system = system;
  if (tools)  body.tools  = tools;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  return r.json();
}

// ──────────────────────── Groq call (OpenAI-compatible) ────────────────────────

async function callGroq(key, { system, content, max_tokens, model }) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  // content can be a string or array of blocks; Groq needs a string
  const userText = typeof content === "string"
    ? content
    : content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  messages.push({ role: "user", content: userText });

  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + key },
    body: JSON.stringify({ model: model || "llama-3.3-70b-versatile", max_tokens: max_tokens || 4096, messages }),
  });
  const data = await r.json();
  // Normalise to Anthropic-shaped response so the frontend doesn't care
  if (data.choices && data.choices[0]) {
    return { content: [{ type: "text", text: data.choices[0].message.content }] };
  }
  return { content: [], error: data.error || "Unknown Groq error" };
}

// ──────────────────────── Gemini call ────────────────────────

async function callGemini(key, { system, content, max_tokens, model }) {
  const mdl = model || "gemini-2.5-flash";
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + mdl + ":generateContent?key=" + key;

  const userText = typeof content === "string"
    ? content
    : content.filter((b) => b.type === "text").map((b) => b.text).join("\n");

  const body = { contents: [{ parts: [{ text: userText }] }] };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (max_tokens) body.generationConfig = { maxOutputTokens: max_tokens };

  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  // Normalise
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  if (text) return { content: [{ type: "text", text }] };
  return { content: [], error: data.error || "Unknown Gemini error" };
}

// ──────────────────────── /api/models ────────────────────────

exports.models = onRequest(
  { secrets: ALL_SECRETS, cors: false },
  async (req, res) => {
    const allowed = applyCors(req, res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (!allowed) { res.status(403).json({ error: "Origin not allowed." }); return; }
    if (isRateLimited(req)) { res.status(429).json({ error: "Too many requests. Try again shortly." }); return; }

    const available = [];
    const tryKey = (secret) => { try { return secret.value(); } catch (_) { return ""; } };

    if (tryKey(ANTHROPIC_API_KEY)) {
      PROVIDERS.anthropic.models.forEach((m) => available.push({ ...m, provider: "anthropic" }));
    }
    if (tryKey(GROQ_API_KEY)) {
      PROVIDERS.groq.models.forEach((m) => available.push({ ...m, provider: "groq" }));
    }
    if (tryKey(GEMINI_API_KEY)) {
      PROVIDERS.gemini.models.forEach((m) => available.push({ ...m, provider: "gemini" }));
    }
    res.json({ models: available });
  }
);

// ──────────────────────── /api/llm (main proxy) ────────────────────────

exports.llm = onRequest(
  { secrets: ALL_SECRETS, timeoutSeconds: 300, memory: "512MiB", cors: false },
  async (req, res) => {
    const allowed = applyCors(req, res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (!allowed) { res.status(403).json({ error: "Origin not allowed." }); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return; }
    if (isRateLimited(req)) { res.status(429).json({ error: "Too many requests. Please slow down and try again shortly." }); return; }

    try {
      const body = req.body || {};
      const { system, content, tools } = body;
      if (!content) { res.status(400).json({ error: "Missing 'content'." }); return; }

      // Validate/clamp everything the client controls before it reaches a
      // paid provider — the client should never be able to pick an unknown
      // model, force on web search, or request an unbounded token budget.
      const model = typeof body.model === "string" && body.model ? body.model : DEFAULT_MODEL;
      const prov = providerFor(model);
      if (!prov) { res.status(400).json({ error: "Unknown model." }); return; }

      const contentSize = JSON.stringify(content).length;
      if (contentSize > MAX_CONTENT_CHARS) { res.status(413).json({ error: "Request too large." }); return; }
      if (system && String(system).length > MAX_SYSTEM_CHARS) { res.status(413).json({ error: "System prompt too large." }); return; }

      const max_tokens = Math.min(Number(body.max_tokens) || 4096, HARD_MAX_TOKENS);

      // Only forward the exact known web_search tool, and only for models
      // that actually support it — the client's `tools` value is a request,
      // not a grant.
      let safeTools;
      if (Array.isArray(tools) && tools.length) {
        const info = modelInfo(model);
        const isKnownSearchTool = (t) => t && t.type === "web_search_20250305" && t.name === "web_search";
        if (info && info.webSearch && tools.every(isKnownSearchTool)) safeTools = tools;
      }

      const tryKey = (secret) => { try { return secret.value(); } catch (_) { return ""; } };

      let data;
      if (prov === "groq" && tryKey(GROQ_API_KEY)) {
        data = await callGroq(tryKey(GROQ_API_KEY), { system, content, max_tokens, model });
      } else if (prov === "gemini" && tryKey(GEMINI_API_KEY)) {
        data = await callGemini(tryKey(GEMINI_API_KEY), { system, content, max_tokens, model });
      } else if (prov === "anthropic" && tryKey(ANTHROPIC_API_KEY)) {
        data = await callAnthropic(tryKey(ANTHROPIC_API_KEY), { system, content, tools: safeTools, max_tokens, model });
      } else if (tryKey(ANTHROPIC_API_KEY)) {
        // Requested provider's key isn't configured — fall back to Anthropic.
        data = await callAnthropic(tryKey(ANTHROPIC_API_KEY), { system, content, tools: safeTools, max_tokens, model: DEFAULT_MODEL });
      } else if (tryKey(GROQ_API_KEY)) {
        data = await callGroq(tryKey(GROQ_API_KEY), { system, content, max_tokens, model: "llama-3.3-70b-versatile" });
      } else if (tryKey(GEMINI_API_KEY)) {
        data = await callGemini(tryKey(GEMINI_API_KEY), { system, content, max_tokens, model: "gemini-2.5-flash" });
      } else {
        res.status(500).json({ error: "No API keys configured. Set at least one: ANTHROPIC_API_KEY, GROQ_API_KEY, or GEMINI_API_KEY." });
        return;
      }

      if (data.error) {
        console.error("Provider error for model " + model + ":", JSON.stringify(data.error));
        res.status(502).json({ error: "The AI provider request failed. Please try again." });
        return;
      }
      res.json(data);
    } catch (e) {
      console.error("Unhandled /api/llm error:", e);
      res.status(500).json({ error: "Something went wrong processing that request. Please try again." });
    }
  }
);

// Keep the old export name so existing /api/claude rewrites still work
exports.claude = exports.llm;

// ──────────────────────── /api/check-urls ────────────────────────
// A model — search-grounded or not — can still hand back a job-board URL
// with the right shape (real domain, plausible-looking ID) that simply
// doesn't exist, e.g. https://jobs.boeing.com/job/.../68234521 returning a
// genuine 404. Guessing about URL shape doesn't catch that; only actually
// requesting the URL does. This does a real HTTP check server-side (the
// browser can't fetch arbitrary third-party origins itself) so a confirmed
// 404/410/5xx can be excluded before it ever reaches the user.

const CHECK_URL_MAX = 20;
const CHECK_URL_TIMEOUT_MS = 8000;

// Basic SSRF guard: this endpoint fetches whatever URL a client sends, so
// refuse anything that resolves to loopback/link-local/private ranges rather
// than letting it be used to probe internal infrastructure (e.g. the cloud
// metadata server at 169.254.169.254). The response never includes body
// content, only ok/status/reason, which limits — but doesn't eliminate —
// what such a probe could learn.
function isPrivateHost(hostname) {
  const h = (hostname || "").toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  return false;
}

async function checkOneUrl(url) {
  if (typeof url !== "string" || !url) return { url, ok: false, status: null, reason: "missing" };
  let u;
  try { u = new URL(url); } catch (e) { return { url, ok: false, status: null, reason: "malformed" }; }
  if (!/^https?:$/.test(u.protocol)) return { url, ok: false, status: null, reason: "bad-protocol" };
  if (isPrivateHost(u.hostname)) return { url, ok: null, status: null, reason: "blocked-host" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_URL_TIMEOUT_MS);
  const headers = { "user-agent": "Mozilla/5.0 (compatible; HarnonLinkCheck/1.0)" };
  try {
    let r = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal, headers });
    if (r.status === 405 || r.status === 501) {
      r = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal, headers });
    }
    if (r.status === 404 || r.status === 410) return { url, ok: false, status: r.status, reason: "not-found" };
    if (r.status >= 500) return { url, ok: false, status: r.status, reason: "server-error" };
    // Many job boards (LinkedIn especially) block non-browser requests with
    // 401/403/429 or a custom "automated traffic" status — that's not proof
    // the posting is dead, just that we can't check it. Treat as inconclusive
    // rather than penalizing real, working links.
    if ([401, 403, 429, 999].includes(r.status)) return { url, ok: null, status: r.status, reason: "blocked" };
    if (r.status >= 200 && r.status < 400) return { url, ok: true, status: r.status, reason: "" };
    return { url, ok: null, status: r.status, reason: "unknown" };
  } catch (e) {
    return { url, ok: null, status: null, reason: "network-error" };
  } finally {
    clearTimeout(timeout);
  }
}

exports.checkUrls = onRequest(
  { cors: false, timeoutSeconds: 30, memory: "256MiB" },
  async (req, res) => {
    const allowed = applyCors(req, res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (!allowed) { res.status(403).json({ error: "Origin not allowed." }); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return; }
    if (isRateLimited(req)) { res.status(429).json({ error: "Too many requests." }); return; }

    const body = req.body || {};
    const urls = Array.isArray(body.urls) ? body.urls.slice(0, CHECK_URL_MAX) : [];
    const results = await Promise.all(urls.map(checkOneUrl));
    res.json({ results });
  }
);
