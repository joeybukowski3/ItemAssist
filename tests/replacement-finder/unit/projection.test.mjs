import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { engineComplete, engineBestAvailable, engineBestAvailableUnconfirmed, engineNoRetailReplacement, engineNoResult, deepKeys, retail } from "../endpoint/helpers.mjs";

const require = createRequire(import.meta.url);
const { projectResult, projectError } = require("../../../api/_lib/replacement-finder/projection.js");

const TOP_LEVEL = ["alternatives", "category", "comparison", "contractVersion", "meta", "needsVerification", "original", "primary", "retrievalQuality", "sources", "status", "warnings"];

test("18: an allowlisted engine contract passes through with its content intact", () => {
  const source = engineComplete();
  const result = projectResult(source);
  assert.deepEqual(Object.keys(result).sort(), TOP_LEVEL);
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.primary.displayName, "Samsung QN55Q80D");
  assert.equal(result.primary.isBestAvailableOnly, false);
  assert.deepEqual(result.comparison.map((row) => [row.key, row.importance, row.assessment.code]), source.comparison.map((row) => [row.key, row.importance, row.assessment.code]));
  assert.equal(result.original.facts.length, 4);
  assert.equal(result.alternatives[0].differences.length, 1);
  assert.equal(projectResult(engineBestAvailable()).primary.isBestAvailableOnly, true, "best-available is preserved");
  const none = projectResult(engineNoResult());
  assert.deepEqual([none.status, none.primary, none.comparison, none.alternatives], ["NO_RESULT", null, [], []]);
});

test("19: unknown keys are dropped at every level", () => {
  const source = engineComplete();
  source.surprise = "LEAK_TOP";
  source.original.surprise = "LEAK_ORIG";
  source.original.facts[0].surprise = "LEAK_FACT";
  source.primary.surprise = "LEAK_PRIMARY";
  source.comparison[0].surprise = "LEAK_ROW";
  source.comparison[0].assessment.surprise = "LEAK_ASSESS";
  source.alternatives[0].surprise = "LEAK_ALT";
  source.warnings = [{ code: "X", severity: "INFO", message: "m", surprise: "LEAK_WARN" }];
  source.needsVerification[0].surprise = "LEAK_NEED";
  source.sources[0].surprise = "LEAK_SRC";
  source.meta.surprise = "LEAK_META";
  const result = projectResult(source);
  assert.equal(JSON.stringify(result).includes("surprise"), false);
  assert.equal(JSON.stringify(result).includes("LEAK_"), false);
  assert.equal("refinements" in result, false, "refinements are not part of the browser contract");
});

test("20: diagnostics and internal keys cannot leak, even when the engine misbehaves", () => {
  const leaky = engineComplete();
  Object.assign(leaky, { diagnostics: { queries: ["secret query"] }, evidenceRefs: ["ev-1"], candidateId: "c-1", cacheKey: "replacement-finder:result:v1", redisKey: "k", providerRank: 1,
    rejectedSummary: [1], rankingExplanation: [1], internalCandidatePool: [1], stack: "Error: at /srv/app.js", error: "raw error", SERPER_API_KEY: "abc" });
  leaky.primary.evidenceRefs = ["ev-2"]; leaky.primary.candidateId = "c-2"; leaky.comparison[0].evidenceRefs = ["ev-3"];
  const result = projectResult(leaky);
  const json = JSON.stringify(result);
  for (const secret of ["secret query", "ev-1", "ev-2", "ev-3", "c-1", "c-2", "replacement-finder:result", "srv/app.js", "raw error", "abc", "diagnostics", "stack"]) {
    assert.equal(json.includes(secret), false, secret);
  }
  for (const key of ["diagnostics", "evidenceRefs", "candidateId", "cacheKey", "redisKey", "providerRank", "rejectedSummary", "rankingExplanation", "internalCandidatePool", "stack", "error", "refinements", "engineVersion", "profileVersion"]) {
    assert.equal(deepKeys(result).has(key), false, key);
  }
});

