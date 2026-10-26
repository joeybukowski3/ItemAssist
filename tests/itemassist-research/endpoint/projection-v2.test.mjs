import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { ENV, answering, buildFixture, invoke, post } from "../helpers.mjs";

// OFFLINE ONLY. research.2 projection: the engine's response is re-projected field by field, and every trust rule is applied again here.
// The golden file is produced by the backend's own builder (scripts are not run here), so an honest engine response must pass unchanged.
const require = createRequire(import.meta.url);
const { projectResearch, projectError } = require("../../../api/_lib/itemassist-research/projection.js");
const { REGISTRY } = require("../../../api/_lib/itemassist-research/sources.js");
const GOLDEN = JSON.parse(readFileSync(new URL("../fixtures/research2-golden.json", import.meta.url), "utf8"));
const CONTEXT = { requestId: "proxy-req-1", elapsedMs: 5, quota: null, allowFixture: true };

const clone = (value) => JSON.parse(JSON.stringify(value));
const engine = (id) => clone(GOLDEN.scenarios[id].engine);
const project = (body, context = CONTEXT) => projectResearch(body, context);
const mutate = (id, change) => { const body = engine(id); change(body); return body; };
const without = (value) => { const copy = clone(value); delete copy.meta; delete copy.quota; return copy; };
const canon = (value) => JSON.stringify(value, (key, item) => (item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map((name) => [name, item[name]])) : item));
const priceOf = (out, id) => out.pricing.prices.find((price) => price.id === id);

test("every golden scenario the engine builds is accepted unchanged", () => {
  assert.equal(Object.keys(GOLDEN.scenarios).length, 8);
  for (const [id, entry] of Object.entries(GOLDEN.scenarios)) {
    const out = project(clone(entry.engine));
    assert.ok(out, id);
    assert.equal(canon(without(out)), canon(without(entry.engine)), id);
    assert.equal(out.contractVersion, "research.2");
  }
});

test("the source registry copy holds every host the golden evidence cites, and 62 hosts", () => {
  assert.equal(REGISTRY.length, 62);
  const hosts = Object.values(GOLDEN.scenarios).flatMap((entry) => entry.engine.pricing.evidence.map((item) => item.sourceDomain));
  for (const host of hosts) assert.ok(REGISTRY.some(([domain]) => domain === host), host);
});

test("research.2 is accepted only as a demo fixture on a Preview: without allowFixture or the literal fixture marker it yields no response", () => {
  assert.equal(project(engine("tv-premium-oled")).meta.fixture, true);
  assert.equal(project(engine("tv-premium-oled"), { ...CONTEXT, allowFixture: false }), null, "not a Preview");
  assert.equal(project(engine("tv-premium-oled"), { ...CONTEXT, allowFixture: undefined }), null);
  assert.equal(project(engine("tv-premium-oled"), { ...CONTEXT, allowFixture: "true" }), null, "only the literal true");
  for (const marker of ["true", 1, null, undefined]) assert.equal(project(mutate("tv-premium-oled", (body) => { body.meta.fixture = marker; })), null, String(marker));
  assert.equal(project(mutate("tv-premium-oled", (body) => { delete body.meta.fixture; })), null, "a research.2 body with no fixture marker is a live claim, refused");
  assert.equal(project(mutate("tv-premium-oled", (body) => { delete body.meta; })), null);
});

test("an unknown contract version, kind or reference date yields no response at all", () => {
  assert.equal(project({ ...engine("tv-premium-oled"), contractVersion: "research.3" }), null);
  assert.equal(project({ ...engine("tv-premium-oled"), kind: "OTHER" }), null);
  assert.equal(project(mutate("tv-premium-oled", (body) => { body.pricing.referenceDate = "2026-13-40"; })), null);
  assert.equal(project(mutate("tv-premium-oled", (body) => { body.pricing.referenceDate = "2026-10-22T10:00:00Z"; })), null);
  assert.equal(project(mutate("tv-premium-oled", (body) => { delete body.pricing; })), null);
});

test("no unknown field survives, at any level", () => {
  const body = engine("fridge-constraints");
  body.leak = "TOP-LEAK"; body.original.leak = "ORIG-LEAK"; body.pricing.leak = "PRICING-LEAK"; body.pricing.valuation.leak = "VAL-LEAK";
  body.pricing.prices[1].leak = "PRICE-LEAK"; body.pricing.evidence[1].leak = "EVID-LEAK"; body.requirements[0].leak = "REQ-LEAK";
  body.successor.leak = "SUCC-LEAK"; body.successor.comparison[0].leak = "CMP-LEAK"; body.meta.leak = "META-LEAK"; body.pricing.tier.leak = "TIER-LEAK";
  body.pricing.valuation.range.leak = "RANGE-LEAK"; body.pricing.valuation.notes[0].leak = "NOTE-LEAK";
  const text = JSON.stringify(project(body));
  assert.equal(/LEAK/.test(text), false);
});

/* ---------- Evidence and links ---------- */

test("a source on an unregistered host, or over http, or with credentials or a port, never becomes a citation, and the price resting on it is withheld", () => {
  for (const url of ["https://evil.example/pd/1", "http://www.lowes.com/pd/1", "https://user:pw@www.lowes.com/", "https://www.lowes.com:8443/pd/1", "javascript:alert(1)", "https://lowes.com.evil.example/", ""]) {
    const out = project(mutate("fridge-constraints", (body) => { body.pricing.evidence[1].sourceUrl = url; }));
    assert.equal(priceOf(out, "p2"), undefined, url);
    assert.equal(out.pricing.evidence.some((item) => item.id === "e2"), false, url);
    assert.equal(out.pricing.valuation.method, "INSUFFICIENT", url);
    assert.equal(out.pricing.valuation.range, null, url);
    assert.ok(out.warnings.includes("VALUATION_INSUFFICIENT"), url);
  }
});

test("the link keeps only origin and path (no query string, fragment, or tracking), and the registry decides name, domain, class and first-party status", () => {
  const out = project(mutate("fridge-constraints", (body) => {
    Object.assign(body.pricing.evidence[1], {
      sourceUrl: "https://www.lowes.com/pd/item?utm_source=x&session=SECRET#frag", sourceName: "Samsung", sourceClass: "MANUFACTURER", sourceDomain: "samsung.com", firstParty: false
    });
  }));
  const item = out.pricing.evidence.find((entry) => entry.id === "e2");
  assert.equal(item.sourceUrl, "https://www.lowes.com/pd/item");
  assert.equal(JSON.stringify(out).includes("SECRET"), false);
  assert.deepEqual([item.sourceName, item.sourceDomain, item.sourceClass, item.firstParty], ["Lowe’s", "lowes.com", "RETAILER", true]);
});

test("a model relation the payload claims is recomputed from the models: a different model never supports a price", () => {
  const out = project(mutate("fridge-constraints", (body) => {
    Object.assign(body.pricing.evidence[1], { subjectModel: "XY-9999-OTHER", expectedModel: "DEMO-BESPOKE-28", modelRelation: "EXACT" });
  }));
  assert.equal(priceOf(out, "p2"), undefined);
  assert.equal(out.pricing.valuation.method, "INSUFFICIENT");
});

