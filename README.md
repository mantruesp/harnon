# Harnon

Résumé in, matches out, applications ready. Upload a resume, get improvement
feedback, search the live web for matching US roles (any work visa — H-1B, TN,
O-1, E-3, L-1, green card), verify each posting is still open, and generate
tailored application materials. An optional local helper can auto-fill forms in
a real Chromium.

## How it's put together

TypeScript + React Router. `npm run build` type-checks (`tsc --noEmit`) before
building.

```
harnon/
├── .github/workflows/deploy.yml   auto-deploy to Firebase on merge to main
├── index.html                     Vite entry
├── src/
│   ├── App.tsx                    routes: "/" and "/r/:id" (deep-link a saved resume)
│   ├── main.tsx
│   ├── index.css                  global stylesheet (design tokens + component styles)
│   ├── storage.ts                 saves resume summaries in localStorage by ID
│   ├── types/                     shared TypeScript interfaces
│   ├── api/client.ts              callClaude, extractJson, checkUrls, makeId
│   ├── hooks/                     useModels, useResume, useJobSearch, useApplicationKit, useLocalHelper
│   ├── components/                MatchRing, JobCard, VisaPill, Toggle, KitBlock, CopyRow, AutofillSheet
│   └── pages/HomePage.tsx         assembles the hooks + components into the full flow
├── functions/
│   └── index.js                   Cloud Function: multi-provider proxy + link-reachability check
├── firebase.json                  hosting + /api rewrites + SPA fallback
├── .firebaserc                    your Firebase project id goes here
└── harnon-autoapply/              optional local Chromium auto-fill helper
```

## Supported models

The app has a model selector in the header. Which models appear depends on which
API keys you configure:

| Provider | Key secret | Models | Free? | Live web search? |
|----------|-----------|--------|-------|-----------------|
| **Anthropic** | `ANTHROPIC_API_KEY` | Sonnet 5, Opus 4.8, Sonnet 4.6, Haiku 4.5 | No | ✅ Yes |
| **Groq** | `GROQ_API_KEY` | Llama 3.3 70B, Llama 3.1 8B, QwQ 32B, Gemma 2 9B | Yes (forever) | ❌ No |
| **Gemini** | `GEMINI_API_KEY` | Gemini 2.5 Flash | Yes (1500 req/day) | ❌ No |

**You only need one key.** If no Anthropic key is set, the backend auto-falls
back to Groq or Gemini. Free models handle resume analysis and application
materials well; the trade-off is that job listings come from training data
instead of live search and can't be verified as still open.

## Prerequisites

- [Node.js](https://nodejs.org) 20+
- Firebase CLI: `npm install -g firebase-tools`
- A Firebase project (create one at https://console.firebase.google.com)
- At least one API key (any of the three above). Free keys:
  - Groq: https://console.groq.com (no credit card)
  - Gemini: https://aistudio.google.com → Get API Key (no credit card)
  - Anthropic: https://console.anthropic.com (paid, but enables live search)
- If using Anthropic, enable **Web search** in the Console
  (Settings → the tool must be turned on, or job search calls will fail).
- Cloud Functions require the Firebase **Blaze** (pay-as-you-go) plan.

## One-time setup

```bash
# 1. Install dependencies
npm install
cd functions && npm install && cd ..

# 2. Point the project at your Firebase project
#    Edit .firebaserc and replace YOUR_FIREBASE_PROJECT_ID
#    (or run: firebase use --add)

# 3. Store your API key(s) as secrets — only set the ones you have
firebase functions:secrets:set ANTHROPIC_API_KEY    # paid, enables live search
firebase functions:secrets:set GROQ_API_KEY         # free, no credit card
firebase functions:secrets:set GEMINI_API_KEY        # free, no credit card
```

## Run locally

```bash
npm run build                 # produces dist/
firebase emulators:start      # serves the app + function with the /api rewrite
# open the hosting URL it prints (usually http://localhost:5050)
```

Prefer hot reload? In two terminals:

```bash
firebase emulators:start      # terminal 1 (functions + hosting)
npm run dev                   # terminal 2 — Vite proxies /api to the emulator
```

## Deploy manually

```bash
npm run deploy                # = npm run build && firebase deploy
```

## Auto-deploy via GitHub Actions

Every push/merge to `main` auto-deploys to Firebase. To enable this, add these
GitHub repo secrets (Settings → Secrets → Actions):

| Secret | What it is |
|--------|-----------|
| `FIREBASE_SERVICE_ACCOUNT` | JSON key for a Firebase service account (download from Firebase Console → Project Settings → Service Accounts → Generate New Private Key) |
| `FIREBASE_PROJECT_ID` | Your Firebase project ID (e.g. `harnon-12345`) |

Your Anthropic/Groq/Gemini keys stay in Firebase Secrets Manager — they do NOT
go in GitHub secrets. They're already there from the one-time setup step.

## Optional: auto-apply helper

`harnon-autoapply/` is a separate local program (Node + Playwright) that opens a
real Chromium and fills application forms from your profile. It runs on your
machine, not on Firebase. See `harnon-autoapply/README.md`. Once it's running,
an **Auto-apply** button appears in Harnon.

## Notes & limits

- Job results come from live web search (Claude models) or training data (free
  models) and are verified as still-open on a best-effort basis.
- No tool can truly submit applications for you — portals need your login.
  Harnon prepares everything; you click submit.
- Cloud Functions and the Anthropic API both bill per use. Free-tier providers
  have rate limits (see table above). Watch your usage.
