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
const BOT_UA_PATTERN = /(bot|spider|crawl|slurp|headless|facebookexternalhit|whatsapp|slackbot|discordbot|twitterbot|linkedinbot|bingpreview|gptbot|claudebot|perplexitybot|semrushbot|ahrefsbot|mj12bot|yandexbot|duckduckbot|applebot)/i;
const MAX_DAILY_LOOKBACK_DAYS = 90;

function defaultTraffic() {
  return {
    pageHits: 0,
    formStarts: 0,
    formSubmits: 0,
    formSubmitAttempts: 0,
    formSubmitFailures: 0,
    formSubmitFailureReasons: {},
    consentViews: 0,
    consentAccepts: 0,
    stepViews: {},
    stepCompletions: {},
    daily: {},
    uniqueVisitors: 0,
    uniqueVisitorKeys: {},
    ignoredBotPageHits: 0,
    ignoredTestEvents: 0,
    lastPageHitAt: "",
    lastFormStartAt: "",
    lastFormSubmitAt: "",
    lastFormSubmitAttemptAt: "",
    lastFormSubmitFailureAt: "",
    lastConsentViewAt: "",
    lastConsentAcceptAt: "",
    lastStepViewAt: "",
    lastStepCompletionAt: "",
    updatedAt: "",
  };
}

function incrementBucket(bucket, key) {
  const normalized = String(key || "").trim();
  if (!normalized) return;
  if (!bucket[normalized]) {
    bucket[normalized] = 0;
  }
  bucket[normalized] += 1;
}

function isTruthy(value) {
  if (value === true) return true;
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "y";
}

function getUserAgent(req) {
  return String(req.get("user-agent") || "unknown").slice(0, 160);
}

function isLikelyBot(req) {
  return BOT_UA_PATTERN.test(getUserAgent(req));
}

function isTestTraffic(req, payload = {}) {
  if (isTruthy(req.get("x-traffic-test"))) return true;
  if (isTruthy(req.query?.test) || isTruthy(req.query?.qa)) return true;

  if (payload && typeof payload === "object") {
    if (isTruthy(payload.isTest) || isTruthy(payload.test) || isTruthy(payload.qa)) {
      return true;
    }

    const sessionId = String(payload.sessionId || "").trim().toLowerCase();
    if (sessionId.startsWith("test-") || sessionId.startsWith("qa-")) {
      return true;
    }
  }

  const referer = String(req.get("referer") || "").toLowerCase();
  if (referer.includes("localhost") || referer.includes("127.0.0.1")) {
    return true;
  }

  return false;
}

function getDailyBucket(traffic, dayKey) {
  if (!traffic.daily || typeof traffic.daily !== "object") {
    traffic.daily = {};
  }

  if (!traffic.daily[dayKey] || typeof traffic.daily[dayKey] !== "object") {
    traffic.daily[dayKey] = {
      pageHits: 0,
      uniqueVisitors: 0,
      formStarts: 0,
      formSubmits: 0,
      formSubmitAttempts: 0,
      formSubmitFailures: 0,
    };
  }

  return traffic.daily[dayKey];
}

function extractTrackingPayload(input) {
  if (!input || typeof input !== "object") return {};
  const tracking = input._tracking;
  return tracking && typeof tracking === "object" ? tracking : {};
}

function normalizeStepLabel(payload) {
  if (!payload || typeof payload !== "object") return "";
  const stepKey = String(payload.stepKey || "").trim();
  const stepIndexRaw = payload.stepIndex;
  const stepIndex = Number.isInteger(stepIndexRaw)
    ? stepIndexRaw
    : Number.isFinite(Number(stepIndexRaw))
      ? Number(stepIndexRaw)
      : null;

  if (stepIndex !== null && stepIndex >= 0) {
    return stepKey ? `${stepIndex + 1}:${stepKey}` : `${stepIndex + 1}`;
  }
  return stepKey;
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
  const ua = getUserAgent(req);
  return `${todayKey()}|${ip}|${ua}`;
}