test("21: source URLs stay constrained: https, accepted host, no credentials, port, query or fragment", () => {
  const source = engineComplete();
  source.sources = [
    { domain: "samsung.com", url: "https://www.samsung.com/us/tvs/good/?utm=x&t=secret#frag", role: "ORIGINAL" },
    { domain: "samsung.com", url: "http://www.samsung.com/us/tvs/plain-http/", role: "SUPPORT" },
    { domain: "samsung.com", url: "https://evil.example.com/us/tvs/", role: "SUPPORT" },
    { domain: "samsung.com", url: "https://samsung.com.evil.example/x", role: "SUPPORT" },
    { domain: "samsung.com", url: "https://user:pw@www.samsung.com/x", role: "SUPPORT" },
    { domain: "samsung.com", url: "https://www.samsung.com:8443/x", role: "SUPPORT" },
    { domain: "samsung.com", url: "javascript:alert(1)", role: "SUPPORT" },
    { domain: "samsung.com", url: "https://www.lg.com/us/refrigerators/ok/", role: "NOT_A_ROLE" },
    { domain: "evil.example", url: "https://www.bestbuy.com/site/ok/1.p", role: "REPLACEMENT" },
    { domain: "samsung.com", url: 42, role: "SUPPORT" }
  ];
  const result = projectResult(source);
  assert.deepEqual(result.sources, [
    { domain: "samsung.com", url: "https://www.samsung.com/us/tvs/good/", role: "ORIGINAL" },
    { domain: "bestbuy.com", url: "https://www.bestbuy.com/site/ok/1.p", role: "REPLACEMENT" }
  ], "the domain is recomputed from the URL, never taken from the claimed field");
  source.sources = Array.from({ length: 12 }, (_, index) => ({ domain: "samsung.com", url: `https://www.samsung.com/p${index}/`, role: "SUPPORT" }));
  assert.equal(projectResult(source).sources.length, 6);
});

test("22: alternatives stay capped at two, and other lists are bounded", () => {
  const source = engineComplete();
  source.alternatives = Array.from({ length: 6 }, (_, i) => ({ ...engineComplete().alternatives[0], model: `QN55X${i}`, displayName: `Samsung QN55X${i}`, differences: ["a", "b", "c", "d", "e"] }));
  source.comparison = Array.from({ length: 40 }, (_, i) => ({ ...engineComplete().comparison[0], key: `k${i}`, label: `Label ${i}` }));
  source.original.facts = Array.from({ length: 40 }, (_, i) => ({ key: `f${i}`, label: `Fact ${i}`, value: "v", status: "VERIFIED" }));
  source.warnings = Array.from({ length: 40 }, (_, i) => ({ code: `W${i}`, severity: "INFO", message: "m" }));
  source.needsVerification = Array.from({ length: 40 }, (_, i) => ({ key: `n${i}`, label: "L", reason: "UNKNOWN", message: "m" }));
  const result = projectResult(source);
  assert.equal(result.alternatives.length, 2);
  assert.ok(result.alternatives.every((alt) => alt.differences.length === 3));
  assert.equal(result.comparison.length, 12);
  assert.equal(result.original.facts.length, 16);
  assert.equal(result.warnings.length, 10);
  assert.equal(result.needsVerification.length, 10);
});

test("projection: invalid enumerations and shapes are dropped or rejected, never passed along", () => {
  const source = engineComplete();
  source.comparison[0].assessment.code = "NOPE";
  source.comparison[1].importance = "HARD";
  source.original.facts[0].status = "KNOWN";
  source.alternatives[0].classification = "BEST";
  source.warnings = [{ code: "X", severity: "FATAL", message: "m" }];
  source.needsVerification[0].reason = "SOMETHING";
  const result = projectResult(source);
  assert.equal(result.comparison.some((row) => ["NOPE"].includes(row.assessment.code) || row.importance === "HARD"), false);
  assert.equal(result.original.facts.some((fact) => fact.status === "KNOWN"), false, "internal KNOWN is not a public status");
  assert.deepEqual([result.alternatives, result.warnings, result.needsVerification], [[], [], []]);

  for (const bad of [null, undefined, "x", 5, [], {}, { ...engineComplete(), contractVersion: "2" }, { ...engineComplete(), status: "ERROR" }, { ...engineComplete(), category: "washer" },
    { ...engineComplete(), original: null }, { ...engineComplete(), primary: { garbage: true } }]) {
    assert.equal(projectResult(bad), null, JSON.stringify(bad)?.slice(0, 60));
  }
});

