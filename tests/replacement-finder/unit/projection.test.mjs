import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { engineComplete, engineBestAvailable, engineNoResult, deepKeys } from "../endpoint/helpers.mjs";

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
