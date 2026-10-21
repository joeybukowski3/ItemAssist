const RF = require("../../../assets/js/rf-shared.js");

/**
 * Defence in depth for ItemAssist Research. The engine already returns an allowlisted contract; this layer re-projects it
 * field by field, so an unexpected or future field can never reach the browser. Nothing is spread. Every string is cleaned and
 * length-capped, every enumeration is checked, every suggestion is forced to `verified: false`, and text that reads like a link,
 * a price, an availability promise or a like-kind-and-quality assurance is withheld even if the engine let it through.
 */

const CONTRACT_VERSION = "research.1";
const KIND = "ITEMASSIST_RESEARCH";
const STATUSES = Object.freeze(["OK", "PARTIAL", "GUIDANCE_ONLY", "UNAVAILABLE"]);
const CATEGORIES = Object.freeze(["tv", "refrigerator", "appliance", "electronics", "other", "unknown"]);
const CONFIDENCES = Object.freeze(["HIGH", "MEDIUM", "LOW"]);
const STANDINGS = Object.freeze(["RECOMMENDED", "CONDITIONAL"]);
const REQUIREMENT_SOURCES = Object.freeze(["AI_ESTIMATE", "AI_ESTIMATE_PLUS_CATEGORY_GUIDANCE", "CATEGORY_GUIDANCE"]);
const ANSWER_SOURCES = Object.freeze(["AI_ESTIMATE", "CATEGORY_GUIDANCE"]);
const WARNING_CODES = Object.freeze([
  "UNSAFE_CLAIMS_REMOVED", "REQUIREMENTS_FROM_CATEGORY_GUIDANCE", "PRODUCT_NOT_IDENTIFIED", "SUGGESTIONS_WITHHELD", "CATEGORY_MISMATCH",
  "IDENTITY_MISMATCH", "IDENTIFICATION_UNCERTAIN", "SUCCESSOR_CONDITIONAL", "DIFFERENCES_MISSING", "PROVIDER_UNAVAILABLE"
]);
const MAX_TEXT = 160;
const MAX_DISCLOSURE = 300;
const MAX_ELAPSED_MS = 600000;
const FALLBACK_DISCLOSURE = "AI estimate from general product knowledge. Specifications, model numbers, availability and pricing have not been verified and may be out of date.";

const ERROR_MESSAGES = Object.freeze({
  API_DISABLED: "ItemAssist Research is not available right now.",
  INVALID_REQUEST: "Enter a short description of the item (up to 160 characters) and try again.",
  RATE_LIMITED: "Too many requests. Please wait a few minutes and try again.",
  QUOTA_EXCEEDED: "You have used today's free ItemAssist Research requests. Please try again tomorrow.",
  SERVICE_UNAVAILABLE: "ItemAssist Research is temporarily unavailable. Please try again later.",
  CAPACITY_REACHED: "ItemAssist Research has reached its daily capacity. Please try again tomorrow.",
  ENGINE_TIMEOUT: "The research took too long to finish. Please try again.",
  ENGINE_ERROR: "ItemAssist Research could not be completed. Please try again later."
});

// Claims the default tier never makes: links, prices, availability, and LKQ / verification / guarantee assurances. The engine
// filters the same classes; a second, independent filter here means neither layer is a single point of failure.
const UNSAFE_TEXT = new RegExp([
  String.raw`https?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|us|ca|uk|shop|store)\b`,
  String.raw`[$€£]\s?\d|\b\d[\d,.]*\s?(?:usd|dollars?)\b|\bmsrp\b|\bpriced?\s+(?:at|around|from|under)\b|\b(?:discount\w*|coupon\w*|deals?|cheapest|lowest[-\s]price)\b`,
  String.raw`\bin[-\s]stock\b|\bout[-\s]of[-\s]stock\b|\b(?:currently|now)\s+(?:available|sold|offered)\b|\bretail\s+availab\w*|\bavailable\s+(?:at|from|on|now|today)\b|\badd\s+to\s+cart\b`,
  "lkq|like[-\\s_]*kind"
].join("|"), "i");
// Honest uncertainty is kept: "not verified", "not a confirmed match", "not guaranteed" are blanked before the assurance test.
const NEGATED = /\b(?:not|no|never|isn't|aren't|wasn't|cannot|can't|without)\s+(?:(?:a|an|yet|been|be|fully|currently)\s+)*(?:certified|verified|confirmed|approved|guaranteed)\b/gi;
const ASSURANCE = /\b(?:certified|verified|confirmed|approved|proven)\s+(?:\w+\s+){0,2}(?:match\w*|equivalen\w*|replacement|substitute|spec(?:s|ification)?s?|compatib\w*|availab\w*|pric\w*|fit)\b|\bequivalen(?:t|ce)\s+(?:is\s+|are\s+|has\s+been\s+)?(?:confirmed|verified|certified)\b|\b(?:exact|identical|perfect)\s+(?:match|equivalen\w*|replacement|substitute)\b|\bguarantee[ds]?\b|\bprice\s+(?:match|lock)\w*/i;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const oneOf = (value, list) => (typeof value === "string" && list.includes(value) ? value : null);
const isSafe = (value) => !UNSAFE_TEXT.test(value) && !ASSURANCE.test(value.replace(NEGATED, " "));