test("evidence with an invalid date or model is dropped, and evidence nothing uses is not shown", () => {
  const badDate = project(mutate("fridge-constraints", (body) => { body.pricing.evidence[0].publishedAt = "2021-02-30"; }));
  assert.equal(badDate.pricing.evidence.some((item) => item.id === "e1"), false);
  assert.equal(priceOf(badDate, "p1"), undefined);
  const orphan = project(mutate("fridge-constraints", (body) => {
    body.pricing.evidence.push({ ...clone(body.pricing.evidence[0]), id: "e9", sourceUrl: "https://www.samsung.com/us/other" });
  }));
  assert.equal(orphan.pricing.evidence.some((item) => item.id === "e9"), false);
});

/* ---------- Prices ---------- */

test("a 'current' price older than 14 days, undated, future-dated, or not observed is dropped, never shown as current", () => {
  for (const [label, change] of [
    ["stale", (price) => { price.asOf = "2026-09-01"; }],
    ["undated", (price) => { price.asOf = null; price.asOfBasis = "UNKNOWN"; }],
    ["future", (price) => { price.asOf = "2026-12-01"; }],
    ["published-not-observed", (price) => { price.asOfBasis = "PUBLISHED"; }],
    ["date-without-basis", (price) => { price.asOfBasis = "UNKNOWN"; }]
  ]) {
    const out = project(mutate("fridge-constraints", (body) => change(body.pricing.prices[1])));
    assert.equal(priceOf(out, "p2"), undefined, label);
    assert.notEqual(out.pricing.valuation.method, "VERIFIED_SINGLE", label);
  }
});

test("an estimate never cites a source and never carries a verification level", () => {
  const withSource = project(mutate("ambiguous-model", (body) => { body.pricing.prices[0].evidenceId = "e1"; }));
  assert.equal(priceOf(withSource, "p1"), undefined);
  const withVerification = project(mutate("ambiguous-model", (body) => { body.pricing.prices[0].verification = "VERIFIED_PAGE"; }));
  assert.equal(priceOf(withVerification, "p1"), undefined);
});

test("amounts must be sane USD: zero, negative, huge, non-numeric, non-USD, or a range on an observed price are dropped", () => {
  const cases = [
    ["zero", { currency: "USD", low: 0, high: 0 }], ["negative", { currency: "USD", low: -5, high: -5 }], ["huge", { currency: "USD", low: 1e9, high: 1e9 }],
    ["string", { currency: "USD", low: "2399", high: "2399" }], ["euro", { currency: "EUR", low: 2399, high: 2399 }], ["nan", { currency: "USD", low: null, high: null }],
    ["observed-range", { currency: "USD", low: 2000, high: 2400 }]
  ];
  for (const [label, amount] of cases) {
    const out = project(mutate("fridge-constraints", (body) => { body.pricing.prices[1].amount = amount; }));
    assert.equal(priceOf(out, "p2"), undefined, label);
  }
  const wide = project(mutate("ambiguous-model", (body) => { body.pricing.prices[0].amount = { currency: "USD", low: 100, high: 5000 }; }));
  assert.equal(priceOf(wide, "p1"), undefined, "an estimate band wider than 8x is refused");
});

test("a price whose kind does not fit its source class is dropped (a marketplace listing is never a current retail price)", () => {
  const out = project(mutate("fridge-constraints", (body) => {
    body.pricing.evidence[1].sourceUrl = "https://www.ebay.com/itm/1";
  }));
  assert.equal(priceOf(out, "p2"), undefined);
  assert.equal(out.pricing.valuation.method, "INSUFFICIENT");
});

test("a price cannot cite evidence about a different subject", () => {
  const out = project(mutate("fridge-constraints", (body) => { body.pricing.prices[1].evidenceId = "e3"; }));
  assert.equal(priceOf(out, "p2"), undefined);
});

/* ---------- Valuation ---------- */

test("verified is recomputed: provisional listings and estimates never become verified, whatever the payload says", () => {
  for (const id of ["tv-premium-oled", "washer-dimensions", "ambiguous-model", "sparse-estimate", "unsupported-claims", "insufficient"]) {
    const out = project(mutate(id, (body) => { body.pricing.valuation.verified = true; }));
    assert.equal(out.pricing.valuation.verified, false, id);
  }
  assert.equal(project(engine("tv-strong-retail")).pricing.valuation.verified, true);
  assert.equal(project(engine("fridge-constraints")).pricing.valuation.verified, true);
});

test("a method the surviving prices cannot support is replaced by 'insufficient evidence', never by a figure", () => {
  const promoted = project(mutate("tv-premium-oled", (body) => { body.pricing.valuation.method = "VERIFIED_MULTI"; body.pricing.valuation.basis = "VERIFIED_CURRENT_RETAIL"; }));
  assert.equal(promoted.pricing.valuation.method, "INSUFFICIENT");
  assert.equal(promoted.pricing.valuation.range, null);
  const mismatched = project(mutate("tv-premium-oled", (body) => { body.pricing.valuation.basis = "VERIFIED_CURRENT_RETAIL"; }));
  assert.equal(mismatched.pricing.valuation.method, "INSUFFICIENT");
  const unknownMethod = project(mutate("tv-premium-oled", (body) => { body.pricing.valuation.method = "GUESS"; }));
  assert.equal(unknownMethod.pricing.valuation.method, "INSUFFICIENT");
});

test("the range must equal what the comparables say; a tampered range is refused", () => {
  for (const [low, high] of [[1, 5000], [100, 120], [2399, 2400], [2400, 2399]]) {
    const out = project(mutate("fridge-constraints", (body) => { body.pricing.valuation.range.low = low; body.pricing.valuation.range.high = high; }));
    assert.equal(out.pricing.valuation.method, "INSUFFICIENT", `${low}-${high}`);
  }
  const noRange = project(mutate("fridge-constraints", (body) => { body.pricing.valuation.range = null; }));
  assert.equal(noRange.pricing.valuation.method, "INSUFFICIENT");
  const insufficientWithRange = project(mutate("insufficient", (body) => { body.pricing.valuation.range = { currency: "USD", low: 500, high: 900 }; }));
  assert.equal(insufficientWithRange.pricing.valuation.range, null);
});

test("the original's MSRP can never be a comparable: an MSRP promoted into the range is refused", () => {
  const out = project(mutate("fridge-constraints", (body) => {
    Object.assign(body.pricing.valuation, { comparables: [{ priceId: "p1", candidate: null, verification: "VERIFIED_PAGE" }], range: { currency: "USD", low: 2799, high: 2799 } });
  }));
  assert.equal(out.pricing.valuation.method, "INSUFFICIENT");
});

