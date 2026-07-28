# Harnon — Deep Project Analysis & Research

> Working document. Captures what this project *is*, how it's built, what works,
> what's broken or risky, and a prioritized backlog for continued development.
> Generated 2026-07-27 from a full read of the repo at commit `da85df5`.

---

## 0. Update — 2026-07-27: fixes applied this session

Owner decision on the biggest open question in §11: **keep the single shared
Anthropic key server-side** (no per-user BYOK, no login/accounts) and instead
lock down the open-relay problem directly. Everything below landed as code:

- **Proxy hardened** (`functions/index.js`): replaced the `cors:true` +
  `Access-Control-Allow-Origin: *` combo with an explicit origin allowlist, a
  best-effort per-IP rate limiter (40 req / 5 min per warm instance), and
  server-side validation/clamping of `model` (must be a known id), `tools`
  (only the exact web-search tool, only for models that support it), and
  `max_tokens` (hard-capped at 4096). Provider error bodies are no longer
  echoed to the client verbatim. See updated §5.1/§5.2 — the residual,
  explicitly-documented limitation is that Origin headers are spoofable by a
  non-browser client; real attestation would need Firebase App Check.
- **Local helper locked down** (`harnon-autoapply/server.js`): binds to
  `127.0.0.1` only (was open on all interfaces) and only answers requests from
  an allowlisted Origin (was `Access-Control-Allow-Origin: *`, letting any
  webpage the user had open drive their local Chromium). See §5.3.
- **Harbor → Harnon rename finished**: CSS class, `HRB-` → `HRN-` id prefix,
  footer/placeholder copy, and the local helper folder itself
  (`harbor-autoapply/` → `harnon-autoapply/`, including its `package.json`
  name and README). No more "Harbor" anywhere in the app. See former §7 B2.
- **`.github/workflows/deploy.yml` added**, matching what the README already
  documented (build, then `firebase deploy` authenticated via a service
  account key written from `FIREBASE_SERVICE_ACCOUNT`). See former §7 B1.
- **`.firebaserc` re-checked, not a bug**: `firebase projects:list` confirms
  the real project is genuinely named `harnor` (display name "Harnor"). The
  original B3 finding was a false positive — no change made.
- **"Load by ID" copy fixed** to say plainly that saved resumes live only in
  the current browser's storage and won't follow the user to another device,
  instead of implying a portable account system that doesn't exist. Real
  cross-device persistence (Firestore + auth) remains a possible future
  upgrade, intentionally not built now — see former §7 B4 and §11.
- **`extractJson` salvages truncated arrays**: if a search/verify batch hits
  the token limit mid-array, the app now recovers whatever complete job
  objects came through instead of throwing and aborting the entire multi-batch
  search loop. See former §7 B5.
- **Search cost/progress made visible**: the UI now shows "batch N of up to
  14" during a search and offers a **Stop** button in every searching state
  (previously the very first batch had no way to cancel early). See former §7
  B6.
- **Unconfirmed jobs are no longer silently discarded**: `verifyBatch` now
  distinguishes explicitly-`"closed"` postings (still dropped — they're
  confirmed dead) from `"unconfirmed"` ones (evidence just missing). The
  latter now surface in a collapsible "N unconfirmed matches" section instead
  of vanishing. See former §7 B9.
- **Lockfiles generated** in all three package roots (`npm install` run for
  root, `functions/`, `harnon-autoapply/`); build verified with `npm run
  build` and both Node entry points (`functions/index.js`,
  `harnon-autoapply/server.js`) verified to load/parse cleanly. See former §7
  B8.
- **Token-usage / cost reductions** (added mid-session per owner request,
  alongside "default to Sonnet"):
  - `resumeContent()` now prefers the already-extracted plain `resumeText`
    over resending the raw PDF. Previously every `prepareApplication` call
    (once per job a user opens) re-sent the *entire original PDF* even though
    the text had already been extracted once during resume analysis — the
    single biggest realistic token cost in the app for any PDF-uploading user
    who reviews multiple jobs.
  - `analyzeResume` only asks the model to transcribe the full resume text
    into its JSON response when that text isn't already known (i.e. only on
    first-time PDF uploads). Pasted-text users no longer pay output tokens to
    have their own resume echoed back, and `maxTokens` for that path dropped
    4096 → 2048 accordingly.
  - The "already-found roles" exclude list sent with every search batch was
    trimmed from the last 40 job keys to the last 15 — it's only a steering
    hint (the app still hard-dedupes every candidate against the full
    accumulator client-side), so the extra 25 no longer need to ride along on
    every one of up to 14 batches.
  - The frontend now explicitly prefers `claude-sonnet-5` as the default
    selected model (falling back to whatever `/api/models` returns first)
    rather than implicitly relying on array order; the backend's own default
    (used whenever no `model` is supplied) was already `claude-sonnet-5` and
    is unchanged.
  - Note for future work: `max_tokens` ceilings are a safety cap, not a cost
    lever — Anthropic bills for tokens actually generated, not the ceiling, so
    lowering them further would risk more truncation (see the salvage logic
    above) without reliably saving money. The real remaining lever is fewer
    batches/calls, which is what the new Stop button and batch-count display
    make visible to the user in §Update above.

