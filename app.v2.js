const questions = [
  {
    key: "firstName",
    label: "What is your first name?",
    type: "text",
    placeholder: "First name"
  },
  {
    key: "lastName",
    label: "What is your last name?",
    type: "text",
    placeholder: "Last name"
  },
  {
    key: "resortName",
    label: "What is the name of your resort or timeshare company?",
    type: "text",
    placeholder: "Example: Westgate, Wyndham, Bluegreen"
  },
  {
    key: "maintenanceFee",
    label: "What is your current annual maintenance fee?",
    type: "number",
    placeholder: "Example: 2200"
  },
  {
    key: "mortgageBalance",
    label: "Do you still have a mortgage balance? If yes, how much?",
    type: "number",
    placeholder: "Enter 0 if paid off"
  },
  {
    key: "yearsOwned",
    label: "How many years have you owned this timeshare?",
    type: "number",
    placeholder: "Example: 8"
  },
  {
    key: "exitReason",
    label: "Why do you want to exit your timeshare?",
    type: "text",
    placeholder: "Medical, financial, no longer using it, inherited, etc."
  },
  {
    key: "spokeWithExitCompany",
    label: "Have you spoken with an exit company before?",
    type: "choice",
    options: ["Yes", "No", "Not sure"]
  },
  {
    key: "state",
    label: "Which state do you currently live in?",
    type: "text",
    placeholder: "Example: Florida"
  },
  {
    key: "phone",
    label: "Best phone number for your eligibility specialist",
    type: "tel",
    placeholder: "(555) 123-4567"
  },
  {
    key: "email",
    label: "Best email for your free consultation details",
    type: "email",
    placeholder: "you@email.com"
  },
  {
    key: "contactWindow",
    label: "When is the best time to contact you?",
    type: "choice",
    options: ["Morning", "Afternoon", "Evening", "Any time"]
  }
];

const answers = {};
let step = 0;

const chatLog = document.getElementById("chatLog");
const form = document.getElementById("qualifyForm");
const questionLabel = document.getElementById("questionLabel");
const questionInput = document.getElementById("questionInput");
const choiceGroup = document.getElementById("choiceGroup");
const progressLabel = document.getElementById("progressLabel");
const progressFill = document.getElementById("progressFill");
const backBtn = document.getElementById("backBtn");
const finalState = document.getElementById("finalState");
const consentPanel = document.getElementById("consentPanel");
const tosAgree = document.getElementById("tosAgree");
const submitWithConsent = document.getElementById("submitWithConsent");
const editAnswersBtn = document.getElementById("editAnswersBtn");
const feeCurrent = document.getElementById("feeCurrent");
const feeGrowth = document.getElementById("feeGrowth");
const feeYears = document.getElementById("feeYears");
const feeDues = document.getElementById("feeDues");
const feeAssessment = document.getElementById("feeAssessment");
const feeAssessmentEvery = document.getElementById("feeAssessmentEvery");
const feeMortgageMonthly = document.getElementById("feeMortgageMonthly");
const feeMortgageYears = document.getElementById("feeMortgageYears");
const feeTotalPaid = document.getElementById("feeTotalPaid");
const feeFinalYear = document.getElementById("feeFinalYear");
const feeAssessments = document.getElementById("feeAssessments");
const feeMortgageTotal = document.getElementById("feeMortgageTotal");
const feeAllIn = document.getElementById("feeAllIn");

