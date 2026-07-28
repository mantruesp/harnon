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

// ──────────────────────── Anthropic call ────────────────────────

async function callAnthropic(key, { system, content, tools, max_tokens, model }) {
  const body = {
    model: model || "claude-sonnet-5",
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
  { secrets: ALL_SECRETS, cors: true },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }

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
  { secrets: ALL_SECRETS, timeoutSeconds: 300, memory: "512MiB", cors: true },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return; }

    try {
      const { system, content, tools, max_tokens, model } = req.body || {};
      if (!content) { res.status(400).json({ error: "Missing 'content'." }); return; }

      const tryKey = (secret) => { try { return secret.value(); } catch (_) { return ""; } };
      const prov = providerFor(model || "");

      let data;
      if (prov === "groq" && tryKey(GROQ_API_KEY)) {
        data = await callGroq(tryKey(GROQ_API_KEY), { system, content, max_tokens, model });
      } else if (prov === "gemini" && tryKey(GEMINI_API_KEY)) {
        data = await callGemini(tryKey(GEMINI_API_KEY), { system, content, max_tokens, model });
      } else if (tryKey(ANTHROPIC_API_KEY)) {
        // Default / Claude — also used when no specific model is set
        data = await callAnthropic(tryKey(ANTHROPIC_API_KEY), { system, content, tools, max_tokens, model: model || "claude-sonnet-5" });
      } else if (tryKey(GROQ_API_KEY)) {
        // Fallback: no Anthropic key, use Groq
        data = await callGroq(tryKey(GROQ_API_KEY), { system, content, max_tokens, model: "llama-3.3-70b-versatile" });
      } else if (tryKey(GEMINI_API_KEY)) {
        // Fallback: no Anthropic or Groq, use Gemini
        data = await callGemini(tryKey(GEMINI_API_KEY), { system, content, max_tokens, model: "gemini-2.5-flash" });
      } else {
        res.status(500).json({ error: "No API keys configured. Set at least one: ANTHROPIC_API_KEY, GROQ_API_KEY, or GEMINI_API_KEY." });
        return;
      }

      if (data.error) { res.status(502).json(data); return; }
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  }
);

// Keep the old export name so existing /api/claude rewrites still work
exports.claude = exports.llm;
