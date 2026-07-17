const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 8080);
const STATIC_DIR = __dirname;
const DEFAULT_STORAGE_DIR = path.join(__dirname, "storage");
const DATA_DIR = process.env.LEAD_DATA_DIR
  ? path.resolve(process.env.LEAD_DATA_DIR)
  : (fs.existsSync(DEFAULT_STORAGE_DIR) ? DEFAULT_STORAGE_DIR : __dirname);
const LEADS_FILE = path.join(DATA_DIR, "leads.json");
const FEED_TOKEN = String(process.env.LANDING_FEED_TOKEN || "").trim();
const FEED_TOKEN_HEADER = String(process.env.LANDING_FEED_TOKEN_HEADER || "Authorization").trim();

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(LEADS_FILE)) {
    fs.writeFileSync(LEADS_FILE, "[]", "utf8");
  }
}

function readLeads() {
  ensureStore();
  try {
    const raw = fs.readFileSync(LEADS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLeads(leads) {
  ensureStore();
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2), "utf8");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseAuthHeader(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.toLowerCase().startsWith("bearer ")) {
    return raw.slice(7).trim();
  }
  return raw;
}

function isFeedAuthorized(req) {
  if (!FEED_TOKEN) return true;
  const incoming = parseAuthHeader(req.get(FEED_TOKEN_HEADER));
  return incoming === FEED_TOKEN;
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(STATIC_DIR));

app.get("/", (_req, res) => {
  return res.sendFile(path.join(STATIC_DIR, "index.html"));
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, leads: readLeads().length });
});

app.get("/.well-known/freedomshare-leads.json", (_req, res) => {
  if (!isFeedAuthorized(_req)) {
    return res.status(401).json({ error: "Unauthorized landing feed request." });
  }

  const leads = readLeads();
  res.setHeader("Cache-Control", "no-store");
  res.json({
    leads,
    generatedAt: new Date().toISOString(),
    count: leads.length
  });
});

app.post("/api/qualify", (req, res) => {
  const input = req.body && typeof req.body === "object" ? req.body : {};
  const email = normalizeEmail(input.email);

  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Valid email is required." });
  }

  const leads = readLeads();
  if (leads.some((lead) => normalizeEmail(lead.email) === email)) {
    return res.status(200).json({
      ok: true,
      duplicate: true,
      message:
        "Based on your answers you may qualify for several exit solutions. This information is being sent to our top exit strategists and they will reach out to you. Thank you for your time."
    });
  }

  const lead = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    firstName: String(input.firstName || "").trim(),
    lastName: String(input.lastName || "").trim(),
    resortName: String(input.resortName || "").trim(),
    maintenanceFee: toNumber(input.maintenanceFee),
    mortgageBalance: toNumber(input.mortgageBalance),
    yearsOwned: toNumber(input.yearsOwned),
    exitReason: String(input.exitReason || "").trim(),
    spokeWithExitCompany: String(input.spokeWithExitCompany || "").trim(),
    state: String(input.state || "").trim(),
    phone: String(input.phone || "").trim(),
    email,
    contactWindow: String(input.contactWindow || "").trim(),
    chatbotQualified: true,
    optedIn: true,
    consentDate: new Date().toISOString(),
    source: "freedomshare_landing"
  };

  leads.push(lead);
  writeLeads(leads);

  return res.status(201).json({
    ok: true,
    message:
      "Based on your answers you may qualify for several exit solutions. This information is being sent to our top exit strategists and they will reach out to you. Thank you for your time.",
    leadId: lead.id
  });
});

app.listen(PORT, () => {
  console.log(`Landing page listening on http://localhost:${PORT}`);
  if (FEED_TOKEN) {
    console.log(`Landing feed token protection is enabled via header ${FEED_TOKEN_HEADER}.`);
  } else {
    console.log("Landing feed token protection is disabled. Set LANDING_FEED_TOKEN for production.");
  }
});