test("a candidate with a confirmed essential shortfall stays excluded however attractive its price", () => {
  // The GE side-by-side series is more expensive here; the washer's 29 inch model is cheaper. Neither may set the range.
  const fridge = project(engine("fridge-constraints"));
  assert.deepEqual(fridge.pricing.valuation.excluded.find((row) => row.candidate === "ALT_2"), { candidate: "ALT_2", reason: "CONFIRMED_ESSENTIAL_SHORTFALL" });
  const washer = project(engine("washer-dimensions"));
  assert.deepEqual(washer.pricing.valuation.excluded.find((row) => row.candidate === "ALT_2"), { candidate: "ALT_2", reason: "CONFIRMED_ESSENTIAL_SHORTFALL" });

  // Forged: the shortfall candidate's price is added as a comparable and the range lowered to it.
  const cheaper = project(mutate("washer-dimensions", (body) => {
    const cheap = body.pricing.prices.find((price) => price.candidate === "ALT_2");
    body.pricing.valuation.comparables.push({ priceId: cheap.id, candidate: "ALT_2", verification: cheap.verification });
    body.pricing.valuation.excluded = body.pricing.valuation.excluded.filter((row) => row.candidate !== "ALT_2");
    body.pricing.valuation.range.low = cheap.amount.low;
  }));
  assert.equal(cheaper.pricing.valuation.method, "INSUFFICIENT");
  // Forged: the exclusion is simply removed (a shortfall candidate must be excluded, with the right reason).
  const unexcluded = project(mutate("fridge-constraints", (body) => { body.pricing.valuation.excluded = body.pricing.valuation.excluded.filter((row) => row.candidate !== "ALT_2"); }));
  assert.equal(unexcluded.pricing.valuation.method, "INSUFFICIENT");
  const softened = project(mutate("fridge-constraints", (body) => { body.pricing.valuation.excluded.find((row) => row.candidate === "ALT_2").reason = "NO_CURRENT_PRICE"; }));
  assert.equal(softened.pricing.valuation.method, "INSUFFICIENT");
});

test("a shortfall that is only an AI estimate is a suspected shortfall and still excludes", () => {
  const out = project(mutate("fridge-constraints", (body) => {
    const row = body.suggestions[1].comparison.find((entry) => entry.requirementId === "r2");
    Object.assign(row, { basis: "AI_ESTIMATE", evidenceId: null });
    body.pricing.valuation.excluded.find((entry) => entry.candidate === "ALT_2").reason = "SUSPECTED_ESSENTIAL_SHORTFALL";
    body.pricing.valuation.notes = body.pricing.valuation.notes.map((note) => (note.code === "EXCLUDED_CONFIRMED_SHORTFALL" ? { ...note, code: "EXCLUDED_SUSPECTED_SHORTFALL" } : note));
  }));
  assert.equal(out.pricing.valuation.method, "VERIFIED_SINGLE");
  assert.equal(out.pricing.valuation.excluded.find((entry) => entry.candidate === "ALT_2").reason, "SUSPECTED_ESSENTIAL_SHORTFALL");
});

test("confidence is capped by the method: estimates are always low, one comparable never high", () => {
  assert.equal(project(mutate("sparse-estimate", (body) => { body.pricing.valuation.confidence = "HIGH"; })).pricing.valuation.confidence, "LOW");
  assert.equal(project(mutate("ambiguous-model", (body) => { body.pricing.valuation.confidence = "MEDIUM"; })).pricing.valuation.confidence, "LOW");
  assert.equal(project(mutate("fridge-constraints", (body) => { body.pricing.valuation.confidence = "HIGH"; })).pricing.valuation.confidence, "MEDIUM");
  assert.equal(project(mutate("fridge-constraints", (body) => { body.pricing.valuation.confidence = "SUPER"; })).pricing.valuation.confidence, "LOW");
});

test("valuation notes are codes and numbers only: unknown codes, free text and misleading notes are dropped, and the appraisal caveat is always last", () => {
  const out = project(mutate("sparse-estimate", (body) => {
    body.pricing.valuation.notes = [
      { code: "BASED_ON_VERIFIED", count: 3 }, { code: "ONE_COMPARABLE" }, { code: "SELLING_FAST" }, { code: "TIER_ESTIMATE_BAND", low: 0.65, high: 1.05, text: "Buy now at $9" },
      { code: "TIER_ESTIMATE_BAND", low: "cheap", high: 1 }, { code: "EXCLUDED_CONFIRMED_SHORTFALL", candidate: "ALT_9" }, { code: "TIER_ESTIMATE_BAND", low: 0.65, high: 1.05 }
    ];
  }));
  const codes = out.pricing.valuation.notes.map((note) => note.code);
  assert.deepEqual(codes, ["TIER_ESTIMATE_BAND", "NOT_AN_APPRAISAL"]);
  assert.equal(JSON.stringify(out.pricing.valuation.notes).includes("Buy now"), false);
  const missing = project(mutate("fridge-constraints", (body) => { body.pricing.valuation.notes = []; }));
  assert.deepEqual(missing.pricing.valuation.notes, [{ code: "NOT_AN_APPRAISAL" }]);
});

test("a count in a 'based on' note is the real number of comparables, not the payload's claim", () => {
  const out = project(mutate("tv-strong-retail", (body) => {
    body.pricing.valuation.notes = body.pricing.valuation.notes.map((note) => (note.code === "BASED_ON_VERIFIED" ? { ...note, count: 9 } : note));
  }));
  const based = out.pricing.valuation.notes.find((note) => note.code === "BASED_ON_VERIFIED");
  assert.equal(based.count, out.pricing.valuation.comparables.length);
});

test("an AI-only valuation keeps its estimate label and a tier-estimate keeps its original-price reference", () => {
  const ai = project(engine("ambiguous-model"));
  assert.equal(ai.pricing.valuation.method, "AI_ESTIMATE_ONLY");
  assert.equal(ai.pricing.valuation.verified, false);
  assert.ok(ai.pricing.prices.every((price) => price.kind === "AI_ESTIMATE" && price.verification === "NONE" && price.evidenceId === null));
  const tier = project(engine("sparse-estimate"));
  assert.equal(tier.pricing.valuation.reference.kind, "MSRP");
  assert.equal(project(mutate("sparse-estimate", (body) => { body.pricing.valuation.reference = null; })).pricing.valuation.method, "INSUFFICIENT");
  // A tier-estimate band far above the original's price is not a band the rules can produce.
  assert.equal(project(mutate("sparse-estimate", (body) => { body.pricing.valuation.range = { currency: "USD", low: 2000, high: 9000 }; })).pricing.valuation.method, "INSUFFICIENT");
});

test("the tier's basis is MSRP_EVIDENCE only when an original price actually backs it", () => {
  assert.equal(project(engine("fridge-constraints")).pricing.tier.basis, "MSRP_EVIDENCE");
  const out = project(mutate("fridge-constraints", (body) => { body.pricing.prices = body.pricing.prices.filter((price) => price.kind !== "MSRP"); body.pricing.valuation.reference = null; body.pricing.valuation.notes = body.pricing.valuation.notes.filter((note) => note.code !== "MSRP_CONTEXT_ONLY"); }));
  assert.equal(out.pricing.tier.basis, "AI_ESTIMATE");
  assert.deepEqual(project(mutate("fridge-constraints", (body) => { body.pricing.tier = { level: "UNKNOWN", basis: "MSRP_EVIDENCE" }; })).pricing.tier, { level: "UNKNOWN", basis: "UNKNOWN" });
});

/* ---------- Candidates and requirements ---------- */

