const { safeSourceUrl, SOURCE_CLASSES, FIRST_PARTY_CLASSES } = require("./sources");

/**
 * research.2 projection for ItemAssist Research. The engine already validates its own response; this layer re-projects it field by field
 * and applies the same trust rules again, independently, so the browser never receives a price, citation or valuation the page could not
 * stand behind. It is never more permissive than the engine's builder:
 *   - research.2 is accepted from a demo fixture on a Preview (`allowFixture` and the engine's `meta.fixture`), or, only when the server has
 *     switched live research.2 on (`allowLive`), from a body with no fixture marker. Until retrieval code can establish a page confirmation
 *     itself, nothing live may carry one: on the live path every page-level confirmation is lowered to a listing or snippet, whatever the
 *     engine claims.
 *   - A source link must be an https URL on a registered host (the domain or its storefront hosts). The source name, class and domain are
 *     taken from the registry, never the payload.
 *   - A price needs matching evidence (right subject, a source class allowed for that kind of price, not about a different model), a real
 *     date, and an allowed verification level. A page-level confirmation survives only for a non-marketplace source about the exact model
 *     (or a short variant); otherwise it is downgraded. A "current" price must be dated within 14 days of the reference date.
 *   - A candidate named by an exact-looking model code is priced only from evidence about that model: a plausible code is not proof.
 *   - A comparison row is "confirmed" only by a confirming source about that candidate's own model.
 *   - An essential requirement is trusted only when the standard criteria for the item type set it; an AI-added one is demoted to important.
 *   - Estimates never carry a source and never appear verified. `verified` is recomputed here, not read.
 *   - A model status can only be as strong as the evidence that survived.
 *   - The valuation is checked against the surviving prices. If it cannot be reconciled, it becomes "insufficient evidence" rather than a figure.
 *   - A candidate with an essential shortfall never sets the range, however good its price.
 * What it cannot do: it has no way to see whether a page was really fetched. `verification`, `subjectModel` and `expectedModel` are the engine's
 * claims, lowered here when the rules above do not support them, never raised. Nothing is spread. Every string is cleaned and capped; the
 * valuation explanation is codes and numbers, never free text.
 */

const CONTRACT_VERSION = "research.2";
const KIND = "ITEMASSIST_RESEARCH";
const STATUSES = Object.freeze(["OK", "PARTIAL", "GUIDANCE_ONLY", "UNAVAILABLE"]);
const CATEGORIES = Object.freeze(["tv", "refrigerator", "appliance", "electronics", "other", "unknown"]);
const PROFILES = Object.freeze(["tv", "refrigerator", "washer", "dryer", "dishwasher", "range", "microwave", "appliance", "electronics", "other", "unknown"]);
const CONFIDENCES = Object.freeze(["HIGH", "MEDIUM", "LOW"]);
const STANDINGS = Object.freeze(["RECOMMENDED", "CONDITIONAL"]);
const ANSWER_SOURCES = Object.freeze(["AI_ESTIMATE", "CATEGORY_GUIDANCE"]);
const IMPORTANCES = Object.freeze(["ESSENTIAL", "IMPORTANT", "MINOR"]);
const ORIGINS = Object.freeze(["CATEGORY_RULE", "AI_ESTIMATE"]);
// Warnings the engine reports about its own input, kept as sent. Every other warning is recomputed here from what survived projection, so a
// warning can never describe a valuation or a candidate the proxy has since changed.
const BASE_WARNING_CODES = Object.freeze(["UNSAFE_CLAIMS_REMOVED", "IDENTIFICATION_UNCERTAIN", "SUCCESSOR_CONDITIONAL", "PROVIDER_UNAVAILABLE"]);
const WARNING_CODES = Object.freeze([
  "UNSAFE_CLAIMS_REMOVED", "PRODUCT_NOT_IDENTIFIED", "IDENTIFICATION_UNCERTAIN", "SUCCESSOR_CONDITIONAL", "DIFFERENCES_MISSING", "PROVIDER_UNAVAILABLE",
  "PRICE_EVIDENCE_REJECTED", "CANDIDATE_EXCLUDED_ESSENTIAL", "MODEL_NOT_VERIFIED", "VALUATION_ESTIMATE_ONLY", "VALUATION_INSUFFICIENT"
]);

