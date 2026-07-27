/*
  Backend proxy for Harnon.
  The browser calls /api/claude (same origin, rewritten to this function).
  This function adds the Anthropic API key server-side and forwards the request
  to the Messages API. The key is stored as a Firebase secret and never reaches
  the client.

  Set the model (optional) and the key:
    firebase functions:secrets:set ANTHROPIC_API_KEY
    # optional, defaults to claude-sonnet-5:
    # set CLAUDE_MODEL in functions runtime config or leave as-is
*/

const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

exports.claude = onRequest(
  { secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 300, memory: "512MiB", cors: true },
  async (req, res) => {
    // CORS (harmless for same-origin; useful for local `vite dev`)
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return; }

    try {
      const { system, content, tools, max_tokens } = req.body || {};
      if (!content) { res.status(400).json({ error: "Missing 'content' in request body." }); return; }

      const body = {
        model: MODEL,
        max_tokens: max_tokens || 4096,
        messages: [{ role: "user", content }],
      };
      if (system) body.system = system;
      if (tools) body.tools = tools;

      const r = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY.value(),
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });

      const data = await r.json();
      res.status(r.status).json(data);
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  }
);
