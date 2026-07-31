/*
  Harnon auto-apply helper (LOCAL ONLY)
  -------------------------------------
  Runs on your machine. Harnon (in the browser) pings this server; when it's up,
  an "Auto-apply in Chromium" button appears. Clicking it sends the job + your
  profile here, and this opens a REAL Chromium window, navigates to the posting,
  and fills the fields it can recognize.

  Safety by design:
   - It FILLS and then STOPS. It does NOT click submit. You review every field,
     handle any login/CAPTCHA, and submit yourself.
   - It never solves CAPTCHAs or bypasses bot checks.
   - Automating some job portals may violate their Terms of Service and could
     affect your own account. Use on your own applications, at your own discretion.

  Run:
    npm install
    npm start
  Optional: set a resume file to attach to file uploads:
    RESUME_PATH="/full/path/to/your_resume.pdf" npm start
*/

const http = require("http");
const { chromium } = require("playwright");

const PORT = 8787;
const HOST = "127.0.0.1"; // never bind beyond localhost — this drives a real browser
const RESUME_PATH = process.env.RESUME_PATH || "";

// Only the app itself (not just "any website you happen to have open") should
// be able to reach this and drive your Chromium. A wildcard origin here would
// let ANY page you visit silently POST /apply and open a browser on your
// machine. Add to this list only if you're running Harnon from another origin.
const ALLOWED_ORIGINS = new Set([
  "https://harnor.web.app",
  "https://harnor.firebaseapp.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5050",
  "http://127.0.0.1:5050",
]);

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  return !!origin && ALLOWED_ORIGINS.has(origin);
}

const server = http.createServer((req, res) => {
  const originOk = cors(req, res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (!originOk) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Origin not allowed." }));
    return;
  }

  if (req.method === "GET" && req.url === "/ping") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, app: "harnon-autoapply", version: 1 }));
    return;
  }

  if (req.method === "POST" && req.url === "/apply") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { job, profile } = JSON.parse(body || "{}");
        const result = await autoApply(job || {}, profile || {});
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "Not found" }));
});

server.listen(PORT, HOST, () => {
  console.log("Harnon auto-apply helper running at http://" + HOST + ":" + PORT);
  console.log(RESUME_PATH ? "Resume to attach: " + RESUME_PATH : "No RESUME_PATH set — file uploads will be skipped.");
  console.log("Leave this running, then use the Auto-apply button in Harnon.");
});

async function autoApply(job, profile) {
  if (!job.postingUrl) throw new Error("No posting URL was provided.");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(job.postingUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Some boards hide the form behind an "Apply" button — try to reveal it.
  for (const label of ["Apply now", "Apply", "Easy Apply", "I'm interested"]) {
    try {
      const btn = page.getByRole("button", { name: new RegExp(label, "i") }).first();
      if (await btn.isVisible({ timeout: 1000 })) { await btn.click({ timeout: 2000 }); break; }
    } catch (_) { /* keep going */ }
  }
  await page.waitForTimeout(1200);

  const filled = await fillFields(page, profile);

  if (RESUME_PATH) {
    try {
      const fileInputs = await page.$$('input[type="file"]');
      for (const fi of fileInputs) { try { await fi.setInputFiles(RESUME_PATH); } catch (_) {} }
    } catch (_) {}
  }

  // Intentionally DO NOT submit and DO NOT close the browser.
  return {
    ok: true,
    filled,
    notes: [
      "Filled " + filled + " field(s).",
      "Chromium is left open — review everything, handle any login/CAPTCHA, then submit yourself.",
    ],
  };
}

// Heuristic filler: matches each input to a profile value by its label/name/placeholder/aria text.
async function fillFields(page, profile) {
  const fname = (profile.fullName || "").split(" ")[0] || "";
  const lname = (profile.fullName || "").split(" ").slice(1).join(" ") || "";
  const map = [
    { keys: ["first name", "firstname", "given name"], value: fname },
    { keys: ["last name", "lastname", "surname", "family name"], value: lname },
    { keys: ["full name", "your name", "name"], value: profile.fullName },
    { keys: ["email", "e-mail"], value: profile.email },
    { keys: ["phone", "mobile", "telephone"], value: profile.phone },
    { keys: ["city", "location", "address"], value: profile.location },
    { keys: ["linkedin"], value: profile.linkedin },
    { keys: ["website", "portfolio", "github", "url"], value: profile.website },
    { keys: ["current title", "current role", "job title", "headline"], value: profile.currentTitle },
    { keys: ["years of experience", "years experience", "experience"], value: profile.yearsExperience },
    { keys: ["salary", "compensation", "desired", "expected"], value: profile.desiredSalary },
    { keys: ["authorized to work", "work authorization", "authorization"], value: profile.workAuthorization },
    { keys: ["sponsorship", "require sponsorship", "visa"], value: profile.requiresSponsorship },
    { keys: ["notice", "availability", "start date", "available"], value: profile.availability },
    { keys: ["relocate", "relocation", "willing to relocate"], value: profile.willRelocate },
  ];

  let count = 0;
  const inputs = await page.$$("input, textarea, select");
  for (const el of inputs) {
    try {
      const meta = await el.evaluate((node) => {
        const id = node.id;
        let label = "";
        if (id) {
          const l = document.querySelector('label[for="' + id + '"]');
          if (l) label = l.textContent || "";
        }
        if (!label && node.closest("label")) label = node.closest("label").textContent || "";
        return [
          node.getAttribute("name") || "",
          node.getAttribute("placeholder") || "",
          node.getAttribute("aria-label") || "",
          label,
        ].join(" ").toLowerCase();
      });
      if (!meta.trim()) continue;

      const tag = await el.evaluate((n) => n.tagName.toLowerCase());
      const inputType = await el.evaluate((n) => (n.getAttribute("type") || "").toLowerCase());
      if (["hidden", "submit", "button", "file", "password"].includes(inputType)) continue;

      for (const m of map) {
        if (!m.value) continue;
        if (m.keys.some((k) => meta.includes(k))) {
          try {
            if (tag === "select") {
              await el.selectOption({ label: String(m.value) }).catch(async () => {
                await el.selectOption(String(m.value)).catch(() => {});
              });
            } else {
              await el.fill(String(m.value));
            }
            count++;
          } catch (_) { /* skip this field */ }
          break;
        }
      }
    } catch (_) { /* skip problematic field */ }
  }
  return count;
}
