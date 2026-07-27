# Harbor auto-apply helper (local)

This small program lets Harbor open a **real Chromium** on your computer and auto-fill
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
cd harbor-autoapply
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

You should see: `Harbor auto-apply helper running at http://localhost:8787`.

## Use it

1. Keep this running in the terminal.
2. Open Harbor and prepare an application for a job.
3. The **⚡ Auto-apply in Chromium** button will appear in the application panel
   (Harbor detects the helper automatically).
4. Click it. Chromium opens and fills the form. Review, then submit yourself.

## Troubleshooting

- **Button doesn't appear / "Couldn't reach the local helper":** make sure `npm start`
  is running, and that nothing else is using port 8787. Some browsers restrict calls
  from an `https://` page to `http://localhost`; if yours blocks it, try Chrome, or
  run Harbor from a local copy so it shares the same origin.
- **Few fields filled:** every portal names its fields differently. This uses
  best-effort matching, so complex multi-step forms (Workday especially) may only be
  partly filled — finish the rest by hand. You can extend the `map` in `server.js`.