Everything in the sections below is left as originally written for historical
context, except where explicitly annotated `[RESOLVED]`.

### 0.1 Follow-up fix — same day: broken/wrong "View posting" links

User-reported bug: clicking "View posting" often landed on a 404, a dead
link, or a generic job-search page instead of the specific listing. Root
cause: `searchBatch`'s prompt didn't forbid generic/fabricated URLs strongly
enough, and nothing in the pipeline ever actually checked that a `postingUrl`
resolved — the LLM-based verify step only judges plausibility from search
snippets, it never confirms the link itself works.

Fixed with three layers, applied in `runBatches` before a candidate ever
reaches the existing search-based verify step:
1. **Prompt tightened** (`searchBatch` in `App.jsx`): explicit good/bad URL
   examples, and an explicit instruction to leave `postingUrl` empty rather
   than fabricate one.
2. **`looksLikeBadPostingUrl()`** (client, no network): rejects missing/
   malformed URLs, bare domain or generic `/jobs`, `/careers`, `/search`-style
   paths, and the two most common "sent me to search instead of the listing"
   patterns — LinkedIn URLs without `/jobs/view/` and Indeed URLs without
   `/viewjob`.
3. **`exports.checkUrls`** (new Cloud Function, `functions/index.js`, wired up
   via `/api/check-urls` in `firebase.json`): a real server-side HEAD (falling
   back to GET) request per candidate URL, run from the backend because a
   browser can't fetch arbitrary third-party origins itself. Classifies each
   as `ok:true` (reachable), `ok:false` (404/410/5xx — genuinely dead, dropped
   immediately), or `ok:null` (blocked/timeout/network error — many job
   boards, LinkedIn especially, reject non-browser requests; this is treated
   as inconclusive, not broken, so real working links aren't penalized for
   being bot-protected). Includes a basic SSRF guard (`isPrivateHost`)
   refusing to fetch loopback/link-local/private-range hosts, since this
   endpoint fetches whatever URL a client sends it.

Verified end-to-end through the real Firebase Functions emulator (not just
unit logic): a live URL returned `{ok:true, status:200}` and a deliberately
broken path on the same domain returned `{ok:false, status:404}`.

**Known limitation:** the `ok:null` (inconclusive) bucket still relies on the
existing LLM-based verify step, which was the original, weaker mechanism —
so a hallucinated URL that happens to 403 rather than 404 (e.g. because it
points at a real domain but wrong path) could still slip through if the
model's search-based judgment is also fooled. This is a real reduction in the
failure rate, not a 100% guarantee.

### 0.2 Follow-up fix — same day: the 0.1 fix caused zero results

Immediately after 0.1 shipped, the user reported getting **no open positions
at all**. Root cause was a severity mismatch in how a bad link was handled:
`looksLikeBadPostingUrl("")` returned `true` (empty string is falsy → treated
as "bad"), and `runBatches` used that verdict to **filter the candidate out
of the batch entirely** — dropping the whole job, not just the link. Combined
with 0.1's own prompt change ("leave postingUrl empty rather than guess"),
models correctly complying with the new instruction by leaving the field
blank caused entire batches to be discarded, since nearly every candidate
now looked "bad" by that check.

Fixed by separating the two concerns that had been conflated: a missing or
untrustworthy URL disqualifies the **link**, not the **job**.
`looksLikeBadPostingUrl("")` now returns `false` (no URL isn't "bad", just
nothing to show), and both the heuristic check and the `checkUrls` HTTP check
now clear `postingUrl` to `""` on a bad verdict instead of removing the
candidate from `cand`. The job — title, company, match score, visa info —
still reaches the user; it just renders without a "View posting" button
(`JobCard` already showed the button conditionally, so this required no new
UI state, only a small explanatory line — `No confirmed link — search
"{company}" + "{title}" directly` — where the button used to be). This
restores the original recall while keeping 0.1's actual fix (no more
404s/wrong-link clicks) intact.

**Lesson for future prompt changes:** telling a model "don't fabricate, leave
X blank if unsure" is a real behavior change, not just documentation — code
that treats "blank" as a failure condition needs to be updated in the same
change, not after the fact.

