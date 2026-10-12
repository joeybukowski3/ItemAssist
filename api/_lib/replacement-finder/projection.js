const RF = require("../../../assets/js/rf-shared.js");

/**
 * Defence in depth: the engine already returns a public-safe contract, but this layer re-projects it field by field.
 * Nothing is spread or forwarded from the engine response, so an unexpected or future field can never reach the browser.
 * Every string is stripped of control characters and length-capped; every enumeration is checked against the shared list.
 */

const CONTRACT_VERSION = "1";
const MAX_FACTS = 16;
const MAX_COMPARISON_ROWS = 12;
const MAX_ALTERNATIVES = 2;
const MAX_DIFFERENCES = 3;
const MAX_SOURCES = 6;
const MAX_NEEDS = 10;
const MAX_WARNINGS = 10;
const MAX_SHORT = 80;
const MAX_TEXT = 420;
const MAX_ELAPSED_MS = 600000;

// Hosts the engine itself accepts for the supported brands (manufacturer, authorized retailers, technical databases).
const ACCEPTED_SOURCE_HOSTS = Object.freeze([
  "samsung.com", "lg.com", "bestbuy.com", "abt.com", "crutchfield.com", "rtings.com", "homedepot.com", "lowes.com", "costco.com",
  "samsclub.com", "appliancesconnection.com", "ajmadison.com", "target.com", "walmart.com", "displayspecifications.com",
  "tftcentral.co.uk", "notebookcheck.net"
]);

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, max = MAX_SHORT) => (typeof value === "string" ? RF.clean(value).slice(0, max) : "");
const nullableText = (value, max = MAX_SHORT) => (typeof value === "string" && RF.clean(value) ? RF.clean(value).slice(0, max) : null);
const oneOf = (value, list) => (list.includes(value) ? value : null);
// Scan a bounded window, drop anything invalid, then cap: a few bad entries must not crowd out good ones, and a huge array is never walked in full.
const SCAN_FACTOR = 4;
const list = (value, max, mapper) => (Array.isArray(value) ? value.slice(0, max * SCAN_FACTOR).map(mapper).filter(Boolean).slice(0, max) : []);

function projectFact(item) {
  if (!isObject(item)) return null;
  const status = oneOf(item.status, RF.FACT_STATUSES);
  const key = text(item.key, 60);
  const label = text(item.label);
  return status && key && label ? { key, label, value: nullableText(item.value), status } : null;
}

function projectRow(item) {
  if (!isObject(item) || !isObject(item.assessment)) return null;
  const importance = oneOf(item.importance, RF.IMPORTANCES);
  const code = oneOf(item.assessment.code, RF.ASSESSMENT_CODES);
  const key = text(item.key, 60);
  const label = text(item.label);
  if (!importance || !code || !key || !label) return null;
  return {
    key, label, importance,
    original: nullableText(item.original), replacement: nullableText(item.replacement),
    assessment: { code, label: text(item.assessment.label, 40) || code },
    note: nullableText(item.note, 160)
  };
}

function projectNeed(item) {
  if (!isObject(item)) return null;
  const reason = oneOf(item.reason, RF.NEEDS_REASONS);
  const key = text(item.key, 60);
  const label = text(item.label);
  const message = text(item.message, 200);
  return reason && key && label && message ? { key, label, reason, message } : null;
}

function projectWarning(item) {
  if (!isObject(item)) return null;
  const severity = oneOf(item.severity, RF.SEVERITIES);
  const code = text(item.code, 40);
  const message = text(item.message, 240);
  return severity && code && message ? { code, severity, message } : null;
}

const SELLER_TYPES = Object.freeze(["RETAILER", "MANUFACTURER"]);
const RECOMMENDATION_LEVELS = Object.freeze(["RECOMMENDED", "BEST_AVAILABLE"]);
const RETAIL_STATUS_LABELS = Object.freeze(["AVAILABLE NEW"]);
const RETAIL_STATUS_FALLBACK = "AVAILABILITY OBSERVED"; // states no more than the record itself (a first-party source was observed); it claims nothing about the match
const MAX_SOURCE_NAME = 60;
const MAX_RETAIL_PRICE = 1000000;

function isAcceptedHost(domain) {
  return ACCEPTED_SOURCE_HOSTS.some((host) => domain === host || domain.endsWith(`.${host}`));
}

/** Source links: https only, no credentials or port, an accepted host (recomputed from the URL, never the claimed domain). */
function projectSource(item) {
  if (!isObject(item) || !RF.isSafeSourceUrl(item.url)) return null;
  const url = new URL(item.url);
  const domain = url.hostname.toLowerCase().replace(/^www\./, "");
  const role = oneOf(item.role, RF.SOURCE_ROLES);
  return isAcceptedHost(domain) && role ? { domain, url: `${url.origin}${url.pathname}`, role } : null;
}

/** Only labels the page knows are forwarded. Anything else, including a missing or malformed value, becomes the fixed neutral fallback. */
function projectStatusLabel(value) {
  return typeof value === "string" && RETAIL_STATUS_LABELS.includes(value) ? value : RETAIL_STATUS_FALLBACK;
}

function projectObservedPrice(price) {
  if (!isObject(price)) return null;
  const amount = typeof price.amount === "number" ? price.amount : NaN;
  const validCurrency = typeof price.currency === "string" && /^[A-Z]{3}$/.test(price.currency);
  return Number.isFinite(amount) && amount > 0 && amount < MAX_RETAIL_PRICE && validCurrency
    ? { amount: Math.round(amount * 100) / 100, currency: price.currency } : null;
}