const PRICE_KINDS = Object.freeze(["MSRP", "HISTORICAL_RETAIL", "CURRENT_RETAIL_NEW", "SECONDARY_REPORT", "AI_ESTIMATE"]);
const VERIFICATIONS = Object.freeze(["VERIFIED_PAGE", "SEARCH_LISTING", "SEARCH_SNIPPET", "NONE"]);
const DATE_BASES = Object.freeze(["OBSERVED", "PUBLISHED", "UNKNOWN"]);
const SUBJECTS = Object.freeze(["ORIGINAL", "SUCCESSOR", "ALT_1", "ALT_2"]);
const CANDIDATE_KEYS = Object.freeze(["SUCCESSOR", "ALT_1", "ALT_2"]);
const MODEL_STATUSES = Object.freeze(["VERIFIED_LISTING", "LISTED_PROVISIONAL", "FAMILY_LEVEL", "UNVERIFIED_MODEL"]);
const MODEL_RELATIONS = Object.freeze(["EXACT", "VARIANT", "DIFFERENT", "UNKNOWN"]);
const TIER_LEVELS = Object.freeze(["VALUE", "STANDARD", "PREMIUM", "UPPER_PREMIUM", "LUXURY", "UNKNOWN"]);
const COMPARISON_STATUSES = Object.freeze(["MEETS", "EXCEEDS", "SHORTFALL", "UNKNOWN"]);
const METHODS = Object.freeze({
  VERIFIED_MULTI: "VERIFIED_CURRENT_RETAIL", VERIFIED_SINGLE: "VERIFIED_CURRENT_RETAIL", MIXED_VERIFIED_AND_LISTINGS: "MIXED_CURRENT_RETAIL",
  PROVISIONAL_LISTINGS: "PROVISIONAL_LISTINGS", HISTORICAL_TIER_ESTIMATE: "TIER_ESTIMATE", AI_ESTIMATE_ONLY: "AI_ESTIMATE", INSUFFICIENT: "NONE"
});
// The most a method may claim: estimates are always low confidence, a single comparable never high.
const MAX_CONFIDENCE = Object.freeze({
  VERIFIED_MULTI: "HIGH", VERIFIED_SINGLE: "MEDIUM", MIXED_VERIFIED_AND_LISTINGS: "MEDIUM", PROVISIONAL_LISTINGS: "MEDIUM",
  HISTORICAL_TIER_ESTIMATE: "LOW", AI_ESTIMATE_ONLY: "LOW", INSUFFICIENT: "LOW"
});
const EXCLUSION_REASONS = Object.freeze(["NO_CURRENT_PRICE", "CONFIRMED_ESSENTIAL_SHORTFALL", "SUSPECTED_ESSENTIAL_SHORTFALL"]);
const EXCLUSION_NOTE = Object.freeze({
  CONFIRMED_ESSENTIAL_SHORTFALL: "EXCLUDED_CONFIRMED_SHORTFALL", SUSPECTED_ESSENTIAL_SHORTFALL: "EXCLUDED_SUSPECTED_SHORTFALL", NO_CURRENT_PRICE: "EXCLUDED_NO_CURRENT_PRICE"
});
const REJECTION_SCOPES = Object.freeze(["EVIDENCE", "PRICE", "TIER", "COMPARISON", "REQUIREMENT", "CANDIDATE"]);
const REJECTION_ACTIONS = Object.freeze(["REJECTED", "DOWNGRADED"]);
const REJECTION_REASONS = Object.freeze([
  "AMOUNT_INVALID", "COMPARISON_NOT_CONFIRMED", "CURRENCY_UNSUPPORTED", "DATE_INVALID", "DATE_IN_FUTURE", "DATE_REQUIRED", "ESSENTIAL_FROM_AI_DOWNGRADED",
  "ESTIMATE_CITES_SOURCE", "IMPORTANCE_FIXED_BY_CODE", "KIND_SOURCE_MISMATCH", "MODEL_STATUS_DOWNGRADED", "MODEL_UNVERIFIED", "SHAPE_INVALID", "SOURCE_FABRICATED",
  "SOURCE_INVALID", "SOURCE_NOT_ALLOWED", "STALE_CURRENT_PRICE", "SUBJECT_INVALID", "TIER_BASIS_DOWNGRADED", "VERIFICATION_DOWNGRADED", "WRONG_PRODUCT"
]);
// Per-note parameters. `candidate` is a candidate key; the rest are finite numbers.
const NOTE_PARAMS = Object.freeze({
  BASED_ON_VERIFIED: ["count"], BASED_ON_LISTINGS: ["count"], ONE_COMPARABLE: [], LISTINGS_NOT_CONFIRMED: [], TIER_ESTIMATE_BAND: ["low", "high"],
  AI_ESTIMATE_ONLY: [], INSUFFICIENT: [], MSRP_CONTEXT_ONLY: [], CURRENT_BELOW_ORIGINAL: ["ratio"], ORIGINAL_DATE_UNKNOWN: [], TIER_UNKNOWN_WIDENED: [],
  EXCLUDED_CONFIRMED_SHORTFALL: ["candidate"], EXCLUDED_SUSPECTED_SHORTFALL: ["candidate"], EXCLUDED_NO_CURRENT_PRICE: ["candidate"],
  STALE_PRICES_NOT_CURRENT: ["count"], OTHER_FAMILIES_SEPARATE: ["count"], NOT_AN_APPRAISAL: []
});
const METHOD_ONLY_NOTES = Object.freeze({
  BASED_ON_VERIFIED: ["VERIFIED_MULTI", "VERIFIED_SINGLE", "MIXED_VERIFIED_AND_LISTINGS"],
  BASED_ON_LISTINGS: ["MIXED_VERIFIED_AND_LISTINGS", "PROVISIONAL_LISTINGS"],
  LISTINGS_NOT_CONFIRMED: ["MIXED_VERIFIED_AND_LISTINGS", "PROVISIONAL_LISTINGS"],
  ONE_COMPARABLE: ["VERIFIED_SINGLE"],
  TIER_ESTIMATE_BAND: ["HISTORICAL_TIER_ESTIMATE"], TIER_UNKNOWN_WIDENED: ["HISTORICAL_TIER_ESTIMATE"], ORIGINAL_DATE_UNKNOWN: ["HISTORICAL_TIER_ESTIMATE"],
  AI_ESTIMATE_ONLY: ["AI_ESTIMATE_ONLY"], INSUFFICIENT: ["INSUFFICIENT"],
  OTHER_FAMILIES_SEPARATE: ["VERIFIED_MULTI", "VERIFIED_SINGLE", "MIXED_VERIFIED_AND_LISTINGS", "PROVISIONAL_LISTINGS"],
  MSRP_CONTEXT_ONLY: ["VERIFIED_MULTI", "VERIFIED_SINGLE", "MIXED_VERIFIED_AND_LISTINGS", "PROVISIONAL_LISTINGS"],
  CURRENT_BELOW_ORIGINAL: ["VERIFIED_MULTI", "VERIFIED_SINGLE", "MIXED_VERIFIED_AND_LISTINGS", "PROVISIONAL_LISTINGS"]
});
// Which source classes may stand behind each kind of price, and at which verification levels (verification can only be lower, never higher).
const KIND_SOURCES = Object.freeze({
  MSRP: ["MANUFACTURER", "RETAILER", "REVIEW", "TECH_DATABASE"], HISTORICAL_RETAIL: ["MANUFACTURER", "RETAILER", "REVIEW", "TECH_DATABASE"],
  CURRENT_RETAIL_NEW: ["MANUFACTURER", "RETAILER"], SECONDARY_REPORT: ["MARKETPLACE", "REVIEW", "TECH_DATABASE", "RETAILER"]
});
const KIND_VERIFICATIONS = Object.freeze({
  MSRP: ["VERIFIED_PAGE", "SEARCH_SNIPPET"], HISTORICAL_RETAIL: ["VERIFIED_PAGE", "SEARCH_LISTING", "SEARCH_SNIPPET"],
  CURRENT_RETAIL_NEW: ["VERIFIED_PAGE", "SEARCH_LISTING"], SECONDARY_REPORT: ["VERIFIED_PAGE", "SEARCH_LISTING", "SEARCH_SNIPPET"]
});
const CONFIRMING_CLASSES = Object.freeze(["MANUFACTURER", "RETAILER", "TECH_DATABASE"]);
// A model relation that says the evidence is about this model (not unknown, not a different one).
const SAME_MODEL_RELATIONS = Object.freeze(["EXACT", "VARIANT"]);