let questionnaireStarted = false;
const sessionId = (typeof crypto !== "undefined" && crypto.randomUUID)
  ? crypto.randomUUID()
  : `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const trackedStepViews = new Set();
const trackedStepCompletions = new Set();
let consentViewTracked = false;
let consentAcceptTracked = false;

function trackTraffic(path, payload = {}) {
  fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, ...payload }),
    keepalive: true,
  }).catch(() => {});
}

function trackFormStart() {
  trackTraffic("/api/traffic/form-start");
}

function trackStepView(question, stepIndex) {
  const key = `${stepIndex}:${question.key}`;
  if (trackedStepViews.has(key)) return;
  trackedStepViews.add(key);
  trackTraffic("/api/traffic/form-step-view", {
    stepIndex,
    stepKey: question.key,
  });
}

function trackStepCompletion(question, stepIndex) {
  const key = `${stepIndex}:${question.key}`;
  if (trackedStepCompletions.has(key)) return;
  trackedStepCompletions.add(key);
  trackTraffic("/api/traffic/form-step-complete", {
    stepIndex,
    stepKey: question.key,
  });
}

function trackConsentView() {
  if (consentViewTracked) return;
  consentViewTracked = true;
  trackTraffic("/api/traffic/consent-view");
}

function trackConsentAccept() {
  if (consentAcceptTracked) return;
  consentAcceptTracked = true;
  trackTraffic("/api/traffic/consent-accept");
}

function trackSubmitAttempt() {
  trackTraffic("/api/traffic/submit-attempt");
}

function trackSubmitFailure(reason) {
  trackTraffic("/api/traffic/submit-failure", {
    reason: String(reason || "unknown").slice(0, 120),
  });
}

function ensureQuestionnaireStarted() {
  if (questionnaireStarted) return;
  questionnaireStarted = true;
  trackFormStart();

  const q = questions[step];
  if (q) {
    trackStepView(q, step);
  }
}

function appendChat(role, text) {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${role === "advisor" ? "chat-advisor" : "chat-user"}`;
  bubble.textContent = text;
  chatLog.appendChild(bubble);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function updateProgress() {
  const total = questions.length;
  const completed = Math.min(step + 1, total);
  const percent = Math.round((completed / total) * 100);

  progressLabel.textContent = `Question ${completed} of ${total}`;
  progressFill.style.width = `${percent}%`;
  document.querySelector(".progress-track").setAttribute("aria-valuenow", String(percent));
}

function renderStep() {
  const q = questions[step];
  if (questionnaireStarted) {
    trackStepView(q, step);
  }
  updateProgress();

  questionLabel.textContent = q.label;
  choiceGroup.hidden = true;
  choiceGroup.innerHTML = "";

  if (q.type === "choice") {
    questionInput.hidden = true;
    questionInput.value = "";
    choiceGroup.hidden = false;

    q.options.forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice-btn";
      button.textContent = option;
      button.addEventListener("click", () => {
        ensureQuestionnaireStarted();
        answers[q.key] = option;
        trackStepCompletion(q, step);
        appendChat("user", option);
        nextStep();
      });
      choiceGroup.appendChild(button);
    });
  } else {
    questionInput.hidden = false;
    questionInput.type = q.type;
    questionInput.placeholder = q.placeholder || "";
    questionInput.value = answers[q.key] || "";
    questionInput.focus();
  }

  backBtn.disabled = step === 0;
  appendChat("advisor", q.label);
}

function nextStep() {
  if (step < questions.length - 1) {
    step += 1;
    renderStep();
    return;
  }

  showConsentPanel();
}