test("projection: strings are control-character free and length capped, and markup is left as inert text", () => {
  const source = engineComplete();
  source.primary.explanation = `<img src=x onerror=alert(1)>${"x".repeat(1000)}\u0000\u0007`;
  source.original.facts[0].value = "a\u0000b\nc";
  const result = projectResult(source);
  assert.ok(result.primary.explanation.length <= 420);
  assert.equal(/[\u0000-\u0008\u000b-\u001f]/.test(JSON.stringify(result.primary.explanation)), false);
  assert.equal(result.original.facts[0].value, "a b c");
  assert.ok(result.primary.explanation.startsWith("<img"), "text is preserved verbatim; rendering is textContent-only");
});

test("projectError builds the single error shape the browser sees", () => {
  assert.deepEqual(projectError("RATE_LIMITED", "req-1"), { contractVersion: "1", status: "ERROR", errorCode: "RATE_LIMITED", message: "You've reached the lookup limit for now. Please try again in about 10 minutes.", requestId: "req-1" });
  assert.equal(projectError("UNSUPPORTED", "r").status, "UNSUPPORTED");
  assert.equal(projectError("whatever", "r").message, "We couldn't complete this lookup. Please try again.");
});

// ---- retail evidence and recommendation level (additive to contract version 1) ------------------------------------------

test("retail: the recommendation level and availability evidence reach the browser field by field", () => {
  const result = projectResult(engineBestAvailableUnconfirmed());
  assert.equal(result.primary.recommendationLevel, "BEST_AVAILABLE");
  assert.deepEqual(result.primary.retail, {
    statusLabel: "AVAILABLE NEW", condition: "NEW", purchaseStatus: "AVAILABLE", catalogStatus: "CURRENT", sellerType: "MANUFACTURER",
    sourceName: "Samsung.com", sourceDomain: "samsung.com", sourceUrl: "https://www.samsung.com/us/tvs/qn80h/",
    observedPrice: { amount: 999.99, currency: "USD" }, observedAt: "2026-10-11T14:30:00.000Z"
  });
  assert.deepEqual(result.warnings.map((warning) => warning.code), ["NO_CONFIRMED_LKQ", "ORIGINAL_SOURCE_NON_US"]);
  assert.equal(projectResult(engineComplete()).primary.recommendationLevel, "RECOMMENDED");
  assert.equal(projectResult(engineComplete()).alternatives[0].retail.sourceDomain, "bestbuy.com");
  const none = projectResult(engineNoRetailReplacement());
  assert.deepEqual([none.status, none.primary, none.warnings[0].code], ["NO_RESULT", null, "NO_CURRENT_RETAIL_REPLACEMENT"]);
});

test("retail: an older engine response without retail fields projects to null instead of inventing availability", () => {
  const source = engineComplete();
  delete source.primary.retail; delete source.primary.recommendationLevel; delete source.alternatives[0].retail;
  const result = projectResult(source);
  assert.equal(result.primary.retail, null);
  assert.equal(result.primary.recommendationLevel, "RECOMMENDED", "falls back to isBestAvailableOnly");
  assert.equal(projectResult({ ...source, primary: { ...source.primary, isBestAvailableOnly: true } }).primary.recommendationLevel, "BEST_AVAILABLE");
  assert.equal(result.alternatives[0].retail, null);
});

