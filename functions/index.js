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

// Cheapest Anthropic model — $1/$5 per MTok vs Sonnet 5's $3/$15. Used for the
// mechanical extraction step, which doesn't need frontier reasoning. Only ever
// substituted for another Anthropic model: a user who picked Groq or Gemini
// keeps their provider.
const CHEAP_ANTHROPIC_MODEL = "claude-haiku-4-5";
const VALID_EFFORT = new Set(["low", "medium", "high", "xhigh", "max"]);

// ──────────────────────── Provider configs ────────────────────────

const PROVIDERS = {
  anthropic: {
    label: "Anthropic (Claude)",
    // adaptiveThinking / effort are per-model API capabilities, not preferences.
    // Haiku 4.5 predates both: `output_config.effort` returns a 400 there, and
    // it has no adaptive thinking (it also doesn't think unless asked, which is
    // why it's cheap by default). Sending either param to it breaks the request,
    // so every model that can be routed to must declare what it accepts.
    models: [
      { id: "claude-sonnet-5",  label: "Claude Sonnet 5",  free: false, webSearch: true,  adaptiveThinking: true,  effort: true },
      { id: "claude-opus-4-8",  label: "Claude Opus 4.8",  free: false, webSearch: true,  adaptiveThinking: true,  effort: true },
      { id: "claude-sonnet-4-6",label: "Claude Sonnet 4.6", free: false, webSearch: true, adaptiveThinking: true,  effort: true },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5",  free: false, webSearch: true, adaptiveThinking: false, effort: false },
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
  "http://127.0.0.1:5173",
  "http://localhost:5050",
  "http://127.0.0.1:5050",
]);

// Hard ceiling on web searches per request. Search bills per use on top of
// the tokens for every page it pulls into context, so this is the single
// most effective spend control in the app.
const MAX_SEARCH_USES = 5;

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

// ──────────────────────── Network retry ────────────────────────
// `fetch` to an external API can fail below the HTTP layer entirely --
// "SocketError: other side closed" / UND_ERR_SOCKET is Node's undici client
// reporting the connection was dropped before any response came back. This
// is a transient network condition (a blip, a stale pooled connection, a
// mid-flight reset), not an application error, and it's indistinguishable
// from a real outage on a single attempt. A short retry clears the common
// case; a real outage still surfaces as an error after retries are exhausted.
function isTransientNetworkError(e) {
  if (!e) return false;
  const code = e.code || e.cause?.code;
  if (code === "UND_ERR_SOCKET" || code === "ECONNRESET" || code === "ETIMEDOUT" || code === "EPIPE") return true;
  return /fetch failed/i.test(e.message || "");
}

// Turns an upstream provider error into a message that tells the operator
// what to actually do. Retryable/transient conditions keep the generic "try
// again"; conditions only a human can clear (billing, bad key) say so
// plainly, because "please try again" for an empty credit balance sends you
// hunting through application code for a problem that isn't there.
function describeProviderError(err) {
  const msg = String((err && (err.message || err.error?.message)) || "");
  const type = String((err && (err.type || err.error?.type)) || "");
  if (/credit balance|billing|insufficient.*(fund|quota)|purchase credits/i.test(msg)) {
    return "The Anthropic account is out of credits. Add credits in the Anthropic Console (Plans & Billing) — retrying won't help until then.";
  }
  if (/rate.?limit/i.test(msg) || type === "rate_limit_error") {
    return "Rate limited by the AI provider. Wait a moment and try again.";
  }
  if (/authentication|invalid.*api.?key|unauthorized/i.test(msg) || type === "authentication_error") {
    return "The AI provider rejected the API key. Check the key configured in Firebase Secrets.";
  }
  if (type === "overloaded_error" || /overloaded/i.test(msg)) {
    return "The AI provider is overloaded right now. Please try again shortly.";
  }
  return "The AI provider request failed. Please try again.";
}

async function fetchWithRetry(url, options, retries = 2, backoffMs = 400) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, options);
    } catch (e) {
      if (attempt >= retries || !isTransientNetworkError(e)) throw e;
      await new Promise((resolve) => setTimeout(resolve, backoffMs * (attempt + 1)));
    }
  }
}

