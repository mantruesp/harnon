# Harnon auto-apply helper (local)

This small program lets Harnon open a **real Chromium** on your computer and auto-fill
job application forms from your saved profile. It runs only on your machine — a web
page can't do this on its own, which is why this piece lives locally.

## What it does

- Opens Chromium and navigates to the job's application page.
- Fills the fields it recognizes (name, email, phone, location, links, work
  authorization, sponsorship, salary, availability, relocation, etc.).
- Optionally attaches your resume file to upload fields.
- **Then it stops.** It does *not* click submit. You review everything, handle any
  login or CAPTCHA, and submit yourself.

## What it does NOT do

- It never solves CAPTCHAs or bypasses bot detection.
- It never submits an application on its own.
- Automating some job portals can violate their Terms of Service and may affect your
  own account. Use it on your own applications, at your discretion.

## Setup (one time)

You need [Node.js](https://nodejs.org) 18+ installed.

```bash
cd harnon-autoapply
npm install          # also downloads Chromium via Playwright
```

## Run it

```bash
npm start
```

To also attach your resume to file-upload fields, point to it:

```bash
# macOS / Linux
RESUME_PATH="/full/path/to/your_resume.pdf" npm start

# Windows (PowerShell)
$env:RESUME_PATH="C:\path\to\your_resume.pdf"; npm start
```

You should see: `Harnon auto-apply helper running at http://127.0.0.1:8787`.

## Use it

1. Keep this running in the terminal.
2. Open Harnon and prepare an application for a job.
3. The **⚡ Auto-apply in Chromium** button will appear in the application panel
   (Harnon detects the helper automatically).
4. Click it. Chromium opens and fills the form. Review, then submit yourself.

## Security notes

- The server binds to `127.0.0.1` only (not your network) and only responds to
  requests whose `Origin` is the known Harnon app origin — not just any page
  you happen to have open. If you run Harnon from a different origin (a custom
  domain, a different local port), add it to `ALLOWED_ORIGINS` in `server.js`.
- It still can't stop a malicious *local* program on your own machine from
  calling it directly — this only protects against other websites' pages
  reaching it through your browser.

## Troubleshooting

- **Button doesn't appear / "Couldn't reach the local helper":** make sure `npm start`
  is running, and that nothing else is using port 8787. Some browsers restrict calls
  from an `https://` page to `http://localhost`; if yours blocks it, try Chrome, or
  run Harnon from a local copy so it shares the same origin.
- **"Origin not allowed" error:** the page calling the helper isn't in
  `ALLOWED_ORIGINS` in `server.js` — add your dev/hosting origin there.
- **Few fields filled:** every portal names its fields differently. This uses
  best-effort matching, so complex multi-step forms (Workday especially) may only be
  partly filled — finish the rest by hand. You can extend the `map` in `server.js`.