function trackTrafficEvent(eventName, req, payload = {}) {
  const traffic = readTraffic();
  const now = new Date().toISOString();
  const dayKey = todayKey();

  if (isTestTraffic(req, payload)) {
    traffic.ignoredTestEvents += 1;
    traffic.updatedAt = now;
    writeTraffic(traffic);
    return;
  }

  if (eventName === "pageHit" && isLikelyBot(req)) {
    traffic.ignoredBotPageHits += 1;
    traffic.updatedAt = now;
    writeTraffic(traffic);
    return;
  }

  const daily = getDailyBucket(traffic, dayKey);

  if (eventName === "pageHit") {
    traffic.pageHits += 1;
    daily.pageHits += 1;
    traffic.lastPageHitAt = now;

    const key = visitorKeyFor(req);
    if (!traffic.uniqueVisitorKeys[key]) {
      traffic.uniqueVisitorKeys[key] = now;
      traffic.uniqueVisitors += 1;
      daily.uniqueVisitors += 1;
    }
  }

  if (eventName === "formStart") {
    traffic.formStarts += 1;
    daily.formStarts += 1;
    traffic.lastFormStartAt = now;
  }

  if (eventName === "formSubmit") {
    traffic.formSubmits += 1;
    daily.formSubmits += 1;
    traffic.lastFormSubmitAt = now;
  }

  if (eventName === "submitAttempt") {
    traffic.formSubmitAttempts += 1;
    daily.formSubmitAttempts += 1;
    traffic.lastFormSubmitAttemptAt = now;
  }

  if (eventName === "submitFailure") {
    traffic.formSubmitFailures += 1;
    daily.formSubmitFailures += 1;
    traffic.lastFormSubmitFailureAt = now;
    const reason = String(payload.reason || "unknown").trim().slice(0, 120) || "unknown";
    incrementBucket(traffic.formSubmitFailureReasons, reason);
  }

  if (eventName === "consentView") {
    traffic.consentViews += 1;
    traffic.lastConsentViewAt = now;
  }

  if (eventName === "consentAccept") {
    traffic.consentAccepts += 1;
    traffic.lastConsentAcceptAt = now;
  }

  if (eventName === "stepView") {
    const stepLabel = normalizeStepLabel(payload);
    if (stepLabel) {
      incrementBucket(traffic.stepViews, stepLabel);
      traffic.lastStepViewAt = now;
    }
  }

  if (eventName === "stepComplete") {
    const stepLabel = normalizeStepLabel(payload);
    if (stepLabel) {
      incrementBucket(traffic.stepCompletions, stepLabel);
      traffic.lastStepCompletionAt = now;
    }
  }

  traffic.updatedAt = now;
  writeTraffic(traffic);
}

function shouldTrackPageHit(req) {
  if (req.method !== "GET") return false;

  const pathName = String(req.path || "");
  return pathName === "/" || pathName === "/index.html";
}