test("a model status is never stronger than the evidence that survived", () => {
  const upgraded = project(mutate("sparse-estimate", (body) => { body.suggestions[0].modelStatus = "VERIFIED_LISTING"; }));
  assert.equal(upgraded.suggestions[0].modelStatus, "FAMILY_LEVEL", "no evidence behind a family name: it cannot be a listing");
  const unsupported = project(mutate("unsupported-claims", (body) => { body.successor.modelStatus = "VERIFIED_LISTING"; }));
  assert.equal(unsupported.successor.modelStatus, "UNVERIFIED_MODEL", "an exact-looking code with nothing behind it stays flagged");
  const exact = project(mutate("sparse-estimate", (body) => { body.suggestions[0].name = "Bosch SHX78B75UC"; body.suggestions[0].modelStatus = "FAMILY_LEVEL"; }));
  assert.equal(exact.suggestions[0].modelStatus, "UNVERIFIED_MODEL", "an exact-looking code with nothing behind it is flagged, even if the payload says it is a family");
  const forged = project(mutate("tv-premium-oled", (body) => { body.successor.modelStatus = "VERIFIED_LISTING"; }));
  assert.equal(forged.successor.modelStatus, "LISTED_PROVISIONAL", "a search listing supports a provisional status, never a verified one");
  assert.equal(project(engine("fridge-constraints")).successor.modelStatus, "VERIFIED_LISTING");
  assert.ok(project(engine("unsupported-claims")).warnings.includes("MODEL_NOT_VERIFIED"));
});

test("every candidate is an unverified suggestion, whatever the payload says", () => {
  const out = project(mutate("tv-strong-retail", (body) => { body.successor.verified = true; body.suggestions.forEach((item) => { item.verified = true; }); }));
  assert.equal(out.successor.verified, false);
  assert.ok(out.suggestions.every((item) => item.verified === false));
});

test("candidate text that carries a link, price, availability promise or LKQ assurance is withheld; a candidate with no usable name or reason is dropped", () => {
  const out = project(mutate("tv-premium-oled", (body) => {
    body.successor.why = "Buy at https://x.example for $999";
    body.suggestions[0].concern = "Currently in stock, guaranteed like kind and quality";
    body.suggestions[1].differences = "Priced at $500 today";
  }));
  assert.equal(out.successor, null, "the successor lost its reason, so it is dropped");
  assert.equal(out.suggestions[0].concern, null);
  assert.equal(out.suggestions[1].differences, null);
  assert.ok(out.warnings.includes("DIFFERENCES_MISSING"));
  // Keys follow the surviving candidates: the first surviving suggestion is ALT_1 again, and its comparison still resolves.
  assert.ok(out.suggestions.length >= 1);
});

test("a concern the proxy withholds can never leave the successor an unconditional first choice", () => {
  const out = project(mutate("tv-strong-retail", (body) => { body.successor.standing = "RECOMMENDED"; body.successor.concern = "Order now at https://x.example"; }));
  assert.equal(out.successor.standing, "CONDITIONAL");
});

test("essential requirements keep their importance and origin: an unsafe essential keeps its place under fixed wording, unknown importances are dropped", () => {
  const out = project(mutate("fridge-constraints", (body) => {
    body.requirements[0].text = "Capacity of $5000 at https://x.example";
    body.requirements[3].importance = "CRITICAL";
    body.requirements[4].id = "r99";
  }));
  assert.equal(out.requirements[0].importance, "ESSENTIAL");
  assert.equal(out.requirements[0].text, "Criterion text withheld");
  assert.equal(out.requirements[1].origin, "CATEGORY_RULE");
  assert.equal(out.requirements.some((item) => item.id === "r4" || item.id === "r99"), false);
});

test("a comparison row cannot be CONFIRMED without evidence, and a row for an unknown requirement is dropped", () => {
  const out = project(mutate("fridge-constraints", (body) => {
    body.successor.comparison[0].evidenceId = null;
    body.successor.comparison[1].evidenceId = "e9";
    body.successor.comparison.push({ requirementId: "r7", status: "MEETS", basis: "AI_ESTIMATE", evidenceId: null });
  }));
  assert.ok(out.successor.comparison.slice(0, 2).every((row) => row.basis === "AI_ESTIMATE" && row.evidenceId === null));
  assert.equal(out.successor.comparison.some((row) => row.requirementId === "r7"), false);
});

test("a confirmed shortfall hidden by downgrading the evidence behind it becomes only a suspected one, and still excludes", () => {
  const out = project(mutate("fridge-constraints", (body) => {
    const row = body.suggestions[1].comparison.find((entry) => entry.requirementId === "r2");
    row.evidenceId = "e9";
  }));
  // The engine said CONFIRMED_ESSENTIAL_SHORTFALL; with no evidence behind the row it is only suspected, which disagrees with the engine's reason: refused.
  assert.equal(out.pricing.valuation.method, "INSUFFICIENT");
});

/* ---------- Rejections ---------- */

test("rejections are fixed vocabulary with counts, never the rejected content", () => {
  const out = project(mutate("unsupported-claims", (body) => {
    body.pricing.rejections.push({ scope: "PRICE", reason: "Price of $5 at https://x.example", action: "REJECTED", count: 1 });
    body.pricing.rejections.push({ scope: "ELSEWHERE", reason: "WRONG_PRODUCT", action: "REJECTED", count: 1 });
    body.pricing.rejections.push({ scope: "PRICE", reason: "WRONG_PRODUCT", action: "DELETED", count: 1 });
    body.pricing.rejections.push({ scope: "PRICE", reason: "WRONG_PRODUCT", action: "REJECTED", count: 0 });
  }));
  assert.equal(out.pricing.rejections.length, GOLDEN.scenarios["unsupported-claims"].engine.pricing.rejections.length);
  assert.equal(JSON.stringify(out.pricing.rejections).includes("x.example"), false);
});

test("the unsupported-claims scenario ends estimate-only with every unsupported price kept out of the prices list", () => {
  const out = project(engine("unsupported-claims"));
  assert.equal(out.pricing.valuation.method, "AI_ESTIMATE_ONLY");
  assert.equal(out.pricing.valuation.verified, false);
  assert.ok(out.pricing.prices.every((price) => ["AI_ESTIMATE", "HISTORICAL_RETAIL"].includes(price.kind)), "the stale 'current' price was downgraded to a dated one");
  assert.equal(out.pricing.prices.some((price) => price.kind === "CURRENT_RETAIL_NEW" || price.verification === "VERIFIED_PAGE"), false);
  assert.ok(out.warnings.includes("PRICE_EVIDENCE_REJECTED"));
});

/* ---------- Through the route ---------- */

const PREVIEW_ENV = Object.freeze({ ...ENV, VERCEL_ENV: "preview" });

test("the proxy route returns the projected research.2 response, charged once, and keeps research.2 out of production unless the engine sends it", async () => {
  const fx = buildFixture({ env: PREVIEW_ENV, fetchImpl: answering(200, engine("fridge-constraints")) });
  const res = await invoke(fx.handler, post());
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.contractVersion, "research.2");
  assert.equal(res.json.pricing.valuation.method, "VERIFIED_SINGLE");
  assert.equal(res.json.meta.fixture, true);
  assert.equal(res.json.quota.charged, true);
  assert.equal(JSON.stringify(res.json).includes("engine-req-1"), false, "the engine's request id is replaced by the proxy's");
});