const CURRENT_PRICE_MAX_AGE_DAYS = 14;
// The engine accepts an observation dated one day after the reference date (a time-zone allowance); so does this projection.
const FUTURE_DATE_TOLERANCE_DAYS = 1;
const MIN_AMOUNT = 1;
const MAX_AMOUNT = 999999;
const MAX_ESTIMATE_SPREAD = 8;
const MAX_PRICES = 12;
const MAX_EVIDENCE = 12;
const MAX_REQUIREMENTS = 8;
const MAX_REJECTIONS = 12;
const MAX_NOTES = 16;
const BELOW_ORIGINAL_RATIO = 0.75;
const WITHHELD_REQUIREMENT = "Criterion text withheld";
const EVIDENCE_ID = /^e[1-9]\d?$/;
const PRICE_ID = /^p[1-9]\d?$/;
const REQUIREMENT_ID = /^r[1-8]$/;
const KEY_PATTERN = /^[a-z][A-Za-z0-9]{1,23}$/;
// A model code, not free text: letters, digits and hyphens with at least one digit, optionally one short "/" suffix (the engine's pattern).
const MODEL_PATTERN = /^(?=[A-Za-z0-9/-]*\d)[A-Za-z0-9][A-Za-z0-9-]{2,23}(?:\/[A-Za-z0-9]{1,6})?$/;
const DAY_MS = 86400000;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const oneOf = (value, list) => (typeof value === "string" && list.includes(value) ? value : null);
const own = (object, key) => typeof key === "string" && Object.prototype.hasOwnProperty.call(object, key);
const round2 = (value) => Math.round(value * 100) / 100;
const finiteIn = (value, low, high) => typeof value === "number" && Number.isFinite(value) && value >= low && value <= high;

/** A real calendar date as YYYY-MM-DD (a full ISO time with a zone is reduced to its UTC date), year 2000-2100; anything else is null. */
function normalizeDate(value) {
  if (typeof value !== "string" || value.length > 40) return null;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const time = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  const text = day ? value : time && Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value)).toISOString().slice(0, 10) : null;
  const parts = text && /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!parts) return null;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const date = Number(parts[3]);
  const real = new Date(Date.UTC(year, month - 1, date));
  return year >= 2000 && year <= 2100 && real.getUTCFullYear() === year && real.getUTCMonth() === month - 1 && real.getUTCDate() === date ? text : null;
}

const daysBetween = (earlier, later) => Math.round((Date.parse(later) - Date.parse(earlier)) / DAY_MS);
const modelKey = (value) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const cleanModel = (value) => (typeof value === "string" && MODEL_PATTERN.test(value.trim()) ? value.trim().slice(0, 40) : null);
/** A name that looks like an exact model code (RF28B5100SR) rather than a series (C4, S90D). */
const looksLikeExactModel = (name) => /\b(?=[A-Z0-9-]*[A-Z])(?=(?:[A-Z0-9-]*\d){3})[A-Z0-9-]{6,}\b/.test(String(name || "").toUpperCase());

function modelRelation(subject, expected) {
  const a = modelKey(subject);
  const b = modelKey(expected);
  if (!a || !b) return "UNKNOWN";
  if (a === b) return "EXACT";
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= 6 && longer.startsWith(shorter) && longer.length - shorter.length <= 6 ? "VARIANT" : "DIFFERENT";
}

/* ---------- Requirements ---------- */

/** @returns {{items: object[], demoted: number}} `demoted` counts essentials the AI added, which are kept as important, never trusted as essential */
function projectRequirements(raw, { safeText }) {
  const items = [];
  const seen = new Set();
  let demoted = 0;
  for (const entry of (Array.isArray(raw) ? raw : []).slice(0, MAX_REQUIREMENTS * 2)) {
    if (!isObject(entry) || typeof entry.id !== "string" || !REQUIREMENT_ID.test(entry.id) || seen.has(entry.id)) continue;
    const claimed = oneOf(entry.importance, IMPORTANCES);
    const origin = oneOf(entry.origin, ORIGINS);
    if (!claimed || !origin) continue;
    // Only the standard criteria for the item type may be essential (an essential shortfall excludes a candidate). An AI-origin one keeps
    // its origin and drops to important: its provenance is never upgraded to the standard criteria's.
    const importance = claimed === "ESSENTIAL" && origin !== "CATEGORY_RULE" ? "IMPORTANT" : claimed;
    if (importance !== claimed) demoted += 1;
    seen.add(entry.id);
    // An essential whose text is withheld stays on the list (its importance still matters), under fixed wording.
    items.push({
      id: entry.id,
      key: typeof entry.key === "string" && KEY_PATTERN.test(entry.key) ? entry.key : null,
      text: safeText(entry.text) || WITHHELD_REQUIREMENT,
      importance,
      origin
    });
    if (items.length >= MAX_REQUIREMENTS) break;
  }
  return { items, demoted };
}

