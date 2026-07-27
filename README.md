# Harnon

Résumé in, matches out, applications ready. Upload a resume, get improvement
feedback, search the live web for matching US roles (any work visa — H-1B, TN,
O-1, E-3, L-1, green card), verify each posting is still open, and generate
tailored application materials. An optional local helper can auto-fill forms in
a real Chromium.

## How it's put together

```
harnon/
├── index.html              Vite entry
├── src/
│   ├── App.jsx             the app (calls /api/claude, never holds a key)
│   ├── storage.js          saves resume summaries in localStorage by ID
│   ├── main.jsx
│   └── index.css
├── functions/
│   └── index.js            Cloud Function: proxies /api/claude → Anthropic
├── firebase.json           hosting + /api rewrite + SPA fallback
├── .firebaserc             your Firebase project id goes here
└── harbor-autoapply/       optional local Chromium auto-fill helper (runs on your machine)
```

**Why the backend function exists:** the app talks to Anthropic's API, which
needs a secret key and can't be called safely from a browser. The Cloud Function
holds the key server-side; the frontend only ever calls its own `/api/claude`.

## Prerequisites

- [Node.js](https://nodejs.org) 20+
- Firebase CLI: `npm install -g firebase-tools`
- A Firebase project (create one at https://console.firebase.google.com)
- An Anthropic API key from https://console.anthropic.com
- In the Anthropic Console, enable **Web search** for your organization
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

# 3. Store your Anthropic key as a secret (never commit it)
firebase functions:secrets:set ANTHROPIC_API_KEY
#    Paste your key when prompted.
```

The backend defaults to the `claude-sonnet-5` model. To change it, set
`CLAUDE_MODEL` in the function environment (or edit `functions/index.js`).

## Run locally

```bash
npm run build                 # produces dist/
firebase emulators:start      # serves the app + function with the /api rewrite
# open the hosting URL it prints (usually http://localhost:5000)
```

Prefer hot reload? In two terminals:

```bash
firebase emulators:start      # terminal 1 (functions + hosting)
npm run dev                   # terminal 2 — Vite proxies /api to the emulator
```

## Deploy

```bash
npm run deploy                # = npm run build && firebase deploy
```

This builds the site into `dist/`, deploys Hosting, and deploys the `claude`
function. Your app goes live at `https://YOUR_PROJECT_ID.web.app`.

## Optional: auto-apply helper

`harbor-autoapply/` is a separate local program (Node + Playwright) that opens a
real Chromium and fills application forms from your profile. It runs on your
machine, not on Firebase. See `harbor-autoapply/README.md`. Once it's running,
an **Auto-apply** button appears in Harnon.

> Note: some browsers block a call from an `https://` site to `http://localhost`.
> If the button never lights up while the helper is running, use Chrome or run
> Harnon locally (via the emulator) so it shares the machine's origin.

## Notes & limits

- Job results come from live web search and are verified as still-open on a
  best-effort basis; postings can close at any time, so reconfirm before applying.
- No tool can truly submit applications for you — portals need your login and
  block automation. Harnon prepares everything; you click submit.
- Cloud Functions and the Anthropic API both bill per use. Watch your usage.