function buildDailySummary(traffic, days) {
  const lookbackDays = Math.max(1, Math.min(MAX_DAILY_LOOKBACK_DAYS, Number(days) || 14));
  const utcDates = [];
  for (let i = lookbackDays - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    utcDates.push(d.toISOString().slice(0, 10));
  }

  const rows = utcDates.map((day) => {
    const row = traffic.daily && typeof traffic.daily === "object" ? traffic.daily[day] : null;
    const pageHits = Number(row?.pageHits || 0);
    const formStarts = Number(row?.formStarts || 0);
    const formSubmits = Number(row?.formSubmits || 0);
    const formSubmitAttempts = Number(row?.formSubmitAttempts || 0);
    return {
      day,
      pageHits,
      uniqueVisitors: Number(row?.uniqueVisitors || 0),
      formStarts,
      formSubmits,
      formSubmitAttempts,
      formSubmitFailures: Number(row?.formSubmitFailures || 0),
      startRatePct: pageHits > 0 ? Number(((formStarts / pageHits) * 100).toFixed(2)) : 0,
      submitPerStartPct: formStarts > 0 ? Number(((formSubmits / formStarts) * 100).toFixed(2)) : 0,
      submitPerAttemptPct: formSubmitAttempts > 0 ? Number(((formSubmits / formSubmitAttempts) * 100).toFixed(2)) : 0,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    timezone: "UTC",
    lookbackDays,
    rows,
  };
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

app.use((req, _res, next) => {
  if (shouldTrackPageHit(req)) {
    trackTrafficEvent("pageHit", req);
  }
  next();
});

app.use(express.static(path.join(__dirname, "public")));

// Serve landing assets and homepage from repository root.
app.use(express.static(__dirname, { index: false }));

app.get("/", (_req, res) => {
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

app.get("/api/traffic/daily", (req, res) => {
  if (!isFeedAuthorized(req)) {
    return res.status(401).json({ error: "Unauthorized traffic request." });
  }

  const traffic = readTraffic();
  const days = Number(req.query?.days);
  res.setHeader("Cache-Control", "no-store");
  return res.json(buildDailySummary(traffic, days));
});

app.get("/api/traffic/daily/public", (req, res) => {
  const traffic = readTraffic();
  const days = Number(req.query?.days);
  res.setHeader("Cache-Control", "no-store");
  return res.json(buildDailySummary(traffic, days));
});

app.post("/api/traffic/page-hit", (_req, res) => {
  trackTrafficEvent("pageHit", _req);
  return res.status(204).send();
});

app.post("/api/traffic/form-start", (_req, res) => {
  trackTrafficEvent("formStart", _req);
  return res.status(204).send();
});

app.post("/api/traffic/form-step-view", (req, res) => {
  const payload = req.body && typeof req.body === "object" ? req.body : {};
  trackTrafficEvent("stepView", req, payload);
  return res.status(204).send();
});

app.post("/api/traffic/form-step-complete", (req, res) => {
  const payload = req.body && typeof req.body === "object" ? req.body : {};
  trackTrafficEvent("stepComplete", req, payload);
  return res.status(204).send();
});

app.post("/api/traffic/consent-view", (req, res) => {
  trackTrafficEvent("consentView", req);
  return res.status(204).send();
});

app.post("/api/traffic/consent-accept", (req, res) => {
  trackTrafficEvent("consentAccept", req);
  return res.status(204).send();
});

app.post("/api/traffic/submit-attempt", (req, res) => {
  trackTrafficEvent("submitAttempt", req);
  return res.status(204).send();
});

app.post("/api/traffic/submit-failure", (req, res) => {
  const payload = req.body && typeof req.body === "object" ? req.body : {};
  trackTrafficEvent("submitFailure", req, payload);
  return res.status(204).send();
});

function buildDropoffSummary(traffic) {
  const stepViews = traffic.stepViews && typeof traffic.stepViews === "object" ? traffic.stepViews : {};
  const stepCompletions = traffic.stepCompletions && typeof traffic.stepCompletions === "object" ? traffic.stepCompletions : {};
  const allStepKeys = Array.from(new Set([...Object.keys(stepViews), ...Object.keys(stepCompletions)]));

  allStepKeys.sort((a, b) => {
    const ai = Number(String(a).split(":", 1)[0]);
    const bi = Number(String(b).split(":", 1)[0]);
    if (Number.isFinite(ai) && Number.isFinite(bi) && ai !== bi) return ai - bi;
    return String(a).localeCompare(String(b));
  });

  const perStep = allStepKeys.map((step) => {
    const viewed = Number(stepViews[step] || 0);
    const completed = Number(stepCompletions[step] || 0);
    const dropped = Math.max(viewed - completed, 0);
    const completionRatePct = viewed > 0 ? Number(((completed / viewed) * 100).toFixed(2)) : 0;
    return {
      step,
      viewed,
      completed,
      dropped,
      completionRatePct,
    };
  });

  const starts = Number(traffic.formStarts || 0);
  const submits = Number(traffic.formSubmits || 0);
  const attempts = Number(traffic.formSubmitAttempts || 0);
  const consentViews = Number(traffic.consentViews || 0);
  const consentAccepts = Number(traffic.consentAccepts || 0);

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      pageHits: Number(traffic.pageHits || 0),
      formStarts: starts,
      formSubmits: submits,
      formSubmitAttempts: attempts,
      formSubmitFailures: Number(traffic.formSubmitFailures || 0),
      consentViews,
      consentAccepts,
      uniqueVisitors: Number(traffic.uniqueVisitors || 0),
    },
    rates: {
      startRatePct: traffic.pageHits > 0 ? Number(((starts / traffic.pageHits) * 100).toFixed(2)) : 0,
      submitPerStartPct: starts > 0 ? Number(((submits / starts) * 100).toFixed(2)) : 0,
      consentAcceptRatePct: consentViews > 0 ? Number(((consentAccepts / consentViews) * 100).toFixed(2)) : 0,
      submitPerAttemptPct: attempts > 0 ? Number(((submits / attempts) * 100).toFixed(2)) : 0,
    },
    dropoff: {
      startWithoutSubmit: Math.max(starts - submits, 0),
      consentWithoutAccept: Math.max(consentViews - consentAccepts, 0),
      attemptsWithoutSubmit: Math.max(attempts - submits, 0),
    },
    perStep,
    failureReasons: traffic.formSubmitFailureReasons || {},
    lastEvents: {
      lastPageHitAt: traffic.lastPageHitAt || "",
      lastFormStartAt: traffic.lastFormStartAt || "",
      lastStepViewAt: traffic.lastStepViewAt || "",
      lastStepCompletionAt: traffic.lastStepCompletionAt || "",
      lastConsentViewAt: traffic.lastConsentViewAt || "",
      lastConsentAcceptAt: traffic.lastConsentAcceptAt || "",
      lastFormSubmitAttemptAt: traffic.lastFormSubmitAttemptAt || "",
      lastFormSubmitAt: traffic.lastFormSubmitAt || "",
      lastFormSubmitFailureAt: traffic.lastFormSubmitFailureAt || "",
      updatedAt: traffic.updatedAt || "",
    },
  };
}

app.get("/api/traffic/dropoff", (req, res) => {
  if (!isFeedAuthorized(req)) {
    return res.status(401).json({ error: "Unauthorized traffic request." });
  }

  const traffic = readTraffic();
  res.setHeader("Cache-Control", "no-store");
  return res.json(buildDropoffSummary(traffic));
});

app.get("/api/traffic/dropoff/public", (_req, res) => {
  const traffic = readTraffic();
  res.setHeader("Cache-Control", "no-store");
  return res.json(buildDropoffSummary(traffic));
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
  const trackingPayload = extractTrackingPayload(input);
  trackTrafficEvent("submitAttempt", req, trackingPayload);
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
      trackTrafficEvent("submitFailure", req, { ...trackingPayload, reason: `missing_${key}` });
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
      trackTrafficEvent("submitFailure", req, { ...trackingPayload, reason: `missing_${key}` });
      return res.status(400).json({ error: `${label} is required.` });
    }
  }

  if (!email || !email.includes("@")) {
    trackTrafficEvent("submitFailure", req, { ...trackingPayload, reason: "invalid_email" });
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
  trackTrafficEvent("formSubmit", req, trackingPayload);

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
