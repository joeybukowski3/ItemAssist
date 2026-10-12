/*
 * Shared, dependency-free logic for the /replacement-finder proof of concept.
 * Loaded via <script> in the browser (defines window.RFShared) and required directly by the API proxy and Node tests,
 * so the code that ships is the code that is tested. Presentation vocabulary and request validation live here.
 * There is deliberately no matching or scoring logic: every assessment, classification and count input comes from the engine.
 */
(function (root) {
  "use strict";

  const SUPPORT = Object.freeze({
    television: Object.freeze({ label: "Television", brand: "Samsung", noun: "Samsung televisions", example: "QN55Q80C" }),
    refrigerator: Object.freeze({ label: "Refrigerator", brand: "LG", noun: "LG refrigerators", example: "LRFCS25D3S" })
  });

  const MIN_MODEL_LENGTH = 3;
  const MAX_MODEL_LENGTH = 40;
  const MAX_NOTES_LENGTH = 300;
  const MAX_BODY_BYTES = 2048;
  const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 -]*$/;
  const REQUEST_KEYS = Object.freeze(["category", "brand", "model", "notes", "website"]);

  // Enumerations of the public engine contract. The API proxy re-projects with these; the page renders with them.
  const STATUSES = Object.freeze(["COMPLETE", "PARTIAL", "NO_RESULT"]);
  const RETRIEVAL_QUALITIES = Object.freeze(["STRONG", "PARTIAL", "WEAK", "FAILED"]);
  const FACT_STATUSES = Object.freeze(["VERIFIED", "PROVIDED", "INFERRED", "ASSUMED", "AMBIGUOUS", "UNKNOWN"]);
  const CLASSIFICATIONS = Object.freeze(["ABOVE_LKQ", "LKQ", "CLOSE_MATCH", "NOT_LKQ", "UNCONFIRMED"]);
  const CONFIDENCES = Object.freeze(["HIGH", "MEDIUM", "LOW"]);
  const IMPORTANCES = Object.freeze(["REQUIRED", "IMPORTANT", "ADDITIONAL"]);
  const ASSESSMENT_CODES = Object.freeze(["MATCH", "EXCEEDS", "DIFFERS", "UNKNOWN", "ASSUMED", "VERIFY", "FAIL"]);
  const NEEDS_REASONS = Object.freeze(["UNKNOWN", "ASSUMED", "AMBIGUOUS", "UNVERIFIED_FIT", "NOTE_NOT_SCORED", "PARTIAL_DEADLINE"]);
  const SEVERITIES = Object.freeze(["INFO", "WARNING", "BLOCKING"]);
  const SOURCE_ROLES = Object.freeze(["ORIGINAL", "REPLACEMENT", "SUPPORT"]);

  const FACT_STATUS_LABELS = Object.freeze({
    VERIFIED: "Verified", PROVIDED: "Provided by you", INFERRED: "Inferred", ASSUMED: "Assumed", AMBIGUOUS: "Sources disagree", UNKNOWN: "Unknown"
  });
  const CLASSIFICATION_LABELS = Object.freeze({
    LKQ: "Like-Kind & Quality", ABOVE_LKQ: "Above LKQ", CLOSE_MATCH: "Close Match", NOT_LKQ: "Not LKQ", UNCONFIRMED: "Unconfirmed"
  });
  const CLASSIFICATION_HINTS = Object.freeze({
    LKQ: "Same class, key features and product tier as the original.",
    ABOVE_LKQ: "Exceeds the original product class or tier.",
    CLOSE_MATCH: "Same class with meaningful differences from the original.",
    NOT_LKQ: "Does not meet the like-kind-and-quality requirements.",
    UNCONFIRMED: "Not enough verified information to confirm a match."
  });
  const CONFIDENCE_LABELS = Object.freeze({ HIGH: "High", MEDIUM: "Medium", LOW: "Low" });
  const IMPORTANCE_LABELS = Object.freeze({ REQUIRED: "Required", IMPORTANT: "Important", ADDITIONAL: "Additional" });
  const REASON_LABELS = Object.freeze({
    UNKNOWN: "Not verified", ASSUMED: "Assumed", AMBIGUOUS: "Sources disagree", UNVERIFIED_FIT: "Fit not verified",
    NOTE_NOT_SCORED: "Not yet scored", PARTIAL_DEADLINE: "Time limit reached"
  });
  const SEVERITY_LABELS = Object.freeze({ INFO: "Note", WARNING: "Heads up", BLOCKING: "Important" });
  const SOURCE_ROLE_LABELS = Object.freeze({ ORIGINAL: "Original product", REPLACEMENT: "Recommended model", SUPPORT: "Supporting" });

  /** Presentation only: label, tone and icon for an engine assessment code. Tone never carries meaning without the label. */
  const ASSESSMENT_PRESENTATION = Object.freeze({
    MATCH: { tone: "ok", icon: "check" },
    EXCEEDS: { tone: "info", icon: "up" },
    DIFFERS: { tone: "neutral", icon: "neq" },
    UNKNOWN: { tone: "warn", icon: "q" },
    ASSUMED: { tone: "warn", icon: "approx" },
    VERIFY: { tone: "warn", icon: "q" },
    FAIL: { tone: "bad", icon: "x" }
  });

  const ERROR_MESSAGES = Object.freeze({
    API_DISABLED: "Replacement Finder isn't available right now.",
    INVALID_REQUEST: "Check the model number and notes, then try again.",
    RATE_LIMITED: "You've reached the lookup limit for now. Please try again in about 10 minutes.",
    CAPACITY_REACHED: "Replacement Finder has reached its research capacity for today. Please try again tomorrow.",
    SERVICE_UNAVAILABLE: "Replacement research is temporarily unavailable. Please try again later.",
    ENGINE_TIMEOUT: "The research took longer than expected and was stopped. Please try again.",
    ENGINE_ERROR: "We couldn't complete this lookup. Please try again.",
    NETWORK_ERROR: "We couldn't reach ItemAssist. Check your connection and try again."
  });

  /** Fixed, user-safe wording for a proxy error code. Unknown codes fall back to a generic message, never to raw text. */
  function errorMessage(code) {
    return Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code) ? ERROR_MESSAGES[code] : ERROR_MESSAGES.ENGINE_ERROR;
  }

  const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

  function clean(value) {
    return String(value).replace(CONTROL_CHARACTERS, " ").replace(/\s+/g, " ").trim();
  }

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  /**
   * Strict lookup validation, used by the page (fast feedback) and again by the proxy (authoritative).
   * Returns { ok, value, errors }. `value.category` / `value.brand` are canonical; `value.website` is the honeypot.
   * A rejected result never throws and never partially trusts its input.
   */
  function validateLookup(input) {
    const errors = {};
    if (!isPlainObject(input)) return { ok: false, value: null, errors: { form: "Invalid request." } };
    const keys = Object.keys(input);
    if (keys.some(function (key) { return REQUEST_KEYS.indexOf(key) === -1; })) errors.form = "Invalid request.";
    const allStrings = ["category", "brand", "model"].every(function (key) { return typeof input[key] === "string"; })
      && ["notes", "website"].every(function (key) { return input[key] === undefined || typeof input[key] === "string"; });
    if (!allStrings) return { ok: false, value: null, errors: { form: "Invalid request." } };

    const category = Object.prototype.hasOwnProperty.call(SUPPORT, input.category) ? input.category : null;
    if (!category) errors.category = "Choose a category.";
    const brand = category && clean(input.brand).toLowerCase() === SUPPORT[category].brand.toLowerCase() ? SUPPORT[category].brand : null;
    if (category && !brand) errors.brand = "Replacement Finder supports " + SUPPORT[category].noun + " for now.";

    const model = clean(input.model);
    if (!model) errors.model = "Enter a model number.";
    else if (model.length < MIN_MODEL_LENGTH || model.length > MAX_MODEL_LENGTH || !MODEL_PATTERN.test(model)) {
      errors.model = "Use letters, numbers, spaces and hyphens only (" + MIN_MODEL_LENGTH + "-" + MAX_MODEL_LENGTH + " characters).";
    }
    const notes = clean(input.notes === undefined ? "" : input.notes);
    if (notes.length > MAX_NOTES_LENGTH) errors.notes = "Keep notes under " + MAX_NOTES_LENGTH + " characters.";

    if (Object.keys(errors).length) return { ok: false, value: null, errors: errors };
    return { ok: true, errors: {}, value: { category: category, brand: brand, model: model.toUpperCase(), notes: notes, website: clean(input.website === undefined ? "" : input.website) } };
  }

  /**
   * Counts for the Match Summary, derived only from the public comparison rows and the needs-verification list.
   * No score and no percentage: a row is "met" when the engine assessed it MATCH or EXCEEDS.
   */
  function summarizeComparison(rows, needsVerification) {
    const list = Array.isArray(rows) ? rows : [];
    const verbs = { REQUIRED: "met", IMPORTANT: "matched", ADDITIONAL: "matched" };
    const groups = IMPORTANCES.map(function (importance) {
      const items = list.filter(function (row) { return row.importance === importance; });
      const met = items.filter(function (row) { return row.assessment.code === "MATCH" || row.assessment.code === "EXCEEDS"; }).length;
      const unverified = items.filter(function (row) { return ["UNKNOWN", "VERIFY", "ASSUMED"].indexOf(row.assessment.code) !== -1; }).length;
      return { importance: importance, label: IMPORTANCE_LABELS[importance], verb: verbs[importance], met: met, total: items.length, unverified: unverified, unmet: items.length - met - unverified };
    });
    return { groups: groups, needsVerificationCount: Array.isArray(needsVerification) ? needsVerification.length : 0 };
  }

  /** https only, no credentials or port, bounded length. Used for every source link before it is rendered. */
  function isSafeSourceUrl(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > 300) return false;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && !url.port;
    } catch (error) {
      return false;
    }
  }

  const api = {
    SUPPORT: SUPPORT, MIN_MODEL_LENGTH: MIN_MODEL_LENGTH, MAX_MODEL_LENGTH: MAX_MODEL_LENGTH, MAX_NOTES_LENGTH: MAX_NOTES_LENGTH, MAX_BODY_BYTES: MAX_BODY_BYTES,
    REQUEST_KEYS: REQUEST_KEYS, STATUSES: STATUSES, RETRIEVAL_QUALITIES: RETRIEVAL_QUALITIES, FACT_STATUSES: FACT_STATUSES, CLASSIFICATIONS: CLASSIFICATIONS,
    CONFIDENCES: CONFIDENCES, IMPORTANCES: IMPORTANCES, ASSESSMENT_CODES: ASSESSMENT_CODES, NEEDS_REASONS: NEEDS_REASONS, SEVERITIES: SEVERITIES, SOURCE_ROLES: SOURCE_ROLES,
    FACT_STATUS_LABELS: FACT_STATUS_LABELS, CLASSIFICATION_LABELS: CLASSIFICATION_LABELS, CLASSIFICATION_HINTS: CLASSIFICATION_HINTS, CONFIDENCE_LABELS: CONFIDENCE_LABELS,
    IMPORTANCE_LABELS: IMPORTANCE_LABELS, REASON_LABELS: REASON_LABELS, SEVERITY_LABELS: SEVERITY_LABELS, SOURCE_ROLE_LABELS: SOURCE_ROLE_LABELS,
    ASSESSMENT_PRESENTATION: ASSESSMENT_PRESENTATION, ERROR_MESSAGES: ERROR_MESSAGES,
    errorMessage: errorMessage, clean: clean, validateLookup: validateLookup, summarizeComparison: summarizeComparison, isSafeSourceUrl: isSafeSourceUrl
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RFShared = api;
})(typeof window !== "undefined" ? window : this);