function showConsentPanel() {
  form.hidden = true;
  if (consentPanel) {
    consentPanel.hidden = false;
  }
  trackConsentView();
  appendChat("advisor", "Please review and accept the Terms of Service Disclaimer to submit your request.");
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

function formatUsd(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function updateFeeCalculator() {
  if (!feeCurrent || !feeGrowth || !feeYears || !feeTotalPaid || !feeFinalYear) {
    return;
  }

  const current = Math.max(0, Number(feeCurrent.value || 0));
  const growthRate = Math.max(0, Number(feeGrowth.value || 0)) / 100;
  const years = Math.max(1, Number(feeYears.value || 1));
  const annualDues = Math.max(0, Number(feeDues?.value || 0));
  const assessmentAmount = Math.max(0, Number(feeAssessment?.value || 0));
  const assessmentEvery = Math.max(1, Number(feeAssessmentEvery?.value || 1));
  const mortgageMonthly = Math.max(0, Number(feeMortgageMonthly?.value || 0));
  const mortgageYears = Math.max(0, Number(feeMortgageYears?.value || 0));

  let annual = current;
  let maintenanceTotal = 0;
  let assessmentsTotal = 0;
  for (let i = 0; i < years; i += 1) {
    maintenanceTotal += annual + annualDues;
    if ((i + 1) % assessmentEvery === 0) {
      assessmentsTotal += assessmentAmount;
    }
    annual *= 1 + growthRate;
  }

  const finalYearFee = current * Math.pow(1 + growthRate, Math.max(0, years - 1));
  const mortgageTotal = mortgageMonthly * 12 * Math.min(years, mortgageYears);
  const allIn = maintenanceTotal + assessmentsTotal + mortgageTotal;

  feeTotalPaid.textContent = formatUsd(maintenanceTotal);
  feeFinalYear.textContent = formatUsd(finalYearFee);
  if (feeAssessments) feeAssessments.textContent = formatUsd(assessmentsTotal);
  if (feeMortgageTotal) feeMortgageTotal.textContent = formatUsd(mortgageTotal);
  if (feeAllIn) feeAllIn.textContent = formatUsd(allIn);
}

function ensurePageStartsAtTop() {
  if ("scrollRestoration" in window.history) {
    window.history.scrollRestoration = "manual";
  }

  window.scrollTo(0, 0);
  requestAnimationFrame(() => window.scrollTo(0, 0));
  setTimeout(() => window.scrollTo(0, 0), 0);
}

async function submitQualification() {
  trackSubmitAttempt();
  form.hidden = true;
  if (consentPanel) {
    consentPanel.hidden = true;
  }

  try {
    const res = await fetch("/api/qualify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(answers)
    });

    const data = await res.json();
    if (!res.ok) {
      trackSubmitFailure(`http_${res.status}`);
      appendChat("advisor", data.error || "We could not process your request. Please try again.");
      form.hidden = false;
      return;
    }

    appendChat(
      "advisor",
      data.message ||
        "Based on your answers you may qualify for several exit solutions. This information is being sent to our top exit strategists and they will reach out to you. Thank you for your time."
    );
    finalState.hidden = false;
  } catch {
    trackSubmitFailure("network_or_server");
    appendChat(
      "advisor",
      "Based on your answers you may qualify for several exit solutions. This information is being sent to our top exit strategists and they will reach out to you. Thank you for your time."
    );
    finalState.hidden = false;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  ensureQuestionnaireStarted();

  const q = questions[step];
  if (q.type === "choice") {
    return;
  }

  const value = String(questionInput.value || "").trim();
  if (!value) {
    questionInput.focus();
    return;
  }

  if (q.key === "email" && !isValidEmail(value)) {
    questionInput.setCustomValidity("Please enter a valid email address.");
    questionInput.reportValidity();
    return;
  }

  questionInput.setCustomValidity("");
  answers[q.key] = value;
  trackStepCompletion(q, step);
  appendChat("user", value);
  nextStep();
});

backBtn.addEventListener("click", () => {
  if (step === 0) return;
  step -= 1;
  renderStep();
});

questionInput.addEventListener("input", ensureQuestionnaireStarted);

if (tosAgree && submitWithConsent) {
  tosAgree.addEventListener("change", () => {
    submitWithConsent.disabled = !tosAgree.checked;
  });

  submitWithConsent.addEventListener("click", () => {
    if (!tosAgree.checked) return;
    trackConsentAccept();
    appendChat("user", "I agree to the Terms of Service Disclaimer.");
    submitQualification();
  });
}

if (editAnswersBtn) {
  editAnswersBtn.addEventListener("click", () => {
    if (consentPanel) {
      consentPanel.hidden = true;
    }
    form.hidden = false;
    renderStep();
  });
}

function startQuestionnaire() {
  appendChat("advisor", "Welcome. I can help check if you may qualify for timeshare exit options.");
  renderStep();
}

if (feeCurrent && feeGrowth && feeYears) {
  feeCurrent.addEventListener("input", updateFeeCalculator);
  feeGrowth.addEventListener("input", updateFeeCalculator);
  feeYears.addEventListener("input", updateFeeCalculator);
  if (feeDues) feeDues.addEventListener("input", updateFeeCalculator);
  if (feeAssessment) feeAssessment.addEventListener("input", updateFeeCalculator);
  if (feeAssessmentEvery) feeAssessmentEvery.addEventListener("input", updateFeeCalculator);
  if (feeMortgageMonthly) feeMortgageMonthly.addEventListener("input", updateFeeCalculator);
  if (feeMortgageYears) feeMortgageYears.addEventListener("input", updateFeeCalculator);
  updateFeeCalculator();
}

ensurePageStartsAtTop();
startQuestionnaire();
