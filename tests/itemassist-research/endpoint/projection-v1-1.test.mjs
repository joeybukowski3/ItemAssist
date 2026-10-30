import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

// OFFLINE ONLY. V1.1 additions to the research.2 projection: a laptop listing whose configuration was not matched is an example that can never set
// the range, the engine's note about listings left out for their spread is carried, and a request that failed at the provider is reported as
// that and not as an unknown product. The golden engine bodies are the backend's own.
const require = createRequire(import.meta.url);
const { projectResearch } = require("../../../api/_lib/itemassist-research/projection.js");
const GOLDEN = JSON.parse(readFileSync(new URL("../fixtures/research2-golden.json", import.meta.url), "utf8"));
const LIVE = { requestId: "proxy-req-1", elapsedMs: 5, quota: null, allowFixture: false, allowLive: true };
const clone = (value) => JSON.parse(JSON.stringify(value));
const live = (id, change = () => {}) => { const body = clone(GOLDEN.scenarios[id].engine); delete body.meta.fixture; change(body); return body; };
const priceOf = (out, id) => out.pricing.prices.find((price) => price.id === id);

// tv-premium-oled: p1 the original's MSRP, p2 / p3 / p4 current listings for the successor and the two alternatives.
const asListings = (body) => {
  body.pricing.valuation = {
    method: "PROVISIONAL_LISTINGS", basis: "PROVISIONAL_LISTINGS", verified: false, range: { currency: "USD", low: 1299, high: 1299 }, confidence: "LOW", asOf: "2026-10-20",
    comparables: [{ priceId: "p2", candidate: "SUCCESSOR", verification: "SEARCH_LISTING" }], excluded: [{ candidate: "ALT_1", reason: "NO_CURRENT_PRICE" }, { candidate: "ALT_2", reason: "NO_CURRENT_PRICE" }],
    reference: { priceId: "p1", kind: "MSRP" }, notes: [{ code: "BASED_ON_LISTINGS", count: 1 }, { code: "LISTINGS_NOT_CONFIRMED" }, { code: "NOT_AN_APPRAISAL" }],
  };
};

test("a listing marked configuration-not-confirmed keeps its mark only on a current listing, and can never be a comparable", () => {
  const body = (change = () => {}) => live("tv-premium-oled", (engine) => {
    asListings(engine);
    Object.assign(engine.pricing.prices.find((price) => price.id === "p3"), { configConfirmed: false });
    engine.pricing.prices.find((price) => price.id === "p1").configConfirmed = false;
    change(engine);
  });
  const out = projectResearch(body(), LIVE);
  assert.equal(priceOf(out, "p3").configConfirmed, false, "the example keeps its mark");
  assert.equal(Object.hasOwn(priceOf(out, "p1"), "configConfirmed"), false, "a forged mark on the original's price is dropped");
  assert.equal(Object.hasOwn(priceOf(out, "p2"), "configConfirmed"), false, "an ordinary price carries no mark");
  assert.deepEqual(out.pricing.valuation.range, { currency: "USD", low: 1299, high: 1299 });
  // A listing marked as an example among the comparables is refused, even when the range is made to match.
  const forged = projectResearch(body((engine) => {
    engine.pricing.valuation.comparables.push({ priceId: "p3", candidate: "ALT_1", verification: "SEARCH_LISTING" });
    engine.pricing.valuation.range = { currency: "USD", low: 1199, high: 1299 };
    engine.pricing.valuation.notes[0].count = 2;
  }), LIVE);
  assert.equal(forged.pricing.valuation.method, "INSUFFICIENT");
  assert.equal(priceOf(forged, "p3").configConfirmed, false);
  // Only a literal false is a mark.
  for (const value of [true, "false", 0, null]) {
    const odd = projectResearch(live("tv-premium-oled", (engine) => { asListings(engine); engine.pricing.prices.find((price) => price.id === "p3").configConfirmed = value; }), LIVE);
    assert.equal(Object.hasOwn(priceOf(odd, "p3"), "configConfirmed"), false, String(value));
  }
});

test("the note that listings were left out for their spread is carried with its count, with any method, and a bad count is dropped", () => {
  const noted = (count) => projectResearch(live("tv-premium-oled", (engine) => { asListings(engine); engine.pricing.valuation.notes.splice(2, 0, { code: "LISTINGS_SPREAD_TRIMMED", count }); }), LIVE);
  assert.deepEqual(noted(2).pricing.valuation.notes.find((note) => note.code === "LISTINGS_SPREAD_TRIMMED"), { code: "LISTINGS_SPREAD_TRIMMED", count: 2 });
  for (const count of [-1, "2", null, 5000]) assert.equal(noted(count).pricing.valuation.notes.some((note) => note.code === "LISTINGS_SPREAD_TRIMMED"), false, String(count));
  // With every listing set aside the answer is an estimate or "not enough evidence", and the note still explains why.
  const none = projectResearch(live("insufficient", (engine) => { engine.pricing.valuation.notes.unshift({ code: "LISTINGS_SPREAD_TRIMMED", count: 3 }); }), LIVE);
  assert.equal(none.pricing.valuation.method, "INSUFFICIENT");
  assert.deepEqual(none.pricing.valuation.notes.map((note) => note.code), ["LISTINGS_SPREAD_TRIMMED", "INSUFFICIENT", "NOT_AN_APPRAISAL"]);
});

test("a request that failed at the provider is PROVIDER_UNAVAILABLE and nothing else about the product; an unknown product is still not identified", () => {
  const failed = projectResearch(live("insufficient", (engine) => { engine.warnings = ["PROVIDER_UNAVAILABLE", "VALUATION_INSUFFICIENT"]; }), LIVE);
  assert.equal(failed.warnings.includes("PROVIDER_UNAVAILABLE"), true);
  assert.equal(failed.warnings.includes("PRODUCT_NOT_IDENTIFIED"), false);
  assert.equal(failed.status, "GUIDANCE_ONLY");
  const unknown = projectResearch(live("insufficient"), LIVE);
  assert.equal(unknown.warnings.includes("PRODUCT_NOT_IDENTIFIED"), true);
  assert.equal(unknown.warnings.includes("PROVIDER_UNAVAILABLE"), false);
  // An engine that sends neither still has an unknown product reported as one: the proxy derives it, it does not take the engine's word.
  assert.equal(projectResearch(live("insufficient", (engine) => { engine.warnings = []; }), LIVE).warnings.includes("PRODUCT_NOT_IDENTIFIED"), true);
});

test("a name recognised while the provider failed passes through as a partial answer with no candidate, price or source", () => {
  const out = projectResearch(live("insufficient", (engine) => {
    engine.status = "PARTIAL";
    engine.original = { identity: "Nintendo Wii", confidence: "LOW", characteristics: [], uncertainty: "Named from your wording and web results. The research step did not finish." };
    engine.warnings = ["PROVIDER_UNAVAILABLE", "VALUATION_INSUFFICIENT"];
  }), LIVE);
  assert.deepEqual([out.status, out.original.identity, out.original.confidence, out.successor, out.suggestions, out.pricing.prices, out.pricing.evidence], ["PARTIAL", "Nintendo Wii", "LOW", null, [], [], []]);
  assert.equal(out.warnings.includes("PRODUCT_NOT_IDENTIFIED"), false);
  assert.equal(out.warnings.includes("PROVIDER_UNAVAILABLE"), true);
  assert.equal(out.pricing.valuation.method, "INSUFFICIENT");
});