/* ---------- Evidence ---------- */

function projectEvidence(raw, keys) {
  const items = [];
  const seen = new Set();
  for (const entry of (Array.isArray(raw) ? raw : []).slice(0, MAX_EVIDENCE * 2)) {
    if (!isObject(entry) || typeof entry.id !== "string" || !EVIDENCE_ID.test(entry.id) || seen.has(entry.id)) continue;
    const subject = oneOf(entry.subject, SUBJECTS);
    if (!subject || (subject !== "ORIGINAL" && !keys.includes(subject))) continue;
    const source = safeSourceUrl(entry.sourceUrl);
    if (!source) continue;
    const publishedAt = entry.publishedAt == null ? null : normalizeDate(entry.publishedAt);
    const observedAt = entry.observedAt == null ? null : normalizeDate(entry.observedAt);
    if ((entry.publishedAt != null && !publishedAt) || (entry.observedAt != null && !observedAt)) continue;
    const subjectModel = entry.subjectModel == null ? null : cleanModel(entry.subjectModel);
    const expectedModel = entry.expectedModel == null ? null : cleanModel(entry.expectedModel);
    if ((entry.subjectModel != null && !subjectModel) || (entry.expectedModel != null && !expectedModel)) continue;
    seen.add(entry.id);
    // Name, domain, class and first-party status come from the registry for the link's own host; the payload's claims are ignored.
    items.push({
      id: entry.id, subject, sourceName: source.sourceName, sourceDomain: source.domain, sourceUrl: source.url, sourceClass: source.sourceClass,
      firstParty: FIRST_PARTY_CLASSES.includes(source.sourceClass), publishedAt, observedAt, subjectModel, expectedModel,
      modelRelation: modelRelation(subjectModel, expectedModel)
    });
    if (items.length >= MAX_EVIDENCE) break;
  }
  return items;
}

/* ---------- Prices ---------- */

function projectAmount(raw, kind) {
  if (!isObject(raw) || raw.currency !== "USD" || !finiteIn(raw.low, MIN_AMOUNT, MAX_AMOUNT) || !finiteIn(raw.high, MIN_AMOUNT, MAX_AMOUNT)) return null;
  const low = round2(raw.low);
  const high = round2(raw.high);
  if (high < low) return null;
  if (kind === "AI_ESTIMATE" ? high / low > MAX_ESTIMATE_SPREAD : high !== low) return null;
  return { currency: "USD", low, high };
}

function projectPrices(raw, { evidence, keys, names, referenceDate, trustPageVerification = false }) {
  const byEvidence = new Map(evidence.map((entry) => [entry.id, entry]));
  const items = [];
  const seen = new Set();
  for (const entry of (Array.isArray(raw) ? raw : []).slice(0, MAX_PRICES * 2)) {
    if (!isObject(entry) || typeof entry.id !== "string" || !PRICE_ID.test(entry.id) || seen.has(entry.id)) continue;
    const kind = oneOf(entry.kind, PRICE_KINDS);
    const subject = oneOf(entry.subject, ["ORIGINAL", "REPLACEMENT"]);
    if (!kind || !subject) continue;
    const candidate = entry.candidate == null ? null : oneOf(entry.candidate, CANDIDATE_KEYS);
    if (entry.candidate != null && (!candidate || !keys.includes(candidate))) continue;
    if (subject === "ORIGINAL" ? candidate !== null : candidate === null && kind !== "AI_ESTIMATE") continue;
    const amount = projectAmount(entry.amount, kind);
    const verification = oneOf(entry.verification, VERIFICATIONS);
    const asOfBasis = oneOf(entry.asOfBasis, DATE_BASES);
    const asOf = entry.asOf == null ? null : normalizeDate(entry.asOf);
    const model = entry.model == null ? null : cleanModel(entry.model);
    if (!amount || !verification || !asOfBasis || (entry.asOf != null && !asOf) || (entry.model != null && !model)) continue;
    if ((asOf === null) !== (asOfBasis === "UNKNOWN") || (asOf !== null && daysBetween(referenceDate, asOf) > FUTURE_DATE_TOLERANCE_DAYS)) continue;
    let evidenceId = null;
    let level = verification;
    if (kind === "AI_ESTIMATE") {
      if (entry.evidenceId != null || verification !== "NONE") continue;
    } else {
      const source = typeof entry.evidenceId === "string" ? byEvidence.get(entry.evidenceId) : null;
      const expectedSubject = subject === "ORIGINAL" ? "ORIGINAL" : candidate;
      if (!source || !KIND_VERIFICATIONS[kind].includes(verification) || !KIND_SOURCES[kind].includes(source.sourceClass)) continue;
      if (source.modelRelation === "DIFFERENT" || (expectedSubject !== null && source.subject !== expectedSubject)) continue;
      // A plausible model code is not proof the model exists: a candidate named by an exact code is priced only from evidence about that model.
      const exactName = subject === "REPLACEMENT" && candidate !== null && looksLikeExactModel(names[candidate]);
      if (exactName && !SAME_MODEL_RELATIONS.includes(source.modelRelation)) continue;
      if (kind === "CURRENT_RETAIL_NEW" && (asOf === null || asOfBasis !== "OBSERVED" || daysBetween(asOf, referenceDate) > CURRENT_PRICE_MAX_AGE_DAYS)) continue;
      // A page-level confirmation needs a non-marketplace source about the exact model; anything weaker is only a listing or a snippet.
      if (level === "VERIFIED_PAGE" && !(trustPageVerification && SAME_MODEL_RELATIONS.includes(source.modelRelation) && source.sourceClass !== "MARKETPLACE")) {
        level = kind === "CURRENT_RETAIL_NEW" || kind === "SECONDARY_REPORT" ? "SEARCH_LISTING" : "SEARCH_SNIPPET";
      }
      evidenceId = source.id;
    }
    // `sizeConfirmed: false` (a television listing that states no screen size) exists on a current listing only; anywhere else it is dropped.
    const unsizedExample = entry.sizeConfirmed === false && kind === "CURRENT_RETAIL_NEW" && level === "SEARCH_LISTING" && subject === "REPLACEMENT" && candidate !== null;
    seen.add(entry.id);
    items.push({ id: entry.id, kind, subject, candidate, model, amount, asOf, asOfBasis, verification: level, evidenceId, ...(unsizedExample ? { sizeConfirmed: false } : {}) });
    if (items.length >= MAX_PRICES) break;
  }
  return items;
}