/** Cleaned, capped text, or null when empty or it makes a claim this tier must not relay. */
function safeText(value, max = MAX_TEXT) {
  if (typeof value !== "string") return null;
  const cleaned = RF.clean(value);
  return cleaned && isSafe(cleaned) ? cleaned.slice(0, max) : null;
}

const safeList = (value, cap) => (Array.isArray(value) ? value.slice(0, cap * 4).map((item) => safeText(item)).filter(Boolean).slice(0, cap) : []);

function projectCandidate(item, { withStanding = false } = {}) {
  if (!isObject(item)) return null;
  const name = safeText(item.name);
  const why = safeText(item.why);
  if (!name || !why) return null;
  const concern = withStanding ? safeText(item.concern) : null;
  const concernWithheld = withStanding && typeof item.concern === "string" && RF.clean(item.concern) !== "" && concern === null;
  return {
    name,
    why,
    differences: safeText(item.differences),
    ...(withStanding ? { concern } : {}),
    confidence: oneOf(typeof item.confidence === "string" ? item.confidence.toUpperCase() : "", CONFIDENCES) || "LOW",
    // A concern the proxy withheld must never upgrade the successor to an unconditional first choice.
    ...(withStanding ? { standing: oneOf(item.standing, STANDINGS) && !concernWithheld ? item.standing : "CONDITIONAL" } : {}),
    verified: false
  };
}

/**
 * @param {unknown} body  the engine's 200 body
 * @param {{requestId: string, elapsedMs: number, quota: object, allowFixture?: boolean}} context
 *   `allowFixture` is true only on a Vercel Preview (the caller decides from the server environment). Only then may the engine's
 *   `meta.fixture === true` become the single fixed `meta.fixture: true` demo indicator; everywhere else it is dropped.
 * @returns the public ItemAssist Research response, or null when the engine body is not a valid research contract
 */
function projectResearch(body, { requestId, elapsedMs, quota, allowFixture = false }) {
  if (!isObject(body) || body.contractVersion !== CONTRACT_VERSION || body.kind !== KIND) return null;
  const status = oneOf(body.status, STATUSES);
  const meta = isObject(body.meta) ? body.meta : {};
  const answerSource = oneOf(meta.answerSource, ANSWER_SOURCES);
  if (!status || !answerSource || !isObject(body.original)) return null;

  const identity = safeText(body.original.identity, 120);
  // Candidates rest on the identification: with no identification there are none, and the answer is guidance only.
  const unidentified = !identity && status !== "UNAVAILABLE";
  const suggestions = unidentified ? [] : (Array.isArray(body.suggestions) ? body.suggestions.slice(0, 12).map((item) => projectCandidate(item)).filter(Boolean).slice(0, 3) : []);
  const successor = unidentified ? null : projectCandidate(body.successor, { withStanding: true });
  const warnings = (Array.isArray(body.warnings) ? body.warnings : []).filter((code) => WARNING_CODES.includes(code)).slice(0, WARNING_CODES.length);
  const addWarning = (code) => { if (!warnings.includes(code)) warnings.push(code); };
  if (unidentified) addWarning("PRODUCT_NOT_IDENTIFIED");
  if ([successor, ...suggestions].some((item) => item && !item.differences)) addWarning("DIFFERENCES_MISSING");

  const disclosure = typeof body.disclosure === "string" && RF.clean(body.disclosure) && RF.clean(body.disclosure).length <= MAX_DISCLOSURE
    ? RF.clean(body.disclosure) : FALLBACK_DISCLOSURE;
  return {
    contractVersion: CONTRACT_VERSION,
    kind: KIND,
    status: unidentified ? "GUIDANCE_ONLY" : (status === "OK" && !successor && !suggestions.length ? "PARTIAL" : status),
    category: oneOf(body.category, CATEGORIES) || "unknown",
    original: {
      identity,
      confidence: oneOf(typeof body.original.confidence === "string" ? body.original.confidence.toUpperCase() : "", CONFIDENCES) || "LOW",
      characteristics: safeList(body.original.characteristics, 4),
      uncertainty: safeText(body.original.uncertainty)
    },
    requirements: safeList(body.requirements, 6),
    requirementsSource: oneOf(body.requirementsSource, REQUIREMENT_SOURCES) || "CATEGORY_GUIDANCE",
    successor,
    suggestions,
    clarify: safeList(body.clarify, 2),
    disclosure,
    warnings,
    meta: {
      requestId,
      elapsedMs: Math.min(MAX_ELAPSED_MS, Math.max(0, Math.round(Number(elapsedMs)) || 0)),
      cached: meta.cached === true,
      answerSource,
      ...(allowFixture === true && meta.fixture === true ? { fixture: true } : {})
    },
    quota
  };
}

/** The fixed error body: a code from the proxy vocabulary and its fixed message; never engine, store or provider text. */
function projectError(code, requestId, quota) {
  const errorCode = ERROR_MESSAGES[code] ? code : "ENGINE_ERROR";
  return {
    contractVersion: CONTRACT_VERSION, kind: KIND, status: "ERROR", errorCode, message: ERROR_MESSAGES[errorCode], requestId,
    ...(quota ? { quota } : {})
  };
}

module.exports = { projectResearch, projectError, isSafe, CONTRACT_VERSION, KIND, ERROR_MESSAGES, FALLBACK_DISCLOSURE };