// ──────────────────────── Anthropic call ────────────────────────

// Pulls the REAL urls Claude's web_search tool actually returned out of the
// response, independent of anything the model says in its final text. Per
// Anthropic's docs, a successful search produces a `web_search_tool_result`
// block with `content: [{ type: "web_search_result", url, title, ... }]`;
// a failed search has `content: { type: "web_search_tool_result_error" }`
// (an object, not an array) — skipped here rather than crashing on it.
// This is what lets the caller verify a claimed postingUrl was actually
// seen in search results, not invented or altered by the model afterward.
function extractGroundedUrls(content) {
  const urls = new Set();
  for (const block of content || []) {
    if (block && block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const item of block.content) {
        if (item && item.type === "web_search_result" && typeof item.url === "string") {
          urls.add(item.url);
        }
      }
    }
  }
  return Array.from(urls);
}

async function callAnthropic(key, { system, content, tools, max_tokens, model, thinking, effort }) {
  const body = {
    model: model || DEFAULT_MODEL,
    max_tokens: max_tokens || 4096,
    messages: [{ role: "user", content }],
  };
  if (system) body.system = system;
  if (tools)  body.tools  = tools;
  // Both are pre-validated against this model's capabilities by the caller —
  // never set either here without that check (see the llm handler).
  if (thinking) body.thinking = thinking;
  if (effort)   body.output_config = { effort };

  const r = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (Array.isArray(data.content)) {
    const groundedUrls = extractGroundedUrls(data.content);
    data.groundedUrls = groundedUrls;
    // One structured line per call, so "what does a search actually cost?" is a
    // log query instead of an estimate. thinking_tokens is the one worth
    // watching: it's billed as output and is invisible in the response body,
    // so it can only be seen here.
    const u = data.usage || {};
    console.log(JSON.stringify({
      evt: "llm_usage",
      model: model || DEFAULT_MODEL,
      effort: effort || "default",
      thinking: thinking?.type || "default",
      in: u.input_tokens ?? 0,
      out: u.output_tokens ?? 0,
      thinking_out: u.output_tokens_details?.thinking_tokens ?? 0,
      cache_read: u.cache_read_input_tokens ?? 0,
      cache_write: u.cache_creation_input_tokens ?? 0,
      searches: u.server_tool_use?.web_search_requests ?? 0,
      grounded_urls: groundedUrls.length,
    }));
  }
  return data;
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

  const r = await fetchWithRetry("https://api.groq.com/openai/v1/chat/completions", {
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

  const r = await fetchWithRetry(url, {
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
      let model = typeof body.model === "string" && body.model ? body.model : DEFAULT_MODEL;
      let prov = providerFor(model);
      if (!prov) { res.status(400).json({ error: "Unknown model." }); return; }

      // Per-task model routing. `tier: "cheap"` marks a call as mechanical
      // (structured extraction) rather than quality-critical, letting it run on
      // the cheapest model instead of whatever the user selected for the
      // headline work. Only ever swaps within Anthropic — switching a Groq or
      // Gemini user onto a paid model would be a surprise charge.
      if (body.tier === "cheap" && prov === "anthropic" && model !== CHEAP_ANTHROPIC_MODEL) {
        model = CHEAP_ANTHROPIC_MODEL;
        prov = providerFor(model);
      }

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
        if (info && info.webSearch && tools.every(isKnownSearchTool)) {
          // Rebuild the tool server-side rather than forwarding the client's
          // object. Search is billed per use ($10/1k) on top of the tokens for
          // every page pulled into context, so max_uses is a spend control and
          // can't be left to the caller — an uncapped call was observed doing
          // 22 searches and loading 181 pages.
          const requested = Number(tools[0].max_uses);
          const max_uses = Math.min(Number.isFinite(requested) && requested > 0 ? requested : MAX_SEARCH_USES, MAX_SEARCH_USES);
          safeTools = [{ type: "web_search_20250305", name: "web_search", max_uses }];
        }
      }

      // Thinking and effort are model-gated, and getting this wrong is a hard
      // 400 rather than a degraded response — `output_config.effort` is
      // rejected outright on Haiku 4.5, which has neither effort nor adaptive
      // thinking. Since the model can be swapped by the tier routing above,
      // capability is resolved against the FINAL model, and anything it can't
      // accept is dropped rather than forwarded. A caller asking for a param
      // the model lacks gets the model's default, never an error.
      const info = modelInfo(model);
      let thinking, effort;
      if (prov === "anthropic" && info) {
        // Sonnet 5 and later run adaptive thinking whenever `thinking` is
        // omitted, so "disabled" has to be sent explicitly to turn it off —
        // omitting the field is NOT the cheap path on these models.
        if (body.thinking === "disabled" && info.adaptiveThinking) {
          thinking = { type: "disabled" };
        } else if (body.thinking === "adaptive" && info.adaptiveThinking) {
          thinking = { type: "adaptive" };
        }
        if (typeof body.effort === "string" && VALID_EFFORT.has(body.effort) && info.effort) {
          effort = body.effort;
        }
      }

      const tryKey = (secret) => { try { return secret.value(); } catch (_) { return ""; } };

      let data;
      if (prov === "groq" && tryKey(GROQ_API_KEY)) {
        data = await callGroq(tryKey(GROQ_API_KEY), { system, content, max_tokens, model });
      } else if (prov === "gemini" && tryKey(GEMINI_API_KEY)) {
        data = await callGemini(tryKey(GEMINI_API_KEY), { system, content, max_tokens, model });
      } else if (prov === "anthropic" && tryKey(ANTHROPIC_API_KEY)) {
        data = await callAnthropic(tryKey(ANTHROPIC_API_KEY), { system, content, tools: safeTools, max_tokens, model, thinking, effort });
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
        const isEmulator = process.env.FUNCTIONS_EMULATOR === "true";
        res.status(502).json({
          // Most upstream detail stays hidden (it can leak internals), but
          // some failures are the operator's to fix and are actively
          // misleading when reported as "try again" — an exhausted credit
          // balance cost real debugging time being reported that way.
          error: describeProviderError(data.error),
          ...(isEmulator ? { debug: data.error } : {}),
        });
        return;
      }
      res.json(data);
    } catch (e) {
      console.error("Unhandled /api/llm error:", e);
      const isEmulator = process.env.FUNCTIONS_EMULATOR === "true";
      const message = isTransientNetworkError(e)
        ? "Network error reaching the AI provider (connection dropped). Please try again."
        : "Something went wrong processing that request. Please try again.";
      res.status(isTransientNetworkError(e) ? 502 : 500).json({
        error: message,
        ...(isEmulator ? { debug: String((e && e.stack) || e) } : {}),
      });
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
// browser can't fetch arbitrary third-party origins itself). The caller
// (runBatches) requires ok:true — a positively-confirmed reachable link —
// for a job to be shown at all; ok:false (confirmed dead) and ok:null
// (couldn't confirm either way) are both excluded.

const CHECK_URL_MAX = 20;
const CHECK_URL_TIMEOUT_MS = 10000;

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
  // A real visitor reaches a posting with a GET and browser-shaped headers —
  // matching that gives the most honest reachability signal. A bare HEAD
  // request or a self-identifying "LinkCheck" User-Agent is itself a bot
  // signal to some job-board WAFs, which would make the check LESS accurate
  // now that only a positive confirmation counts as a good match.
  const headers = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
  };
  try {
    const r = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal, headers });
    if (r.status === 404 || r.status === 410) return { url, ok: false, status: r.status, reason: "not-found" };
    if (r.status >= 500) return { url, ok: false, status: r.status, reason: "server-error" };
    // A job board blocking the request (401/403/429, or LinkedIn's custom
    // "automated traffic" status) isn't proof the posting is dead, just that
    // we couldn't confirm it — tracked distinctly from a confirmed-dead
    // link, even though both currently fail to qualify as a "good" match.
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