/**
 * Availability evidence for a recommended or alternative model. Fails closed: anything other than new, currently available,
 * current-catalog stock from a first-party seller yields null, and a source link that is not on an accepted https host
 * voids the whole record. Price is an observation only and is never combined with any match result.
 */
function projectRetail(item) {
  if (!isObject(item)) return null;
  if (item.condition !== "NEW" || item.purchaseStatus !== "AVAILABLE" || item.catalogStatus !== "CURRENT") return null;
  const sellerType = oneOf(item.sellerType, SELLER_TYPES);
  if (!sellerType) return null;
  // No verifiable source means no availability claim: the evidence must point somewhere a reader can check it.
  const source = projectSource({ url: item.sourceUrl, role: "SUPPORT" });
  if (!source) return null;
  return {
    statusLabel: projectStatusLabel(item.statusLabel),
    condition: "NEW",
    purchaseStatus: "AVAILABLE",
    catalogStatus: "CURRENT",
    sellerType,
    sourceName: nullableText(item.sourceName, MAX_SOURCE_NAME) || source.domain,
    sourceDomain: source.domain,
    sourceUrl: source.url,
    observedPrice: projectObservedPrice(item.observedPrice),
    observedAt: RF.normalizeObservedAt(item.observedAt)
  };
}

/**
 * The level fails closed. Either signal saying "best available" wins, RECOMMENDED needs an explicit signal (the level, or an
 * explicit isBestAvailableOnly: false), and a missing or garbled signal reads as BEST_AVAILABLE, never as the stronger claim.
 */
function projectLevel(item) {
  const level = oneOf(item.recommendationLevel, RECOMMENDATION_LEVELS);
  if (level === "BEST_AVAILABLE" || item.isBestAvailableOnly === true) return "BEST_AVAILABLE";
  return level === "RECOMMENDED" || item.isBestAvailableOnly === false ? "RECOMMENDED" : "BEST_AVAILABLE";
}

function projectCandidate(item, withExplanation) {
  if (!isObject(item)) return null;
  const classification = oneOf(item.classification, RF.CLASSIFICATIONS);
  const confidence = oneOf(item.confidence, RF.CONFIDENCES);
  const brand = text(item.brand, 40);
  const model = text(item.model, 40);
  const displayName = text(item.displayName, 90);
  if (!classification || !confidence || !model || !displayName) return null;
  const base = { brand, model, displayName, classification, confidence };
  if (withExplanation) {
    const recommendationLevel = projectLevel(item);
    return { ...base, explanation: text(item.explanation, MAX_TEXT), isBestAvailableOnly: recommendationLevel === "BEST_AVAILABLE", recommendationLevel, retail: projectRetail(item.retail) };
  }
  return {
    ...base, role: text(item.role, 40), roleLabel: text(item.roleLabel, 60), differences: list(item.differences, MAX_DIFFERENCES, (entry) => nullableText(entry, 160)),
    recommendationLevel: oneOf(item.recommendationLevel, RECOMMENDATION_LEVELS) || "BEST_AVAILABLE", retail: projectRetail(item.retail)
  };
}

/**
 * @param {unknown} body parsed engine JSON
 * @returns {object|null} the browser-safe result, or null when the body is not a usable engine result
 */
function projectResult(body) {
  if (!isObject(body) || body.contractVersion !== CONTRACT_VERSION) return null;
  const status = oneOf(body.status, RF.STATUSES);
  const category = Object.prototype.hasOwnProperty.call(RF.SUPPORT, body.category) ? body.category : null;
  if (!status || !category || !isObject(body.original)) return null;

  const primary = body.primary === null || body.primary === undefined ? null : projectCandidate(body.primary, true);
  if (body.primary && !primary) return null;
  const meta = isObject(body.meta) ? body.meta : {};
  return {
    contractVersion: CONTRACT_VERSION,
    status,
    category,
    retrievalQuality: oneOf(body.retrievalQuality, RF.RETRIEVAL_QUALITIES) || "FAILED",
    original: {
      brand: text(body.original.brand, 40),
      model: text(body.original.model, 40),
      displayName: text(body.original.displayName, 90),
      facts: list(body.original.facts, MAX_FACTS, projectFact)
    },
    primary,
    comparison: primary ? list(body.comparison, MAX_COMPARISON_ROWS, projectRow) : [],
    alternatives: primary ? list(body.alternatives, MAX_ALTERNATIVES, (entry) => projectCandidate(entry, false)) : [],
    warnings: list(body.warnings, MAX_WARNINGS, projectWarning),
    needsVerification: list(body.needsVerification, MAX_NEEDS, projectNeed),
    sources: list(body.sources, MAX_SOURCES, projectSource),
    meta: {
      requestId: text(meta.requestId, 64),
      elapsedMs: Number.isFinite(meta.elapsedMs) ? Math.min(MAX_ELAPSED_MS, Math.max(0, Math.round(meta.elapsedMs))) : 0,
      cached: meta.cached === true
    }
  };
}

/** The only error shape the browser ever sees from the proxy. */
function projectError(code, requestId) {
  return {
    contractVersion: CONTRACT_VERSION,
    status: code === "UNSUPPORTED" ? "UNSUPPORTED" : "ERROR",
    errorCode: code,
    message: RF.errorMessage(code),
    requestId: requestId || ""
  };
}

module.exports = { projectResult, projectError, ACCEPTED_SOURCE_HOSTS, MAX_ALTERNATIVES, MAX_SOURCES, MAX_COMPARISON_ROWS };