test("level: a missing, garbled or contradictory signal never reads as RECOMMENDED", () => {
  const level = (patch) => { const source = engineComplete(); Object.assign(source.primary, patch); return projectResult(source).primary; };
  assert.equal(level({ recommendationLevel: "RECOMMENDED", isBestAvailableOnly: true }).recommendationLevel, "BEST_AVAILABLE", "either best-available signal wins");
  assert.equal(level({ recommendationLevel: "RECOMMENDED", isBestAvailableOnly: true }).isBestAvailableOnly, true);
  assert.equal(level({ recommendationLevel: "BEST_AVAILABLE", isBestAvailableOnly: false }).recommendationLevel, "BEST_AVAILABLE");
  assert.equal(level({ recommendationLevel: undefined, isBestAvailableOnly: undefined }).recommendationLevel, "BEST_AVAILABLE");
  assert.equal(level({ recommendationLevel: "SOMETHING", isBestAvailableOnly: "no" }).recommendationLevel, "BEST_AVAILABLE");
  assert.equal(level({ recommendationLevel: undefined, isBestAvailableOnly: false }).recommendationLevel, "RECOMMENDED", "an explicit false is a signal");
  const source = engineComplete();
  delete source.alternatives[0].recommendationLevel;
  assert.equal(projectResult(source).alternatives[0].recommendationLevel, "BEST_AVAILABLE", "an alternative with no level is not promoted");
});

test("retail: only new, current, available, first-party evidence on an accepted https host is forwarded", () => {
  const bad = [
    retail({ condition: "USED" }), retail({ purchaseStatus: "OUT_OF_STOCK" }), retail({ catalogStatus: "DISCONTINUED" }), retail({ sellerType: "MARKETPLACE" }),
    retail({ sourceUrl: "http://www.samsung.com/us/tvs/x/" }), retail({ sourceUrl: "https://evil.example.com/p" }), retail({ sourceUrl: null }), retail({ sourceUrl: undefined }), retail({ sourceUrl: "https://user:pw@www.samsung.com/x" }), "garbage", 7, []
  ];
  for (const candidate of bad) {
    const source = engineComplete();
    source.primary.retail = candidate;
    assert.equal(projectResult(source).primary.retail, null, JSON.stringify(candidate)?.slice(0, 70));
  }
});

test("retail: price, timestamp and strings are validated, bounded and stripped of unknown keys", () => {
  const source = engineComplete();
  source.primary.retail = { ...retail({ observedPrice: { amount: -5, currency: "USD" }, observedAt: "not a date", sourceName: `Sam\u0000sung${"x".repeat(200)}` }), secret: "LEAK_RETAIL", productId: "sku-1" };
  const result = projectResult(source);
  assert.equal(result.primary.retail.observedPrice, null);
  assert.equal(result.primary.retail.observedAt, null);
  assert.ok(result.primary.retail.sourceName.length <= 60 && !result.primary.retail.sourceName.includes("\u0000"));
  assert.equal(JSON.stringify(result).includes("LEAK_RETAIL"), false);
  assert.equal(deepKeys(result).has("productId"), false);
  for (const amount of ["999.99", true, [5], null]) {
    source.primary.retail = retail({ observedPrice: { amount, currency: "USD" } });
    assert.equal(projectResult(source).primary.retail.observedPrice, null, `amount ${JSON.stringify(amount)} is not a price`);
  }
  source.primary.retail = retail({ observedPrice: { amount: 12.345, currency: "usd" } });
  assert.equal(projectResult(source).primary.retail.observedPrice, null, "currency must be an ISO code");
  source.primary.retail = retail({ observedPrice: { amount: 1299.999, currency: "USD" } });
  assert.deepEqual(projectResult(source).primary.retail.observedPrice, { amount: 1300, currency: "USD" });
});

// ---- observedAt validation and statusLabel fallback -------------------------------------------------------------------------

const projectRetailWith = (patch) => {
  const source = engineComplete();
  source.primary.retail = retail(patch);
  return projectResult(source).primary.retail;
};

test("observedAt: a valid ISO date-time with a zone is forwarded exactly as given", () => {
  for (const value of ["2026-10-11T14:30:00.000Z", "2026-10-11T14:30:00Z", "2026-10-11T14:30Z", "2026-10-11T16:30:00+02:00", "2028-02-29T00:00:00Z"]) {
    assert.equal(projectRetailWith({ observedAt: value }).observedAt, value, value);
  }
});