test("a forged research.2 body is projected, not relayed, and a body that cannot be projected is a failed call that is not charged", async () => {
  const forged = engine("fridge-constraints");
  forged.pricing.valuation.verified = true; forged.pricing.valuation.method = "SOMETHING_ELSE"; forged.leak = "ROUTE-LEAK";
  const ok = buildFixture({ env: PREVIEW_ENV, fetchImpl: answering(200, forged) });
  const res = await invoke(ok.handler, post());
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.stringify(res.json).includes("ROUTE-LEAK"), false);
  assert.equal(res.json.pricing.valuation.method, "INSUFFICIENT");

  const broken = engine("fridge-constraints");
  broken.pricing.referenceDate = "not-a-date";
  const bad = buildFixture({ env: PREVIEW_ENV, fetchImpl: answering(200, broken) });
  const failed = await invoke(bad.handler, post());
  assert.notEqual(failed.statusCode, 200);
  assert.equal(failed.json.status, "ERROR");
  assert.equal(failed.json.quota?.charged ?? false, false);
  assert.equal(JSON.stringify(projectError("ENGINE_ERROR", "r")).includes("research.2"), false, "errors keep the stable research.1 error envelope");
});

/* ---------- Live research.2: no fixture marker, only when the server switched it on, never page-confirmed ---------- */

const LIVE = { ...CONTEXT, allowFixture: false, allowLive: true };
const live = (id, change = () => {}) => mutate(id, (body) => { delete body.meta.fixture; change(body); });
const LIVE_ENV = Object.freeze({ ...ENV, ITEMASSIST_RESEARCH_LIVE_CONTRACT: "research.2" });

test("live research.2 is accepted only with the server switch on and no fixture marker, carries no demo indicator, and equals the engine's typed content", () => {
  const out = project(live("tv-premium-oled"), LIVE);
  assert.ok(out);
  assert.equal(Object.hasOwn(out.meta, "fixture"), false, "a live answer is never labelled a demo");
  assert.equal(canon(without(out)), canon(without(engine("tv-premium-oled"))), "this scenario carries no page confirmation, so nothing changes");
  assert.equal(project(live("tv-premium-oled")), null, "switch off");
  for (const flag of ["true", 1, "research.2", undefined, null]) assert.equal(project(live("tv-premium-oled"), { ...LIVE, allowLive: flag }), null, String(flag));
  for (const marker of [true, false, "true", null]) assert.equal(project(mutate("tv-premium-oled", (body) => { body.meta.fixture = marker; }), LIVE), null, `a fixture marker (${marker}) is never accepted as live`);
  assert.equal(project(live("tv-premium-oled", (body) => { delete body.meta; }), LIVE), null);
});

test("on the live path no price is page-confirmed, whatever the engine claims; the same body as a fixture keeps its confirmations", () => {
  assert.ok(project(engine("tv-strong-retail")).pricing.prices.some((price) => price.verification === "VERIFIED_PAGE"));
  const out = project(live("tv-strong-retail"), LIVE);
  assert.ok(out);
  assert.equal(out.pricing.prices.some((price) => price.verification === "VERIFIED_PAGE"), false);
  assert.equal(out.pricing.valuation.verified, false);
  assert.notEqual(out.pricing.valuation.method, "VERIFIED_MULTI");
});

// The engine's valuation when one family's prices set the headline and another family's, far apart, are listed separately.
const splitFamilies = (change = () => {}) => live("tv-strong-retail", (body) => {
  for (const price of body.pricing.prices) if (price.kind === "CURRENT_RETAIL_NEW") price.verification = "SEARCH_LISTING";
  body.pricing.prices.find((price) => price.id === "p4").amount = { currency: "USD", low: 2999, high: 2999 };
  body.pricing.valuation = {
    method: "PROVISIONAL_LISTINGS", basis: "PROVISIONAL_LISTINGS", verified: false, range: { currency: "USD", low: 1599, high: 1649 }, confidence: "MEDIUM", asOf: "2026-10-21",
    comparables: ["p2", "p3"].map((priceId) => ({ priceId, candidate: "SUCCESSOR", verification: "SEARCH_LISTING" })), excluded: [], reference: { priceId: "p1", kind: "MSRP" },
    notes: [{ code: "BASED_ON_LISTINGS", count: 2 }, { code: "LISTINGS_NOT_CONFIRMED" }, { code: "OTHER_FAMILIES_SEPARATE", count: 1 }, { code: "MSRP_CONTEXT_ONLY" }, { code: "NOT_AN_APPRAISAL" }]
  };
  change(body);
});

test("a range set by the lead family alone is accepted with its note, and the other family's price stays in the list without setting the range", () => {
  const out = project(splitFamilies(), LIVE);
  assert.ok(out);
  assert.deepEqual([out.pricing.valuation.method, out.pricing.valuation.range], ["PROVISIONAL_LISTINGS", { currency: "USD", low: 1599, high: 1649 }]);
  assert.deepEqual(out.pricing.valuation.comparables.map((row) => row.priceId), ["p2", "p3"]);
  assert.ok(out.pricing.valuation.notes.some((note) => note.code === "OTHER_FAMILIES_SEPARATE" && note.count === 1));
  assert.equal(priceOf(out, "p4").amount.low, 2999, "the alternative's own price is still shown, with its own source");
  assert.equal(out.pricing.valuation.excluded.length, 0);
  // A range that quietly includes the other family's price no longer equals what the comparables say, so it is refused rather than shown.
  const stretched = project(splitFamilies((body) => { body.pricing.valuation.range.high = 2999; }), LIVE);
  assert.equal(stretched.pricing.valuation.method, "INSUFFICIENT");
  // The note is only valid where a current price set the range.
  const estimateOnly = project(live("sparse-estimate", (body) => { body.pricing.valuation.notes.unshift({ code: "OTHER_FAMILIES_SEPARATE", count: 1 }); }), LIVE);
  assert.equal(estimateOnly.pricing.valuation.notes.some((note) => note.code === "OTHER_FAMILIES_SEPARATE"), false);
});