function projectTier(raw, prices) {
  const level = isObject(raw) ? oneOf(raw.level, TIER_LEVELS) : null;
  if (!level || level === "UNKNOWN") return { level: "UNKNOWN", basis: "UNKNOWN" };
  const backed = prices.some((item) => item.subject === "ORIGINAL" && (item.kind === "MSRP" || item.kind === "HISTORICAL_RETAIL"));
  return { level, basis: isObject(raw) && raw.basis === "MSRP_EVIDENCE" && backed ? "MSRP_EVIDENCE" : "AI_ESTIMATE" };
}

/* ---------- Candidates ---------- */

/** True when `source` (cited evidence, or undefined) is a confirming source about candidate `key`'s own model. */
const confirms = (source, key) => Boolean(source) && CONFIRMING_CLASSES.includes(source.sourceClass) && source.subject === key && SAME_MODEL_RELATIONS.includes(source.modelRelation);

function projectComparison(raw, { key, requirementIds, evidenceById, trustConfirmation = false }) {
  const rows = [];
  const seen = new Set();
  for (const row of (Array.isArray(raw) ? raw : []).slice(0, MAX_REQUIREMENTS * 2)) {
    if (!isObject(row) || !requirementIds.has(row.requirementId) || seen.has(row.requirementId)) continue;
    const status = oneOf(row.status, COMPARISON_STATUSES);
    if (!status) continue;
    const source = typeof row.evidenceId === "string" ? evidenceById.get(row.evidenceId) : null;
    // CONFIRMED needs evidence from a confirming source class about this candidate's own model (the same model or a short variant of it); otherwise it is an estimate.
    // Like a page-level price confirmation it is also only possible on a demo fixture: nothing live can establish it yet, whatever the engine claims.
    const confirmed = trustConfirmation === true && row.basis === "CONFIRMED" && confirms(source, key);
    seen.add(row.requirementId);
    rows.push({ requirementId: row.requirementId, status, basis: confirmed ? "CONFIRMED" : "AI_ESTIMATE", evidenceId: confirmed ? source.id : null });
  }
  return rows;
}

/** 0 none, 1 first-party listing about the model, 2 page-confirmed first-party source about the model. */
function supportFor(key, prices, comparison, evidenceById) {
  let level = 0;
  for (const price of prices.filter((item) => item.candidate === key && item.kind !== "AI_ESTIMATE")) {
    const source = evidenceById.get(price.evidenceId);
    if (!source || !source.firstParty || !SAME_MODEL_RELATIONS.includes(source.modelRelation)) continue;
    level = Math.max(level, price.verification === "VERIFIED_PAGE" ? 2 : 1);
  }
  for (const row of comparison) {
    const source = row.evidenceId ? evidenceById.get(row.evidenceId) : null;
    // As in the engine, a confirmed comparison raises the model status only when a first-party source confirmed it.
    if (confirms(source, key) && source.firstParty) level = 2;
  }
  return level;
}

function statusFor(claimed, name, support) {
  if (claimed === "VERIFIED_LISTING" && support >= 2) return "VERIFIED_LISTING";
  if ((claimed === "VERIFIED_LISTING" || claimed === "LISTED_PROVISIONAL") && support >= 1) return "LISTED_PROVISIONAL";
  return looksLikeExactModel(name) ? "UNVERIFIED_MODEL" : "FAMILY_LEVEL";
}

/* ---------- Valuation ---------- */

const INSUFFICIENT_NOTES = Object.freeze([{ code: "INSUFFICIENT" }, { code: "NOT_AN_APPRAISAL" }]);
const insufficientValuation = () => ({
  method: "INSUFFICIENT", basis: "NONE", verified: false, range: null, confidence: "LOW", asOf: null, comparables: [], excluded: [], reference: null,
  notes: INSUFFICIENT_NOTES.map((note) => ({ ...note }))
});

function projectNotes(raw, { method, keys, counts, excluded }) {
  const kept = [];
  for (const entry of (Array.isArray(raw) ? raw : []).slice(0, MAX_NOTES * 2)) {
    if (!isObject(entry) || !own(NOTE_PARAMS, entry.code)) continue;
    const allowedMethods = METHOD_ONLY_NOTES[entry.code];
    if (allowedMethods && !allowedMethods.includes(method)) continue;
    const params = NOTE_PARAMS[entry.code];
    if (Object.keys(entry).some((key) => key !== "code" && !params.includes(key))) continue;
    const note = { code: entry.code };
    let valid = true;
    for (const param of params) {
      if (param === "candidate") {
        if (!keys.includes(entry.candidate)) valid = false; else note.candidate = entry.candidate;
      } else if (!finiteIn(entry[param], 0, 1000)) valid = false;
      else note[param] = round2(entry[param]);
    }
    if (!valid) continue;
    const exclusion = Object.keys(EXCLUSION_NOTE).find((reason) => EXCLUSION_NOTE[reason] === entry.code);
    if (exclusion && !excluded.some((row) => row.candidate === note.candidate && row.reason === exclusion)) continue;
    if (entry.code === "BASED_ON_VERIFIED") note.count = counts.verified;
    if (entry.code === "BASED_ON_LISTINGS") note.count = counts.listings;
    if (entry.code === "STALE_PRICES_NOT_CURRENT") note.count = Math.min(MAX_PRICES, Math.max(1, Math.round(note.count)));
    if ((entry.code === "BASED_ON_VERIFIED" && !counts.verified) || (entry.code === "BASED_ON_LISTINGS" && !counts.listings)) continue;
    if (!kept.some((other) => other.code === note.code && other.candidate === note.candidate)) kept.push(note);
  }
  const body = kept.filter((note) => note.code !== "NOT_AN_APPRAISAL").slice(0, MAX_NOTES - 1);
  // The headline caveat is always present, whatever the payload said or did not say.
  return [...body, { code: "NOT_AN_APPRAISAL" }];
}