test("observedAt: anything that is not a real, unambiguous date-time becomes null, never a guess or a substitute", () => {
  const invalid = [
    "not a date", "", "   ", "2026", "2026-10-11", "Oct 11, 2026", "10/11/2026", "2026-10-11T14:30:00", "2026-10-11 14:30:00Z",
    "2026-02-30T00:00:00Z", "2026-02-29T00:00:00Z", "2026-13-01T00:00:00Z", "2026-00-10T00:00:00Z", "2026-10-00T00:00:00Z", "2026-10-11T24:00:00Z",
    "2026-10-11T14:60:00Z", "2026-10-11T14:30:60Z", "2026-10-11T14:30:00+25:00", "1999-12-31T23:59:00Z", "2101-01-01T00:00:00Z",
    "2026-10-11T14:30:00Z; DROP TABLE", `2026-10-11T14:30:00Z${" ".repeat(60)}`, "2026-10-11T14:30:00Z\u0000",
    1791743400000, true, {}, [], ["2026-10-11T14:30:00Z"], null, undefined
  ];
  for (const value of invalid) {
    const result = projectRetailWith({ observedAt: value });
    assert.notEqual(result, null, "the retail evidence itself is still valid without a date");
    assert.equal(result.observedAt, null, `observedAt ${JSON.stringify(value)}`);
  }
  assert.equal(projectRetailWith({ observedAt: "garbage" }).observedPrice.amount, 999.99, "a bad date does not change the price observation");
});

test("statusLabel: a known label is kept; unknown, malformed or missing values become one fixed neutral label", () => {
  assert.equal(projectRetailWith({ statusLabel: "AVAILABLE NEW" }).statusLabel, "AVAILABLE NEW");
  const fallback = "AVAILABILITY OBSERVED";
  for (const value of ["IN STOCK AT WALMART", "RECOMMENDED", "VERIFIED", "available new", " AVAILABLE NEW", "internal: backend-status-7", "<b>x</b>", "AVAILABLE NEW".repeat(20), "", null, undefined, 7, {}, ["AVAILABLE NEW"]]) {
    const result = projectRetailWith({ statusLabel: value });
    assert.equal(result.statusLabel, fallback, `statusLabel ${JSON.stringify(value)}`);
    assert.doesNotMatch(result.statusLabel, /verified|recommended/i, "never a stronger claim");
  }
  const source = engineComplete();
  source.primary.retail = retail({ statusLabel: "secret-internal-state-LEAK_STATUS" });
  assert.equal(JSON.stringify(projectResult(source)).includes("LEAK_STATUS"), false, "raw backend text does not reach the browser");
});

test("contract: the retail record has exactly the allowlisted keys and nothing is spread from the engine object", () => {
  const source = engineComplete();
  source.primary.retail = { ...retail(), internalDiagnostic: "LEAK_DIAG", token: "LEAK_TOKEN", provider: { name: "LEAK_PROVIDER" }, rawHtml: "<b>LEAK_HTML</b>" };
  source.alternatives[0].retail = { ...retail(), providerRequestId: "LEAK_REQ" };
  const result = projectResult(source);
  const expected = ["catalogStatus", "condition", "observedAt", "observedPrice", "purchaseStatus", "sellerType", "sourceDomain", "sourceName", "sourceUrl", "statusLabel"];
  assert.deepEqual(Object.keys(result.primary.retail).sort(), expected);
  assert.deepEqual(Object.keys(result.alternatives[0].retail).sort(), expected);
  assert.deepEqual(Object.keys(result.primary).sort(), ["brand", "classification", "confidence", "displayName", "explanation", "isBestAvailableOnly", "model", "recommendationLevel", "retail"]);
  const serialized = JSON.stringify(result);
  for (const marker of ["LEAK_DIAG", "LEAK_TOKEN", "LEAK_PROVIDER", "LEAK_HTML", "LEAK_REQ"]) assert.equal(serialized.includes(marker), false, marker);
  // The source link has its query and fragment removed and the price is an observation with no link to the match result.
  source.primary.retail = retail({ sourceUrl: "https://www.samsung.com/us/tvs/qn80h/?utm=LEAK_QUERY#frag" });
  assert.equal(projectResult(source).primary.retail.sourceUrl, "https://www.samsung.com/us/tvs/qn80h/");
});