test("a listing marked size-not-confirmed is projected as an example only on a current listing, and can never be a comparable", () => {
  const unsizedBody = (change = () => {}) => live("tv-strong-retail", (body) => {
    for (const price of body.pricing.prices) if (price.kind === "CURRENT_RETAIL_NEW") price.verification = "SEARCH_LISTING";
    Object.assign(body.pricing.prices.find((price) => price.id === "p4"), { sizeConfirmed: false });
    body.pricing.prices.find((price) => price.id === "p1").sizeConfirmed = false;
    body.pricing.valuation = {
      method: "PROVISIONAL_LISTINGS", basis: "PROVISIONAL_LISTINGS", verified: false, range: { currency: "USD", low: 1599, high: 1649 }, confidence: "MEDIUM", asOf: "2026-10-21",
      comparables: ["p2", "p3"].map((priceId) => ({ priceId, candidate: "SUCCESSOR", verification: "SEARCH_LISTING" })), excluded: [], reference: { priceId: "p1", kind: "MSRP" },
      notes: [{ code: "BASED_ON_LISTINGS", count: 2 }, { code: "LISTINGS_NOT_CONFIRMED" }, { code: "NOT_AN_APPRAISAL" }]
    };
    change(body);
  });
  const out = project(unsizedBody(), LIVE);
  assert.equal(priceOf(out, "p4").sizeConfirmed, false, "the example keeps its mark");
  assert.equal(Object.hasOwn(priceOf(out, "p1"), "sizeConfirmed"), false, "a forged mark on the original's MSRP is dropped");
  assert.equal(Object.hasOwn(priceOf(out, "p2"), "sizeConfirmed"), false, "an ordinary price carries no mark");
  assert.deepEqual(out.pricing.valuation.range, { currency: "USD", low: 1599, high: 1649 });
  // An unsized listing among the comparables is refused, even when the range is made to match.
  const forged = project(unsizedBody((body) => {
    body.pricing.valuation.comparables.push({ priceId: "p4", candidate: "ALT_1", verification: "SEARCH_LISTING" });
    body.pricing.valuation.range = { currency: "USD", low: 1499, high: 1649 };
    body.pricing.valuation.notes[0].count = 3;
  }), LIVE);
  assert.equal(forged.pricing.valuation.method, "INSUFFICIENT");
  assert.equal(priceOf(forged, "p4").sizeConfirmed, false);
});

test("an undated listing of the original model is projected as undated context from a maker or retailer only, and can never be a replacement price or a comparable", () => {
  const withListing = (change = () => {}) => live("tv-premium-oled", (body) => {
    body.pricing.evidence.push({ id: "e5", subject: "ORIGINAL", sourceUrl: "https://www.plessers.com/bosch/shpm65z55n", publishedAt: null, observedAt: null, subjectModel: "SHPM65Z55N", expectedModel: "SHPM65Z55N" });
    body.pricing.prices.push({ id: "p5", kind: "ORIGINAL_LISTING", subject: "ORIGINAL", candidate: null, model: "SHPM65Z55N", amount: { currency: "USD", low: 1099, high: 1099 }, asOf: null, asOfBasis: "UNKNOWN", verification: "SEARCH_SNIPPET", evidenceId: "e5" });
    change(body);
  });
  const out = project(withListing(), LIVE);
  assert.deepEqual([priceOf(out, "p5").kind, priceOf(out, "p5").asOf, priceOf(out, "p5").asOfBasis, priceOf(out, "p5").subject], ["ORIGINAL_LISTING", null, "UNKNOWN", "ORIGINAL"], "it stays undated");
  assert.equal(out.pricing.valuation.comparables.some((row) => row.priceId === "p5"), false);
  assert.equal(out.pricing.evidence.find((entry) => entry.id === "e5").sourceName, "Plesser’s Appliances", "the name comes from the registry");
  // Wrong subject, wrong source class, or a forged range: dropped.
  assert.equal(priceOf(project(withListing((body) => { Object.assign(body.pricing.prices.at(-1), { subject: "REPLACEMENT", candidate: "SUCCESSOR" }); }), LIVE), "p5"), undefined, "a replacement cannot be an original listing");
  assert.equal(priceOf(project(withListing((body) => { body.pricing.evidence.at(-1).sourceUrl = "https://www.cnet.com/review/x"; }), LIVE), "p5"), undefined, "a review is not a seller");
  assert.equal(priceOf(project(withListing((body) => { Object.assign(body.pricing.prices.at(-1), { amount: { currency: "USD", low: 1000, high: 1200 } }); }), LIVE), "p5"), undefined, "an observed price is not a range");
  // Pushed into the valuation it is refused: the valuation falls back to "insufficient" rather than relaying a listing as a comparable.
  const forged = project(withListing((body) => { body.pricing.valuation.comparables.push({ priceId: "p5", candidate: null, verification: "SEARCH_SNIPPET" }); }), LIVE);
  assert.equal(forged.pricing.valuation.method, "INSUFFICIENT");
});

test("on the live path no comparison row is CONFIRMED and no model is VERIFIED_LISTING, whatever the engine claims; a demo fixture keeps both", () => {
  const rowsOf = (out) => [out.successor, ...out.suggestions].filter(Boolean).flatMap((entry) => entry.comparison);
  const demo = project(engine("tv-strong-retail"));
  assert.ok(rowsOf(demo).some((row) => row.basis === "CONFIRMED"), "precondition: the fixture carries confirmed rows");
  assert.equal(demo.successor.modelStatus, "VERIFIED_LISTING");
  const out = project(live("tv-strong-retail"), LIVE);
  assert.ok(out);
  assert.equal(rowsOf(out).some((row) => row.basis === "CONFIRMED" || row.evidenceId !== null), false);
  assert.notEqual(out.successor.modelStatus, "VERIFIED_LISTING");
  // A forged row on an otherwise honest live body: exact-model evidence in hand, still not a confirmation.
  const forged = project(live("tv-premium-oled", (body) => {
    body.pricing.evidence[1].subjectModel = "ABC123X"; body.pricing.evidence[1].expectedModel = "ABC123X"; body.pricing.evidence[1].modelRelation = "EXACT";
    body.successor.comparison[0] = { requirementId: body.successor.comparison[0].requirementId, status: "MEETS", basis: "CONFIRMED", evidenceId: "e2" };
  }), LIVE);
  assert.ok(forged);
  assert.equal(rowsOf(forged).some((row) => row.basis === "CONFIRMED"), false);
  assert.notEqual(forged.successor.modelStatus, "VERIFIED_LISTING");
});

test("source classification: BrandsMart USA and BJ's are retailers on their exact host only, and the proxy copy agrees with the engine's", () => {
  const { classifyHost, safeSourceUrl } = require("../../../api/_lib/itemassist-research/sources.js");
  for (const host of ["bjs.com", "www.bjs.com", "brandsmartusa.com", "www.brandsmartusa.com"]) assert.equal(classifyHost(host)?.sourceClass, "RETAILER", host);
  for (const host of ["shop.bjs.com", "us.bjs.com", "m.bjs.com", "products.bjs.com", "marketplace.bjs.com", "bjs.com.evil.example", "evilbjs.com",
    "shop.brandsmartusa.com", "marketplace.brandsmartusa.com", "brandsmartusa.com.evil.example", "evilbrandsmartusa.com"]) assert.equal(classifyHost(host), null, host);
  assert.equal(safeSourceUrl("https://shop.bjs.com/"), null);
  assert.equal(safeSourceUrl("https://www.bjs.com/")?.sourceName, "BJ’s Wholesale Club");
  assert.equal(classifyHost("shop.lg.com")?.sourceClass, "MANUFACTURER", "the established storefront rule is unchanged for other hosts");
  assert.equal(classifyHost("marketplace.walmart.com"), null);
});