/**
 * The engine's valuation, accepted only when it reconciles with the prices and candidates that survived projection; otherwise null.
 * `verified` is recomputed, never read.
 */
function projectValuation(raw, { prices, candidates, requirements }) {
  if (!isObject(raw)) return null;
  const method = own(METHODS, raw.method) ? raw.method : null;
  if (!method || raw.basis !== METHODS[method]) return null;
  const keys = candidates.map((entry) => entry.key);
  const byId = new Map(prices.map((item) => [item.id, item]));
  const essential = new Set(requirements.filter((item) => item.importance === "ESSENTIAL").map((item) => item.id));
  const shortfall = (key) => {
    const rows = (candidates.find((entry) => entry.key === key) || { comparison: [] }).comparison.filter((row) => essential.has(row.requirementId) && row.status === "SHORTFALL");
    return rows.length ? (rows.some((row) => row.basis === "CONFIRMED") ? "CONFIRMED_ESSENTIAL_SHORTFALL" : "SUSPECTED_ESSENTIAL_SHORTFALL") : null;
  };

  const excluded = [];
  for (const row of (Array.isArray(raw.excluded) ? raw.excluded : []).slice(0, CANDIDATE_KEYS.length)) {
    if (!isObject(row) || !keys.includes(row.candidate) || !EXCLUSION_REASONS.includes(row.reason) || excluded.some((other) => other.candidate === row.candidate)) return null;
    excluded.push({ candidate: row.candidate, reason: row.reason });
  }
  // A candidate with an essential shortfall is excluded, with the right reason, and an exclusion for a shortfall must be real.
  for (const key of keys) {
    const need = shortfall(key);
    const row = excluded.find((entry) => entry.candidate === key);
    if (need && (!row || row.reason !== need)) return null;
    if (!need && row && row.reason !== "NO_CURRENT_PRICE") return null;
  }

  const comparables = [];
  for (const row of (Array.isArray(raw.comparables) ? raw.comparables : []).slice(0, MAX_PRICES)) {
    const price = isObject(row) ? byId.get(row.priceId) : null;
    if (!price || row.candidate !== price.candidate || row.verification !== price.verification || comparables.some((other) => other.priceId === price.id)) return null;
    if (price.candidate !== null && excluded.some((entry) => entry.candidate === price.candidate)) return null;
    // A listing that does not confirm the screen size is an example only: it can never set or widen the range.
    if (price.sizeConfirmed === false) return null;
    comparables.push({ priceId: price.id, candidate: price.candidate, verification: price.verification });
  }
  const resolved = comparables.map((row) => byId.get(row.priceId));
  const verifiedOnes = resolved.filter((item) => item.verification === "VERIFIED_PAGE");
  const listingOnes = resolved.filter((item) => item.verification === "SEARCH_LISTING");
  const currentOnly = resolved.every((item) => item.kind === "CURRENT_RETAIL_NEW" && item.subject === "REPLACEMENT" && item.candidate !== null);
  const shapeOk = {
    VERIFIED_MULTI: () => currentOnly && verifiedOnes.length > 1 && !listingOnes.length,
    VERIFIED_SINGLE: () => currentOnly && verifiedOnes.length === 1 && !listingOnes.length,
    MIXED_VERIFIED_AND_LISTINGS: () => currentOnly && verifiedOnes.length > 0 && listingOnes.length > 0 && verifiedOnes.length + listingOnes.length === resolved.length,
    PROVISIONAL_LISTINGS: () => currentOnly && listingOnes.length > 0 && !verifiedOnes.length && listingOnes.length === resolved.length,
    HISTORICAL_TIER_ESTIMATE: () => resolved.length === 0,
    AI_ESTIMATE_ONLY: () => resolved.length > 0 && resolved.every((item) => item.kind === "AI_ESTIMATE" && item.subject === "REPLACEMENT"),
    INSUFFICIENT: () => resolved.length === 0
  }[method];
  if (!shapeOk()) return null;

  let reference = null;
  if (raw.reference !== null && raw.reference !== undefined) {
    const price = isObject(raw.reference) ? byId.get(raw.reference.priceId) : null;
    if (!price || price.subject !== "ORIGINAL" || !["MSRP", "HISTORICAL_RETAIL"].includes(price.kind) || raw.reference.kind !== price.kind) return null;
    reference = { priceId: price.id, kind: price.kind };
  }
  if (method === "HISTORICAL_TIER_ESTIMATE" && !reference) return null;
  // An AI-only or empty valuation points at no price at all: the engine never attaches the original's price to either.
  if ((method === "AI_ESTIMATE_ONLY" || method === "INSUFFICIENT") && reference) return null;

  let range = null;
  if (method !== "INSUFFICIENT") {
    const low = isObject(raw.range) ? raw.range.low : null;
    const high = isObject(raw.range) ? raw.range.high : null;
    if (!isObject(raw.range) || raw.range.currency !== "USD" || !finiteIn(low, MIN_AMOUNT, MAX_AMOUNT) || !finiteIn(high, MIN_AMOUNT, MAX_AMOUNT) || high < low) return null;
    if (method === "HISTORICAL_TIER_ESTIMATE") {
      const anchor = byId.get(reference.priceId).amount.low;
      if (low < anchor * 0.1 || high > anchor * 1.1 + 10) return null;
    } else if (low !== Math.min(...resolved.map((item) => item.amount.low)) || high !== Math.max(...resolved.map((item) => item.amount.high))) return null;
    range = { currency: "USD", low: round2(low), high: round2(high) };
  } else if (raw.range !== null) return null;

  const current = resolved.filter((item) => item.kind === "CURRENT_RETAIL_NEW");
  const asOf = current.length ? current.map((item) => item.asOf).sort().pop() : null;
  if ((raw.asOf === null || raw.asOf === undefined ? null : normalizeDate(raw.asOf)) !== asOf) return null;

  const confidence = oneOf(raw.confidence, CONFIDENCES) || "LOW";
  const ranks = CONFIDENCES.slice().reverse();
  const capped = ranks.indexOf(confidence) > ranks.indexOf(MAX_CONFIDENCE[method]) ? MAX_CONFIDENCE[method] : confidence;
  const notes = projectNotes(raw.notes, { method, keys, counts: { verified: verifiedOnes.length, listings: listingOnes.length }, excluded });
  return {
    method, basis: METHODS[method], verified: method === "VERIFIED_MULTI" || method === "VERIFIED_SINGLE", range, confidence: capped, asOf,
    comparables, excluded, reference, notes
  };
}