### 0.3 Follow-up fix — same day: still too many "No confirmed link" jobs

After 0.2, users still saw "No confirmed link" on jobs that were themselves
confirmed open — a confusing combination (why would a verified-real, currently
open job have no link?). Root cause: `looksLikeBadPostingUrl`'s per-platform
pattern matching (requiring `/jobs/view/` on LinkedIn, `/viewjob` on Indeed,
rejecting bare `/jobs`/`/careers`/`/search` paths) was too strict for the
actual variety of URL shapes real job boards and company career sites use,
so it was clearing plenty of genuinely good links.

Fixed by trusting the model's URL by default: `looksLikeBadPostingUrl` now
only rejects a non-empty value that isn't a parseable http(s) URL, or is a
bare domain root with no path at all (e.g. `https://linkedin.com` alone,
which categorically cannot be a specific posting). All platform-specific path
matching was removed. The deterministic `checkUrls` HTTP check (§0.1) — which
only clears a link on an actual confirmed 404/410/5xx — remains the real
backstop against dead links; shape-guessing is no longer in the loop at all.
Also softened the search prompt: "prefer giving your best real link over
leaving it blank" replaced the earlier "leave empty if unsure" wording, which
was making the model default to blank more than necessary.

**Pattern across 0.1→0.3:** each fix corrected a real problem but overshot in
the strict direction, trading false negatives (hidden real links/jobs) for
the original false positives (dead links). The net design that stuck: verify
with real, objective signals (an HTTP 404 is a fact) and be permissive
everywhere guessing would otherwise be required.

### 0.4 Reverted entirely — same day, owner decision: no link validation at all

After 0.1–0.3, the owner made the product call directly rather than continuing
to tune the validation: **no URL heuristics, no reachability checks, no
disclaimer copy — just show whatever `postingUrl` the model returned, exactly
as the app did before this whole sub-thread started.** Reasoning given: the
"fancy" validation kept trading one failure mode for another (dead links vs.
missing jobs vs. missing links on real jobs), and the simplest version — show
the link if the model found one, don't second-guess it — is what was actually
wanted.

Fully reverted in this pass:
- Removed `looksLikeBadPostingUrl()` and the `checkUrls()` client helper from
  `App.jsx`, and their call sites in `runBatches`.
- Removed `exports.checkUrls`, `checkOneUrl`, `isPrivateHost`, and the
  `/api/check-urls` route entirely from `functions/index.js` and
  `firebase.json` — dead code, deleted rather than left disabled.
- Reverted `JobCard`'s conditional rendering back to a plain
  `{job.postingUrl && <a>...</a>}` — no "No confirmed link" message.
- Reverted the `searchBatch` prompt back to the original one-line instruction
  ("find the actual application/listing URL") and the plain
  `"postingUrl":string` schema field, dropping all the good/bad-example
  verbosity added across 0.1–0.3.

Net result: the production build after this revert is **byte-for-byte
identical** to the build from before 0.1 (`dist/assets/index-DNH_UTef.js`,
same size, same hash) — confirming this is a clean, complete revert of the
whole link-validation sub-thread, not a partial one.

**What this means going forward:** `postingUrl` is once again exactly as
reliable as the underlying model's search grounding, no more, no less. On
Claude models with `web_search` enabled this is generally solid because
`postingUrl` comes from real search results. On free models (Groq, Gemini —
no live search, see §"Supported models" in the README), `postingUrl` is a
recall guess from training data with no grounding at all, and will 404 or
misdirect meaningfully more often — that trade-off is inherent to using a
non-search model, not a bug, and is already documented in the README's
model-comparison table.

### 0.5 Re-added, redesigned: require a real link, verified by proof not guesswork

User supplied a concrete failing example —
`https://jobs.boeing.com/job/arlington/it-program-manager-enterprise-systems/185/68234521`
— confirmed via `curl` to return a genuine HTTP 404 from Boeing's own ATS.
The URL has the *correct shape* for Boeing's applicant-tracking system (which
is why it looked convincing) but the specific IDs don't correspond to a real
posting — a hallucination, not a stale listing. This is exactly the class of
failure 0.4's full revert reopened.