test("the route relays a live research.2 answer when the server switch is on, and refuses the same body when it is off", async () => {
  const on = buildFixture({ env: LIVE_ENV, fetchImpl: answering(200, live("tv-premium-oled")) });
  const res = await invoke(on.handler, post());
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.contractVersion, "research.2");
  assert.equal(res.json.pricing.valuation.method, "PROVISIONAL_LISTINGS");
  assert.equal(Object.hasOwn(res.json.meta, "fixture"), false);
  assert.equal(res.json.quota.charged, true);
  const off = buildFixture({ env: ENV, fetchImpl: answering(200, live("tv-premium-oled")) });
  const refused = await invoke(off.handler, post());
  assert.notEqual(refused.statusCode, 200);
  assert.equal(refused.json.status, "ERROR");
  assert.equal(refused.json.quota?.charged ?? false, false);
  const preview = buildFixture({ env: { ...LIVE_ENV, VERCEL_ENV: "preview" }, fetchImpl: answering(200, live("tv-premium-oled")) });
  assert.equal(Object.hasOwn((await invoke(preview.handler, post())).json.meta, "fixture"), false, "a Preview with the switch on still labels only a marked body as a demo");
});

/* ---------- Correction pass: the proxy is never more permissive than the engine ---------- */

const { safeSourceUrl } = require("../../../api/_lib/itemassist-research/sources.js");
const rowOf = (out, key, requirementId) => (key === "SUCCESSOR" ? out.successor : out.suggestions[Number(key.slice(-1)) - 1]).comparison.find((row) => row.requirementId === requirementId);

test("a confirmed comparison must cite evidence about that candidate's own model: wrong-subject and unknown-relation evidence make it an estimate", () => {
  const wrongSubject = project(mutate("fridge-constraints", (body) => { body.successor.comparison[2] = { requirementId: "r3", status: "MEETS", basis: "CONFIRMED", evidenceId: "e1" }; }));
  assert.deepEqual([rowOf(wrongSubject, "SUCCESSOR", "r3").basis, rowOf(wrongSubject, "SUCCESSOR", "r3").evidenceId], ["AI_ESTIMATE", null], "the original's source is not about the successor");
  const unknownRelation = project(mutate("fridge-constraints", (body) => {
    body.pricing.evidence.find((entry) => entry.id === "e2").subjectModel = null;
    body.successor.comparison[2] = { requirementId: "r3", status: "MEETS", basis: "CONFIRMED", evidenceId: "e2" };
  }));
  assert.equal(rowOf(unknownRelation, "SUCCESSOR", "r3").basis, "AI_ESTIMATE", "a source whose model match is unknown confirms nothing");
  assert.equal(rowOf(project(engine("fridge-constraints")), "SUCCESSOR", "r1").basis, "CONFIRMED", "the honest row stays confirmed");
});

test("a confirmed shortfall resting on wrong-subject evidence is only a suspected one, so the engine's exclusion reason no longer reconciles", () => {
  const out = project(mutate("fridge-constraints", (body) => { body.suggestions[1].comparison.find((row) => row.requirementId === "r2").evidenceId = "e1"; }));
  assert.equal(rowOf(out, "ALT_2", "r2").basis, "AI_ESTIMATE");
  assert.equal(out.pricing.valuation.method, "INSUFFICIENT");
});

test("an exact-looking model code is never verified or priced from evidence that does not name that model", () => {
  const out = project(mutate("fridge-constraints", (body) => {
    body.successor.name = "Samsung RF28B5100SR";
    body.pricing.evidence.find((entry) => entry.id === "e2").subjectModel = null;
    body.pricing.evidence.find((entry) => entry.id === "e2").expectedModel = null;
  }));
  assert.equal(priceOf(out, "p2"), undefined, "no evidence about that model: no price");
  assert.equal(out.successor.modelStatus, "UNVERIFIED_MODEL");
  assert.ok(out.warnings.includes("MODEL_NOT_VERIFIED"));
  assert.deepEqual([out.pricing.valuation.method, out.pricing.valuation.verified], ["INSUFFICIENT", false]);
  // With evidence that does name it, the same name is fine.
  const named = project(mutate("fridge-constraints", (body) => { body.successor.name = "Samsung RF28B5100SR"; }));
  assert.equal(named.successor.modelStatus, "VERIFIED_LISTING");
  assert.equal(named.pricing.valuation.verified, true);
});

test("a page-level confirmation on evidence with an unknown model relation is downgraded to a listing and no longer supports a verified valuation", () => {
  const out = project(mutate("fridge-constraints", (body) => {
    const e2 = body.pricing.evidence.find((entry) => entry.id === "e2");
    e2.subjectModel = null; e2.expectedModel = null;
  }));
  assert.equal(priceOf(out, "p2").verification, "SEARCH_LISTING");
  assert.equal(out.successor.modelStatus, "FAMILY_LEVEL", "a source with no model match supports no model status, whatever the engine claimed");
  assert.equal(out.pricing.valuation.verified, false, "the engine's VERIFIED_SINGLE no longer reconciles with the downgraded price");
  assert.equal(out.pricing.valuation.method, "INSUFFICIENT");
});

test("an AI-added requirement can never be essential: it keeps its AI origin, drops to important, and is recorded", () => {
  const out = project(mutate("fridge-constraints", (body) => { body.requirements[1].origin = "AI_ESTIMATE"; }));
  assert.deepEqual([out.requirements[1].importance, out.requirements[1].origin], ["IMPORTANT", "AI_ESTIMATE"]);
  assert.equal(out.requirementsSource, "AI_ESTIMATE_PLUS_CATEGORY_GUIDANCE");
  assert.ok(out.pricing.rejections.some((row) => row.scope === "REQUIREMENT" && row.reason === "ESSENTIAL_FROM_AI_DOWNGRADED" && row.action === "DOWNGRADED"));
  // The engine's exclusion of the candidate that fell short of it rested on that requirement being essential, so it no longer reconciles.
  assert.equal(out.pricing.valuation.method, "INSUFFICIENT");
  // The claimed requirementsSource is not trusted either.
  assert.equal(project(mutate("fridge-constraints", (body) => { body.requirementsSource = "AI_ESTIMATE_PLUS_CATEGORY_GUIDANCE"; })).requirementsSource, "CATEGORY_GUIDANCE");
});

test("an essential-shortfall candidate's price cannot be added to the valuation, even with a range that matches it", () => {
  const out = project(mutate("fridge-constraints", (body) => {
    const value = body.pricing.valuation;
    value.comparables.push({ priceId: "p3", candidate: "ALT_2", verification: "VERIFIED_PAGE" });
    value.method = "VERIFIED_MULTI";
    value.range = { currency: "USD", low: 2399, high: 3299 };
  }));
  assert.equal(out.pricing.valuation.method, "INSUFFICIENT");
  assert.equal(out.pricing.valuation.range, null);
  assert.equal(out.pricing.valuation.verified, false);
});

test("MSRP cannot be promoted into a current verified valuation, even when the forged valuation is otherwise self-consistent", () => {
  const out = project(mutate("fridge-constraints", (body) => {
    Object.assign(body.pricing.valuation, {
      method: "VERIFIED_SINGLE", basis: "VERIFIED_CURRENT_RETAIL", verified: true, range: { currency: "USD", low: 2799, high: 2799 }, asOf: null,
      comparables: [{ priceId: "p1", candidate: null, verification: "VERIFIED_PAGE" }]
    });
  }));
  assert.deepEqual([out.pricing.valuation.method, out.pricing.valuation.verified, out.pricing.valuation.range], ["INSUFFICIENT", false, null]);
  // A past retail price of the original is refused the same way.
  const past = project(mutate("washer-dimensions", (body) => {
    Object.assign(body.pricing.valuation, { comparables: [{ priceId: "p1", candidate: null, verification: "SEARCH_SNIPPET" }], range: { currency: "USD", low: 1049, high: 1049 }, asOf: null });
  }));
  assert.equal(past.pricing.valuation.method, "INSUFFICIENT");
});