/* ---------- Rejections and warnings ---------- */

function projectRejections(raw) {
  const rows = [];
  for (const entry of (Array.isArray(raw) ? raw : []).slice(0, MAX_REJECTIONS * 2)) {
    if (!isObject(entry)) continue;
    const scope = oneOf(entry.scope, REJECTION_SCOPES);
    const action = oneOf(entry.action, REJECTION_ACTIONS);
    const reason = oneOf(entry.reason, REJECTION_REASONS);
    if (!scope || !action || !reason || !Number.isInteger(entry.count) || entry.count < 1 || entry.count > 99) continue;
    rows.push({ scope, reason, action, count: entry.count });
    if (rows.length >= MAX_REJECTIONS) break;
  }
  return rows;
}

/** The rejection rows plus one row for essentials this projection demoted (the engine would have recorded the same), merged with an existing one. */
function withDemotions(rows, demoted) {
  if (!demoted) return rows;
  const same = (row) => row.scope === "REQUIREMENT" && row.reason === "ESSENTIAL_FROM_AI_DOWNGRADED" && row.action === "DOWNGRADED";
  if (rows.some(same)) return rows.map((row) => (same(row) ? { ...row, count: Math.min(99, row.count + demoted) } : row));
  return rows.length >= MAX_REJECTIONS ? rows : [...rows, { scope: "REQUIREMENT", reason: "ESSENTIAL_FROM_AI_DOWNGRADED", action: "DOWNGRADED", count: Math.min(99, demoted) }];
}

/**
 * @returns the public research.2 response, or null when the engine body is not a valid research.2 contract from an allowed demo fixture
 */