New design, explicitly requested: **only show positions with a real, working
link — verified by an actual HTTP request, never by guessing about URL
shape.** This intentionally does NOT resurrect `looksLikeBadPostingUrl()`
(0.1's pattern-matching approach) — that was the source of 0.2/0.3's false
positives, not the reachability check itself. This time:
- `exports.checkUrls` (Cloud Function, `/api/check-urls`) is back, unchanged
  from 0.1/0.2's implementation: real HEAD/GET request per URL, SSRF-guarded,
  classifies `ok:true` (reachable) / `ok:false` (confirmed 404/410/5xx) /
  `ok:null` (blocked/timeout — inconclusive, e.g. LinkedIn's bot detection).
- In `runBatches`, a candidate is now dropped entirely — not just stripped of
  its link — if it has no `postingUrl` at all, or if the check comes back
  `ok:false`. This is a deliberate behavior change from 0.2-0.4: a job
  without a confirmed-real link is no longer shown, full stop, per explicit
  request ("only show me positions with real links").
- `ok:null` (inconclusive) candidates are kept, not dropped — a job board
  blocking an automated HEAD request is not proof the link is dead, and
  treating it as such would gut recall for exactly the boards (LinkedIn,
  Indeed) most job postings come from.

Verified end-to-end via the Firebase emulator against the user's actual
reported URL: `{"url":".../68234521","ok":false,"status":404}` — confirmed
this exact posting would now be excluded.

**This does not depend on which model is used.** Whether or not the
generating model had web search, the reachability check is an independent,
model-agnostic fact-check — it fixes the free-model case (no grounding at
all, see the Oracle example earlier in this thread) exactly the same way it
fixes the Claude-with-search case (grounded, but can still hallucinate a
plausible-shaped dead URL, as Boeing shows).

### 0.6 Critical fix: origin-allowlist blocked the app's own requests

Found while smoke-testing an (unrelated, separately-branched) rewrite against
a real Firebase emulator: `/api/models` returned 403 even for the app's own
same-origin request. Root cause: `applyCors()`'s origin check
(`!!origin && ALLOWED_ORIGINS.has(origin)`, added in §0's proxy-hardening
pass) assumed a browser always sends an `Origin` header — but browsers do
**not** send one for genuinely same-origin requests. Confirmed empirically
via a `fetch('/api/models')` run from the actual page: the server received
`Origin: null`. Since this app always calls its own backend via relative
`/api/*` paths (same-origin, by construction), **every legitimate request
would have been rejected the moment a deploy actually succeeded** — this bug
had been sitting on `main` undetected only because every deploy attempt up to
this point had failed on unrelated IAM permission issues (§ deploy troubleshooting
in this session's chat history), so it never got a chance to break anything
for a real user.

Fixed in `applyCors()`: a missing `Origin` header is now treated as
legitimate (same-origin) traffic and allowed through; an `Origin` header that
IS present but doesn't match `ALLOWED_ORIGINS` is what gets rejected — that's
the case where it actually matters (another website's page trying to call
this API cross-origin through a visitor's browser). This preserves the
original intent (§0/§5.1) while fixing the same-origin case it broke.
Verified via direct `fetch()` calls from a running instance of the app,
before and after the fix, both for the previously-broken same-origin case and
for the intentionally-still-blocked cross-origin case.

---

## 1. What this project is

**Harnon** is a single-page web app that turns a résumé into job applications:

1. **Resume in** — upload a PDF/`.txt` or paste text.
2. **Review** — an LLM scores the résumé (0–100), extracts a structured profile
   (skills, seniority, target titles), and lists concrete improvements.
3. **Matches out** — the LLM uses **live web search** to find currently-open US
   roles that fit the candidate, filtered for **any work-visa sponsorship**
   (H-1B, TN, O-1, E-3, L-1, green card/PERM), then **verifies** each posting is
   still accepting applications.
4. **Applications ready** — for a chosen role it drafts a tailored summary,
   ~250-word cover letter, an autofill "sheet" (name/email/phone/work-auth/…),
   and ready-to-paste screening-question answers.
5. **Optional auto-apply** — a *separate local* Node + Playwright helper opens a
   real Chromium, navigates to the posting, and fills the fields it recognizes.
   It **never submits** and never solves CAPTCHAs.

The product's honest core promise: *"No tool can truly submit applications for
you — Harnon prepares everything; you click submit."*

### Naming note `[RESOLVED]`
~~The repo/product is called **Harnon** (package name, `<title>`, README H1),
but the source code, UI strings, CSS class `.harbor`, IDs (`HRB-…`), the local
helper folder (`harbor-autoapply`), and nearly every comment call it
**Harbor**.~~ Fixed in the 2026-07-27 pass (see §0): everything now says
Harnon, ids are `HRN-…`, and the helper folder is `harnon-autoapply/`.

---

## 2. Architecture at a glance

```
Browser (React SPA, Vite)
   │  POST /api/llm            (all model calls; key never in browser)
   │  GET  /api/models         (which providers are configured)
   ▼
Firebase Hosting  ──rewrites──►  Cloud Functions v2 (Node 20)
                                   ├─ exports.llm     multi-provider proxy
                                   ├─ exports.models  capability list
                                   └─ exports.claude = llm   (legacy alias)
                                        │
                                        ├─► Anthropic API  (web search, paid)
                                        ├─► Groq API       (free, OpenAI-shaped)
                                        └─► Gemini API     (free)

Local machine (optional, NOT on Firebase)
   harnon-autoapply/  Node http server :8787 (127.0.0.1 only)  ──►  Playwright Chromium
   Browser detects it via GET http://localhost:8787/ping
```

### Request flow, concretely
- **All AI work** goes through one function (`/api/llm`, historically
  `/api/claude`). The frontend always POSTs to `/api/claude`
  (`API = "/api/claude"` in `App.jsx`), which `firebase.json` rewrites to the
  `llm` function. `/api/llm` also exists as a rewrite but the client doesn't use
  it.
- The function **normalizes every provider to the Anthropic response shape**
  (`{ content: [{ type:"text", text }] }`) so the frontend is provider-agnostic.
- **Provider routing** is by model id: `providerFor(model)` looks the id up in the
  `PROVIDERS` table. If the model belongs to Groq/Gemini and that key exists, it
  routes there; otherwise it falls back to Anthropic → Groq → Gemini in that
  order (first configured key wins).
- **Web search** is Anthropic-only. The frontend sets
  `tools: [{ type: "web_search_20250305", name: "web_search" }]` *only when the
  selected model reports `webSearch: true`*. Free models skip search and
  verification entirely (jobs come from training data, flagged "Unverified").

### Key files
| File | Role |
|------|------|
| `src/App.jsx` | The entire app: 3-stage flow, model selector, batched search loop, verify loop, application-kit modal, autofill sheet, local-helper integration. ~870 lines, all in one component + 4 helpers. |
| `src/storage.js` | `saveResume` / `loadResumeRecord` — **localStorage only**, keyed `harnon:resume:<id>`. |
| `functions/index.js` | The multi-provider proxy + `/api/models`. |
| `harnon-autoapply/server.js` | Local `:8787` server; `/ping` + `/apply`; heuristic Playwright form filler. |
| `firebase.json` | Hosting `public: dist`, `/api/*` rewrites, SPA fallback, emulator ports (hosting 5000, functions 5001). |
| `vite.config.js` | Dev server :5173 proxies `/api` → `http://127.0.0.1:5000` (the hosting emulator). |
| `.firebaserc` | Firebase project aliases. **Default project = `harnor`** (looks like a typo of "harnon"). |

---

## 3. The search-and-verify engine (the interesting part)

Lives in `App.jsx` as `runBatches(targetCount, seed)`, driven by
`searchBatch` + `verifyBatch`. This is the app's most sophisticated logic.

**Loop mechanics:**
- Streams results in batches until `targetCount` (default **20**) confirmed-open
  jobs accumulate, or `MAX_BATCHES = 14`, or the user hits Stop (`stopRef`).
- Each iteration: `searchBatch` asks for **6** new postings, passing the last 40
  known job keys as an *exclude* list to avoid repeats
  (`jobKey = title|company`, lowercased).
- New candidates are de-duped against the accumulator, then `verifyBatch` runs a
  **second** web-search call to check each is still live. Only `status:"open"`
  survive; the rest increment `hiddenCount`.
- Results render **incrementally** (`setJobs([...acc])` mid-loop), sorted by
  `matchScore` desc. An `emptyStreak >= 2` guard breaks out when searches stop
  producing anything new.
- `loadMore()` continues from the existing list toward `+20` more.

**Cost implication (important):** each *batch* is **two** Anthropic calls (search
+ verify), each with `web_search` enabled and `max_tokens: 4096`. Up to 14
batches = **up to ~28 search-tool-enabled calls** for one "Find jobs" click.
Anthropic web search bills per search **on top of** tokens. This is the single
biggest cost driver and has no cap beyond `MAX_BATCHES`. See §6.

**JSON robustness:** `extractJson()` strips ``` fences, tries a raw parse, then
falls back to slicing from the first `{`/`[` to the last `}`/`]`. Reasonable
defense against chatty models, but still brittle for truncated output
(`max_tokens` hit mid-array → parse of a partial array).

---

## 4. Data & persistence model

- **Only storage is browser `localStorage`.** A résumé analysis + text is saved
  under a generated id like `HRN-K7M2P` (`makeId`, ambiguity-free alphabet).
- **This is device/browser-local.** The UI ("Enter this next time to skip the
  upload") and README imply a portable code, but **an ID saved on one device
  cannot be loaded on another** — nothing is server-side. `loadResumeRecord` is
  even `await`ed as if async/remote, but it's synchronous localStorage. This is a
  latent expectation gap, not a crash. `storage.js` itself flags the intended
  upgrade path: *"swap this for Firestore behind auth."*
- **No PII leaves the browser except to the LLM providers** — résumé bytes (incl.
  name/email/phone) are sent to Anthropic/Groq/Gemini as prompt content. That's
  inherent to the product but worth stating in a privacy note.

---

## 5. Security review (deployed surface)

This is the area needing the most attention before any public deployment.

### 5.1 The LLM proxy is an open, unauthenticated relay to a paid key `[RESOLVED — was HIGH]`
~~`exports.llm` has `cors: true` and sets `Access-Control-Allow-Origin: *`, with
no auth, no App Check, no rate limiting, no origin allowlist.~~ Fixed 2026-07-27
(see §0): the function now sets `cors: false` and manages CORS itself via an
explicit `ALLOWED_ORIGINS` allowlist (rejecting non-matching/missing Origin
with 403), plus a best-effort per-IP in-memory rate limiter (40 req / 5 min per
warm instance).

**Known residual limitation, by design:** this is an Origin-header check, which
a non-browser HTTP client can trivially spoof (`curl -H "Origin: https://..."`).
It stops casual/drive-by abuse from other websites' browsers and scanning bots,
but **not** a targeted attacker who already has the function URL. Real
attestation would require Firebase **App Check**, which was deliberately not
added — the owner chose "keep the shared key, lock down abuse" as the
simplest option over BYOK/per-user accounts (see §11), and App Check was
scoped out as the next increment beyond that if it's ever needed.

### 5.2 Client controls model + tools + token budget `[RESOLVED — was MEDIUM]`
~~The function trusted `model`, `tools`, and `max_tokens` straight from the
request body.~~ Fixed 2026-07-27: `model` must match a known id in `PROVIDERS`
(unknown models are rejected with 400), `tools` is only forwarded when it's
exactly the known web-search tool *and* the requested model actually supports
search, and `max_tokens` is clamped to a hard ceiling of 4096 regardless of
what the client asks for. Request `content`/`system` size is also capped
(8MB / 20K chars) to bound worst-case payload cost.

### 5.3 Local helper CORS + private-network `[RESOLVED — was MEDIUM]`
~~`harbor-autoapply/server.js` returned `Access-Control-Allow-Origin: *` **and**
`Access-Control-Allow-Private-Network: true` on `:8787`, so any website the
user visited could `POST /apply` and drive a Chromium on their machine.~~ Fixed
2026-07-27: the server now binds explicitly to `127.0.0.1` (was listening on
all interfaces) and only answers requests whose `Origin` header matches the
known Harnon app origins; everything else gets a 403.

**Residual limitation, by design (documented in the helper's own README):**
this only stops *other websites' pages* from reaching it through the user's
browser. It can't stop a malicious program already running locally on the same
machine from calling it directly — but at that point the user has a bigger
problem than this helper. A token-handshake scheme was considered and
deliberately skipped to keep the local tool's setup simple, consistent with
the "keep it simple" direction on §5.1.

### 5.4 Mixed content will block auto-apply in prod — MEDIUM (functional, still open)
The hosted app is `https://…web.app`; the helper is `http://localhost:8787`.
Browsers block `https → http` requests (mixed content / private-network access),
so the `/ping` detection and `/apply` call **will fail on the deployed site** in
Chrome by default. The README half-acknowledges this ("run Harnon from a local
copy so it shares the same origin"). Practically, auto-apply only works reliably
when the app is served over http locally. **Not addressed in the 2026-07-27
pass** — the helper's `ALLOWED_ORIGINS` now includes both the deployed
`https://harnor.web.app` origin and local dev origins (§5.3), which is
necessary for the fix but not sufficient: the browser's own mixed-content
policy is a separate, earlier blocker that origin allowlisting can't work
around. Still needs either clearer documentation or a same-origin dev mode.

### 5.5 Error passthrough — LOW
`/api/llm` returns upstream provider error objects verbatim (`res.json(data)` on
`data.error`). Provider error bodies can leak internal detail; sanitize before
returning.

### 5.6 No secret leakage in client — GOOD
API keys live only in Firebase Secrets Manager and are read via `defineSecret`;
the browser never sees them. `/api/models` only exposes *which* providers exist,
not the keys. This part is done right.

---

## 6. Cost, quotas & operational notes

- **Firebase Blaze plan required** (Cloud Functions v2). Idle cost ~$0, but the
  proxy is billable per invocation + compute (`timeoutSeconds: 300`,
  `memory: 512MiB`).
- **Anthropic** is the only paid provider and the only one with live search. A
  single job search can fan out to ~dozens of search-enabled calls (§3). **Add a
  server-side budget guard before opening this to real users.**
- **Free fallbacks:** Groq (free, generous), Gemini 2.5 Flash (free, ~1500
  req/day). With only a free key, the app still analyzes résumés and drafts
  materials; job lists come from training data and are labeled unverified.
- **Model IDs referenced** (in `functions/index.js` `PROVIDERS.anthropic`):
  `claude-sonnet-5`, `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5`.
  Confirm these exact ids are valid in the target Anthropic account/region before
  relying on them — a wrong id surfaces as a 4xx passed through to the UI.

---

## 7. Bugs, gaps & inconsistencies found

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| B1 | Med | **Missing CI workflow.** README documents auto-deploy via `.github/workflows/deploy.yml` and lists required GitHub secrets, but no `.github/` directory existed. | `[FIXED]` — workflow added 2026-07-27 |
| B2 | Med | **Half-finished rename Harbor→Harnon** (see §1). | `[FIXED]` — full rename done 2026-07-27 |
| B3 | Med | **`.firebaserc` default project is `harnor`** — looked like a typo. | `[NOT A BUG]` — `firebase projects:list` confirms the real project is genuinely named `harnor` |
| B4 | Med | **"Load by ID" implies cross-device but is localStorage-only** (§4). `loadResumeRecord` is `await`ed but synchronous (harmless, just misleading to read). | `[FIXED — copy only]` — UI now says explicitly this browser/device only; the underlying storage model itself is unchanged (see §11, this was a deliberate choice, not a defect) |
| B5 | Low | **`extractJson` on truncated output** discarded the whole batch. | `[FIXED]` — salvages complete elements from a truncated array (§0) |
| B6 | Low | **No cost/loop cap surfaced to user.** | `[FIXED]` — batch-count display + Stop button in every searching state (§0) |
| B7 | Low | **`react-dom/client` + StrictMode double-invokes effects in dev**, including the two `fetch`es (`/api/models`, localhost `/ping`). Harmless but doubles dev requests. | Open — cosmetic dev-only noise, not worth the churn to suppress |
| B8 | Low | **No dependencies installed / no lockfiles.** | `[FIXED]` — `npm install` run in all three roots, lockfiles committed, build verified (§0) |
| B9 | Low | **Verify step could hide real jobs** — anything not provably `"open"` was discarded. | `[FIXED]` — `"unconfirmed"` postings now shown in a collapsible tier; only explicitly `"closed"` postings are dropped (§0) |
| B10 | Info | **`/api/models` and `/api/llm` both `Allow-Origin: *`.** | `[FIXED]` — see §5.1 |

---

## 8. Tech stack & conventions

- **Frontend:** React 18 + Vite 5, plain JSX (no TypeScript), **no component
  library** — all styling is a single injected `<style>` string (`STYLE`) plus
  inline styles. Fonts (Inter / Space Grotesk / JetBrains Mono) loaded at runtime
  from Google Fonts. Design system is teal/`--primary:#0E7C7B` with a small token
  set (`:root` CSS vars). Accessible touches: `:focus-visible`, reduced-motion
  media query.
- **Backend:** `firebase-functions` v6, Node 20, CommonJS. Zero extra deps —
  raw `fetch` to each provider. No Anthropic/Groq SDKs.
- **Local helper:** Playwright 1.47, CommonJS, Node's built-in `http` (no
  Express). `postinstall` runs `playwright install chromium`.
- **No tests, no linter, no formatter, no types** anywhere in the repo.
- **State management:** all local `useState` in one big `App` component; no
  router (single page, stage-driven via `stage` 1/2/3), no context, no store.

---

## 9. How to run (verified against configs)

```bash
# install (three roots — lockfiles are now committed, so `npm ci` works too)
npm install
cd functions && npm install && cd ..
cd harnon-autoapply && npm install && cd ..   # optional, downloads Chromium

# configure
#  - edit .firebaserc → real Firebase project id (see B3)
firebase functions:secrets:set ANTHROPIC_API_KEY   # or GROQ_API_KEY / GEMINI_API_KEY

# run locally (emulator serves app + function with /api rewrite)
npm run build
firebase emulators:start          # hosting :5000, functions :5001

# hot-reload dev (two terminals)
firebase emulators:start          # terminal 1
npm run dev                       # terminal 2 → :5173, proxies /api → :5000

# optional auto-apply helper
cd harnon-autoapply && npm start  # :8787

# deploy
npm run deploy                    # build + firebase deploy
```

Note: `npm run dev` alone is **not** enough — `/api/*` 404s unless the emulator
(or deployed functions) is up, because Vite only *proxies* those paths.

---

## 10. Prioritized backlog / research directions

**P0 — before any public/shared deploy — `[DONE 2026-07-27]`**
1. ~~Lock down the proxy~~ — origin allowlist, per-IP rate limit, and
   server-side clamps on `model`/`tools`/`max_tokens` are in (§5.1/5.2).
   **Not done:** Firebase App Check (real attestation) and a hard per-session
   search-call budget — deliberately scoped out for now, see §5.1's residual
   limitation and §11.
2. ~~Fix `.firebaserc` project id~~ — turned out correct, not a bug (B3).
   Anthropic model ids in `functions/index.js` are unchanged from the original
   read; still worth confirming against the live account if calls start
   failing with model-not-found errors.

**P1 — correctness & honesty — `[DONE 2026-07-27]`**
3. ~~Finish the Harbor→Harnon rename~~ (B2).
4. ~~Add `.github/workflows/deploy.yml`~~ (B1).
5. **Persistence story (B4): decided, not upgraded.** Owner chose to keep
   storage device-local rather than add accounts/Firestore — copy fixed to
   say so plainly instead of implying portability. Revisit if cross-device
   "load by ID" becomes a real ask; `storage.js`'s own comment already names
   the Firestore-behind-auth upgrade path.

**P2 — product depth — `[DONE 2026-07-27]`**
6. ~~Cost/progress meter during search~~ — batch counter + Stop button now
   shown in every searching state (B6). **Not done:** a user-configurable
   target count (still hardcoded to 20) or a real spend estimate in dollars.
7. ~~Improve verify recall~~ — unconfirmed postings now shown in a collapsible
   tier instead of being discarded (B9).
8. **Auto-apply hardening — partially done.** Localhost binding + origin
   allowlist landed (§5.3). **Not done:** a token handshake (deliberately
   skipped, see §5.3's residual-limitation note) and the mixed-content
   same-origin dev mode (§5.4, still open). The field `map` (Workday et al.)
   is also still unextended.

**P3 — engineering hygiene**
9. ~~Add lockfiles~~ `[DONE 2026-07-27]` — generated and build-verified for
   all three package roots (B8).
10. Introduce **TypeScript** (or JSDoc types) for the LLM response/JSON
    schemas, and unit tests around `extractJson`/`salvageJsonArray`, `jobKey`
    de-dupe, and `runBatches` accumulation — the pure logic most likely to
    regress. **Still open.**
11. Split `App.jsx` (~900 lines) into components. **Partially done:** `JobCard`
    was extracted during the unconfirmed-tier work (§0); the stepper, resume
    step, and application-kit modal are still inline in the main component.
    **Still open.**

**P4 — new from the 2026-07-27 token-usage pass**
12. If Anthropic usage still feels high after these fixes, the next real lever
    is a user-configurable target job count and/or a lower default (currently
    hardcoded to 20 in `startSearch`) rather than further `max_tokens` tuning,
    which is a safety cap and not a cost lever (§0).
13. Prompt caching (`cache_control`) was considered for the repeated
    search/verify system prompts but **not implemented** — those prompts are
    well under Anthropic's minimum cacheable-prefix size, so caching them
    would have no effect. If future prompt text grows substantially (e.g. a
    longer few-shot system prompt), revisit.

---

## 11. Open questions — resolved 2026-07-27, plus what's still open

Resolved this session:
- **Public vs. personal tool / how to handle the Anthropic key:** owner was
  asked explicitly (three options: browser-only BYOK, full accounts + BYOK, or
  keep the shared key and lock down abuse) and chose **keep the shared key,
  just lock down abuse** — see §0/§5.1. No login system, no per-user keys.
- **Product name:** **Harnon**, confirmed and fully applied (§1, B2).
- **Real Firebase project id:** confirmed **`harnor`** via `firebase
  projects:list` — not a typo (B3).
- **Cross-device résumé portability:** owner implicitly deprioritized this by
  choosing the "keep it simple" path overall; storage stays device-local by
  design, copy fixed to say so (B4).

Still open / worth revisiting later:
- **Acceptable per-search Anthropic spend** — no hard dollar budget exists
  server-side yet; the new batch-count UI (§0) makes usage visible to the user
  but doesn't cap it. If real-world cost turns out to matter, a per-session or
  per-day call budget (likely needs Firestore for a durable counter, since the
  current rate limiter is in-memory and per-instance) is the natural next step.
- **Firebase App Check** — flagged as the "real" fix for §5.1's spoofable-origin
  limitation, not yet added. Worth it only if abuse actually shows up in
  practice; the origin allowlist + rate limit was judged sufficient for now.
- **User-configurable search target/count** — currently hardcoded to 20 in
  `startSearch()`; letting the user choose fewer/more would double as informal
  cost control.
```