test("an AI-estimate-only valuation cannot point at retail prices or an original's price, however it is dressed", () => {
  const retail = project(mutate("tv-strong-retail", (body) => {
    Object.assign(body.pricing.valuation, {
      method: "AI_ESTIMATE_ONLY", basis: "AI_ESTIMATE", verified: false, range: { currency: "USD", low: 1599, high: 1599 },
      comparables: [{ priceId: "p2", candidate: "SUCCESSOR", verification: "VERIFIED_PAGE" }], reference: null
    });
  }));
  assert.equal(retail.pricing.valuation.method, "INSUFFICIENT", "a retail price is not an AI estimate");
  // An AI-only valuation that points at a real, sourced MSRP of the original is not one the engine can produce either.
  const withReference = project(mutate("ambiguous-model", (body) => {
    body.pricing.evidence.push({ id: "e1", subject: "ORIGINAL", sourceUrl: "https://www.samsung.com/us/", publishedAt: "2023-04-05", observedAt: null, subjectModel: "DEMO-S90C-65", expectedModel: "DEMO-S90C-65", sourceDomain: "samsung.com" });
    body.pricing.prices.push({ id: "p3", kind: "MSRP", subject: "ORIGINAL", candidate: null, model: "DEMO-S90C-65", amount: { currency: "USD", low: 2199, high: 2199 }, asOf: "2023-04-05", asOfBasis: "PUBLISHED", verification: "VERIFIED_PAGE", evidenceId: "e1" });
    body.pricing.valuation.reference = { priceId: "p3", kind: "MSRP" };
  }));
  assert.ok(priceOf(withReference, "p3"), "the MSRP itself is a valid context price");
  assert.equal(withReference.pricing.valuation.method, "INSUFFICIENT");
  const insufficientWithReference = project(mutate("insufficient", (body) => { body.pricing.valuation.reference = { priceId: "p1", kind: "MSRP" }; }));
  assert.equal(insufficientWithReference.pricing.valuation.reference, null);
});

test("an observation dated one day after the reference date is accepted, as the engine accepts it; two days is not", () => {
  const plusOne = project(mutate("fridge-constraints", (body) => {
    body.pricing.prices.find((price) => price.id === "p2").asOf = "2026-10-23";
    body.pricing.valuation.asOf = "2026-10-23";
  }));
  assert.equal(priceOf(plusOne, "p2").asOf, "2026-10-23");
  assert.equal(plusOne.pricing.valuation.method, "VERIFIED_SINGLE");
  const plusTwo = project(mutate("fridge-constraints", (body) => { body.pricing.prices.find((price) => price.id === "p2").asOf = "2026-10-24"; }));
  assert.equal(priceOf(plusTwo, "p2"), undefined);
  assert.equal(plusTwo.pricing.valuation.method, "INSUFFICIENT");
});

test("a model string that is not a model code is refused, whether on a price or on evidence", () => {
  for (const bad of ["www.evil.com/free-tv", "CALL 555 0100 NOW", "buy now 2", "<b>RF28</b>", "AB", "A".repeat(40) + "1"]) {
    const onPrice = project(mutate("fridge-constraints", (body) => { body.pricing.prices.find((price) => price.id === "p2").model = bad; }));
    assert.equal(priceOf(onPrice, "p2"), undefined, `price: ${bad}`);
    assert.equal(JSON.stringify(onPrice).includes(bad), false, `price: ${bad}`);
    const onEvidence = project(mutate("fridge-constraints", (body) => { body.pricing.evidence.find((entry) => entry.id === "e2").subjectModel = bad; }));
    assert.equal(onEvidence.pricing.evidence.some((entry) => entry.id === "e2"), false, `evidence: ${bad}`);
    assert.equal(JSON.stringify(onEvidence).includes(bad), false, `evidence: ${bad}`);
  }
  assert.equal(priceOf(project(mutate("fridge-constraints", (body) => { body.pricing.prices.find((price) => price.id === "p2").model = "RF28R7351SR/AA"; })), "p2").model, "RF28R7351SR/AA");
});

test("seller, marketplace, community and forum subdomains of a registered domain are not first-party sources; the domain and its storefront hosts are", () => {
  for (const url of ["https://marketplace.walmart.com/seller/1", "https://community.samsung.com/post", "https://forum.lg.com/", "https://stores.ebay.com/x", "https://seller.amazon.com/", "https://a.b.bestbuy.com/", "https://evil.lowes.com.example/", "https://lowes.com./pd"]) {
    assert.equal(safeSourceUrl(url), null, url);
  }
  for (const [url, sourceClass] of [["https://www.lowes.com/pd", "RETAILER"], ["https://shop.lg.com/us/tv", "MANUFACTURER"], ["https://www.samsung.com/us/", "MANUFACTURER"], ["https://www.ebay.com/itm/1", "MARKETPLACE"]]) {
    assert.equal(safeSourceUrl(url).sourceClass, sourceClass, url);
  }
  const out = project(mutate("fridge-constraints", (body) => { body.pricing.evidence.find((entry) => entry.id === "e2").sourceUrl = "https://marketplace.lowes.com/seller/9"; }));
  assert.equal(priceOf(out, "p2"), undefined, "a price resting on a seller subdomain is withheld");
});

test("warnings are recomputed after a valuation is replaced: none describes a valuation that is no longer shown", () => {
  const out = project(mutate("sparse-estimate", (body) => { body.pricing.valuation.range = { currency: "USD", low: 2000, high: 9000 }; }));
  assert.equal(out.pricing.valuation.method, "INSUFFICIENT");
  assert.equal(out.warnings.includes("VALUATION_ESTIMATE_ONLY"), false, "the engine's estimate warning no longer applies");
  assert.equal(out.warnings.includes("VALUATION_INSUFFICIENT"), true);
  const honest = project(engine("fridge-constraints"));
  assert.equal(honest.warnings.includes("VALUATION_INSUFFICIENT"), false);
  const claimed = project(mutate("fridge-constraints", (body) => { body.warnings.push("MODEL_NOT_VERIFIED", "VALUATION_ESTIMATE_ONLY"); }));
  assert.deepEqual(claimed.warnings.filter((code) => ["MODEL_NOT_VERIFIED", "VALUATION_ESTIMATE_ONLY"].includes(code)), [], "a derived warning the data does not support is not relayed");
});

test("the production route refuses research.2: no Preview, no response", async () => {
  const fx = buildFixture({ env: ENV, fetchImpl: answering(200, engine("fridge-constraints")) });
  const res = await invoke(fx.handler, post());
  assert.notEqual(res.statusCode, 200);
  assert.equal(res.json.status, "ERROR");
  assert.equal(JSON.stringify(res.json).includes("research.2"), false);
});