function projectResearch2(body, { requestId, elapsedMs, quota, allowFixture = false, allowLive = false }, helpers) {
  const { safeText, safeList, MAX_DISCLOSURE, MAX_ELAPSED_MS, FALLBACK_DISCLOSURE, clean } = helpers;
  if (!isObject(body) || body.contractVersion !== CONTRACT_VERSION || body.kind !== KIND) return null;
  const meta = isObject(body.meta) ? body.meta : {};
  // A demo fixture needs both the Preview and the engine's marker. A live body needs the server switch and carries no marker at all: a
  // fixture marker without `allowFixture` is refused, and a live body never becomes a demo.
  const fixture = allowFixture === true && meta.fixture === true;
  const live = allowLive === true && !Object.prototype.hasOwnProperty.call(meta, "fixture");
  if (!fixture && !live) return null;
  const status = oneOf(body.status, STATUSES);
  const answerSource = oneOf(meta.answerSource, ANSWER_SOURCES);
  if (!status || !answerSource || !isObject(body.original) || !isObject(body.pricing)) return null;
  const referenceDate = normalizeDate(body.pricing.referenceDate);
  if (!referenceDate || referenceDate !== body.pricing.referenceDate) return null;

  const identity = safeText(body.original.identity, 120);
  const unidentified = !identity && status !== "UNAVAILABLE";
  const { items: requirements, demoted: demotedRequirements } = projectRequirements(body.requirements, helpers);
  const requirementIds = new Set(requirements.map((item) => item.id));

  const successorRaw = unidentified || !isObject(body.successor) ? null : body.successor;
  const suggestionsRaw = unidentified ? [] : (Array.isArray(body.suggestions) ? body.suggestions : []);
  const drafts = [];
  const cleanCandidate = (item, withStanding) => {
    if (!isObject(item)) return null;
    const name = safeText(item.name);
    const why = safeText(item.why);
    if (!name || !why) return null;
    const concern = safeText(item.concern);
    const concernWithheld = withStanding && typeof item.concern === "string" && clean(item.concern) !== "" && concern === null;
    return {
      raw: item, name, why, differences: safeText(item.differences), concern,
      confidence: oneOf(typeof item.confidence === "string" ? item.confidence.toUpperCase() : "", CONFIDENCES) || "LOW",
      standing: withStanding ? (oneOf(item.standing, STANDINGS) && !concernWithheld ? item.standing : "CONDITIONAL") : null
    };
  };
  const successorDraft = successorRaw ? cleanCandidate(successorRaw, true) : null;
  if (successorDraft) drafts.push({ key: "SUCCESSOR", ...successorDraft });
  suggestionsRaw.slice(0, 8).map((item) => cleanCandidate(item, false)).filter(Boolean).slice(0, 2).forEach((entry, index) => drafts.push({ key: `ALT_${index + 1}`, ...entry }));
  const keys = drafts.map((entry) => entry.key);

  const evidenceAll = projectEvidence(body.pricing.evidence, keys);
  const names = Object.fromEntries(drafts.map((entry) => [entry.key, entry.name]));
  const prices = projectPrices(body.pricing.prices, { evidence: evidenceAll, keys, names, referenceDate, trustPageVerification: fixture });
  const evidenceById = new Map(evidenceAll.map((entry) => [entry.id, entry]));
  const candidates = drafts.map((entry) => {
    const comparison = projectComparison(entry.raw.comparison, { key: entry.key, requirementIds, evidenceById, trustConfirmation: fixture });
    const modelStatus = statusFor(oneOf(entry.raw.modelStatus, MODEL_STATUSES), entry.name, supportFor(entry.key, prices, comparison, evidenceById));
    return { key: entry.key, name: entry.name, why: entry.why, differences: entry.differences, concern: entry.concern, confidence: entry.confidence, standing: entry.standing, modelStatus, comparison };
  });

  // Evidence nobody uses is dropped: no orphan citations.
  const used = new Set([...prices.map((item) => item.evidenceId), ...candidates.flatMap((entry) => entry.comparison.map((row) => row.evidenceId))].filter(Boolean));
  const evidence = evidenceAll.filter((entry) => used.has(entry.id));

  let valuation = projectValuation(body.pricing.valuation, { prices, candidates, requirements });
  const withheldValuation = valuation === null;
  if (withheldValuation) valuation = insufficientValuation();
  const rejections = withDemotions(projectRejections(body.pricing.rejections), demotedRequirements);

  // Only the engine's own-input warnings are kept as sent; the rest are recomputed below from what survived, so none can describe a
  // valuation or candidate this projection has since replaced.
  const warnings = (Array.isArray(body.warnings) ? body.warnings : []).filter((code) => BASE_WARNING_CODES.includes(code)).slice(0, BASE_WARNING_CODES.length);
  const addWarning = (code) => { if (!warnings.includes(code)) warnings.push(code); };
  const derived = [];
  if (unidentified) derived.push("PRODUCT_NOT_IDENTIFIED");
  if (candidates.some((entry) => !entry.differences)) derived.push("DIFFERENCES_MISSING");
  if (rejections.some((row) => row.action === "REJECTED" && ["EVIDENCE", "PRICE", "COMPARISON"].includes(row.scope))) derived.push("PRICE_EVIDENCE_REJECTED");
  if (valuation.excluded.some((row) => row.reason.endsWith("ESSENTIAL_SHORTFALL"))) derived.push("CANDIDATE_EXCLUDED_ESSENTIAL");
  if (candidates.some((entry) => entry.modelStatus === "UNVERIFIED_MODEL")) derived.push("MODEL_NOT_VERIFIED");
  if (["HISTORICAL_TIER_ESTIMATE", "AI_ESTIMATE_ONLY"].includes(valuation.method)) derived.push("VALUATION_ESTIMATE_ONLY");
  if (valuation.method === "INSUFFICIENT") derived.push("VALUATION_INSUFFICIENT");
  derived.forEach(addWarning);

  const publicOf = ({ key, standing, ...rest }) => ({ ...rest, ...(key === "SUCCESSOR" ? { standing } : {}), verified: false });
  const successor = candidates.find((entry) => entry.key === "SUCCESSOR");
  const suggestions = candidates.filter((entry) => entry.key !== "SUCCESSOR");
  const disclosure = typeof body.disclosure === "string" && clean(body.disclosure) && clean(body.disclosure).length <= MAX_DISCLOSURE ? clean(body.disclosure) : FALLBACK_DISCLOSURE;
  const category = oneOf(body.category, CATEGORIES) || "unknown";
  return {
    contractVersion: CONTRACT_VERSION,
    kind: KIND,
    status: unidentified ? "GUIDANCE_ONLY" : (status === "OK" && !successor && !suggestions.length ? "PARTIAL" : status),
    category,
    profile: oneOf(body.profile, PROFILES) || "unknown",
    original: {
      identity,
      confidence: oneOf(typeof body.original.confidence === "string" ? body.original.confidence.toUpperCase() : "", CONFIDENCES) || "LOW",
      characteristics: safeList(body.original.characteristics, 4),
      uncertainty: safeText(body.original.uncertainty)
    },
    requirements,
    requirementsSource: requirements.some((item) => item.origin === "AI_ESTIMATE") ? "AI_ESTIMATE_PLUS_CATEGORY_GUIDANCE" : "CATEGORY_GUIDANCE",
    successor: successor ? publicOf(successor) : null,
    suggestions: suggestions.map(publicOf),
    pricing: { referenceDate, tier: projectTier(body.pricing.tier, prices), prices, evidence, valuation, rejections },
    clarify: safeList(body.clarify, 2),
    disclosure,
    warnings,
    meta: {
      requestId,
      elapsedMs: Math.min(MAX_ELAPSED_MS, Math.max(0, Math.round(Number(elapsedMs)) || 0)),
      cached: meta.cached === true,
      answerSource,
      ...(fixture ? { fixture: true } : {})
    },
    quota
  };
}

module.exports = {
  projectResearch2, CONTRACT_VERSION, SOURCE_CLASSES, PRICE_KINDS, VERIFICATIONS, METHODS, MODEL_STATUSES, NOTE_PARAMS, REJECTION_REASONS, WARNING_CODES,
  CURRENT_PRICE_MAX_AGE_DAYS
};
