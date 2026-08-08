const express = require("express");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.LEAD_DATA_DIR
  ? path.resolve(process.env.LEAD_DATA_DIR)
  : path.join(__dirname, "storage");
const LEADS_FILE = path.join(DATA_DIR, "leads.json");
const TRAFFIC_FILE = path.join(DATA_DIR, "traffic.json");
const FEED_TOKEN = String(process.env.LANDING_FEED_TOKEN || "").trim();
const FEED_TOKEN_HEADER = String(process.env.LANDING_FEED_TOKEN_HEADER || "Authorization").trim();

function defaultTraffic() {
  return {
    pageHits: 0,
    formStarts: 0,
    formSubmits: 0,
    uniqueVisitors: 0,
    uniqueVisitorKeys: {},
    lastPageHitAt: "",
    lastFormStartAt: "",
    lastFormSubmitAt: "",
    updatedAt: "",
  };
}

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(LEADS_FILE)) {
    fs.writeFileSync(LEADS_FILE, "[]", "utf8");
  }

  if (!fs.existsSync(TRAFFIC_FILE)) {
    fs.writeFileSync(TRAFFIC_FILE, JSON.stringify(defaultTraffic(), null, 2), "utf8");
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

function readTraffic() {
  ensureStore();
  try {
    const raw = fs.readFileSync(TRAFFIC_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ...defaultTraffic(),
      ...(parsed && typeof parsed === "object" ? parsed : {}),
    };
  } catch {
    return defaultTraffic();
  }
}

function writeTraffic(traffic) {
  ensureStore();
  fs.writeFileSync(TRAFFIC_FILE, JSON.stringify(traffic, null, 2), "utf8");
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getClientIp(req) {
  const xff = String(req.get("x-forwarded-for") || "").trim();
  if (xff) {
    return xff.split(",")[0].trim();
  }
  return String(req.ip || req.socket?.remoteAddress || "unknown").trim();
}

function visitorKeyFor(req) {
  const ip = getClientIp(req);
  const ua = String(req.get("user-agent") || "unknown").slice(0, 160);
  return `${todayKey()}|${ip}|${ua}`;
}

function trackTrafficEvent(eventName, req) {
  const traffic = readTraffic();
  const now = new Date().toISOString();

  if (eventName === "pageHit") {
    traffic.pageHits += 1;
    traffic.lastPageHitAt = now;

    const key = visitorKeyFor(req);
    if (!traffic.uniqueVisitorKeys[key]) {
      traffic.uniqueVisitorKeys[key] = now;
      traffic.uniqueVisitors += 1;
    }
  }

  if (eventName === "formStart") {
    traffic.formStarts += 1;
    traffic.lastFormStartAt = now;
  }

  if (eventName === "formSubmit") {
    traffic.formSubmits += 1;
    traffic.lastFormSubmitAt = now;
  }

  traffic.updatedAt = now;
  writeTraffic(traffic);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function asTrimmed(value) {
  return String(value || "").trim();
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
app.use(express.static(path.join(__dirname, "public")));

// Serve landing assets and homepage from repository root.
app.use(express.static(__dirname, { index: false }));

app.get("/", (_req, res) => {
  trackTrafficEvent("pageHit", _req);
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, leads: readLeads().length });
});

app.get("/api/traffic", (_req, res) => {
  if (!isFeedAuthorized(_req)) {
    return res.status(401).json({ error: "Unauthorized traffic request." });
  }

  const traffic = readTraffic();
  const { uniqueVisitorKeys, ...summary } = traffic;
  res.setHeader("Cache-Control", "no-store");
  return res.json(summary);
});

app.get("/api/traffic/public", (_req, res) => {
  const traffic = readTraffic();
  const { uniqueVisitorKeys, ...summary } = traffic;
  res.setHeader("Cache-Control", "no-store");
  return res.json(summary);
});

app.post("/api/traffic/form-start", (_req, res) => {
  trackTrafficEvent("formStart", _req);
  return res.status(204).send();
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

  const requiredTextFields = [
    ["firstName", "First name"],
    ["lastName", "Last name"],
    ["resortName", "Resort name"],
    ["exitReason", "Exit reason"],
    ["spokeWithExitCompany", "Spoken with exit company"],
    ["state", "State"],
    ["phone", "Phone"],
    ["contactWindow", "Contact window"],
  ];

  for (const [key, label] of requiredTextFields) {
    if (!asTrimmed(input[key])) {
      return res.status(400).json({ error: `${label} is required.` });
    }
  }

  const requiredNumericFields = [
    ["maintenanceFee", "Maintenance fee"],
    ["mortgageBalance", "Mortgage balance"],
    ["yearsOwned", "Years owned"],
  ];

  for (const [key, label] of requiredNumericFields) {
    const n = toNumber(input[key]);
    if (n === null) {
      return res.status(400).json({ error: `${label} is required.` });
    }
  }

  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Valid email is required." });
  }

  const leads = readLeads();
  const duplicateEmail = leads.some((lead) => normalizeEmail(lead.email) === email);

  const lead = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    firstName: asTrimmed(input.firstName),
    lastName: asTrimmed(input.lastName),
    resortName: asTrimmed(input.resortName),
    maintenanceFee: toNumber(input.maintenanceFee),
    mortgageBalance: toNumber(input.mortgageBalance),
    yearsOwned: toNumber(input.yearsOwned),
    exitReason: asTrimmed(input.exitReason),
    spokeWithExitCompany: asTrimmed(input.spokeWithExitCompany),
    state: asTrimmed(input.state),
    phone: asTrimmed(input.phone),
    email,
    contactWindow: asTrimmed(input.contactWindow),
    chatbotQualified: true,
    optedIn: true,
    consentDate: new Date().toISOString(),
    source: "freedomshare_landing"
  };

  leads.push(lead);
  writeLeads(leads);
  trackTrafficEvent("formSubmit", req);

  return res.status(201).json({
    ok: true,
    duplicateEmail,
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
