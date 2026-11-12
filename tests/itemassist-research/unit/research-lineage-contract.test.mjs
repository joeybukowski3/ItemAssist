import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

// OFFLINE ONLY. The optional research.2 `lineage` block the engine's successor-generation discovery adds, and how this side accepts, limits and words it.
// The "after" fixtures are the new engine's real output on the engine's captured Shopping rows; the "before" fixtures are what Production's engine returns today.
const require = createRequire(import.meta.url);
const RS = require("../../../assets/js/rf-research.js");
const { projectResearch } = require("../../../api/_lib/itemassist-research/projection.js");

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/successor/${name}.engine.json`, import.meta.url), "utf8"));
const LIVE = { requestId: "req-1", elapsedMs: 5, quota: null, allowLive: true };
const project = (body) => projectResearch(body, LIVE);
const clone = (value) => JSON.parse(JSON.stringify(value));
const without = (value) => { const copy = clone(value); delete copy.meta; delete copy.quota; return copy; };
const canon = (value) => JSON.stringify(value, (key, item) => (item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map((name) => [name, item[name]])) : item));
// A candidate's confidence is HIGH only when a cited page confirms its model; an engine that predates the cap may still send HIGH, and this side lowers it.
const capConfidence = (body) => { const copy = clone(body); for (const entry of [copy.successor, ...copy.suggestions]) if (entry && entry.confidence === "HIGH" && entry.modelStatus !== "VERIFIED_LISTING") entry.confidence = "MEDIUM"; return copy; };
const AFTER = ["lg-c3-after-stage-b", "lg-c3-saved-production-after-stage-b", "samsung-s90c-after-stage-b"];
const BEFORE = ["lg-c3-family-mixed", "lg-c3-c6-single-listing", "lg-c3-saved-production-before"];

test("what Production's engine returns today (no lineage) is accepted unchanged, and so is the new engine's output", () => {
  for (const name of [...BEFORE, ...AFTER]) {
    const body = fixture(name);
    const out = project(clone(body));
    assert.ok(out, name);
    assert.equal(RS.isResearchResponse(out), true, name);
    assert.equal(canon(without(out)), canon(without(capConfidence(body))), `${name}: the projection equals the engine's typed content, with confidence capped`);
  }
  for (const name of BEFORE) assert.equal(project(fixture(name)).successor.lineage, undefined, `${name}: no block is invented`);
});

test("the new engine's successors carry a lineage block that survives projection exactly", () => {
  const lg = project(fixture("lg-c3-after-stage-b"));
  assert.deepEqual(lg.successor.lineage, { relation: "SAME_SERIES_NEWER", generation: "C6", basis: "LISTINGS", tier: "UNKNOWN" });
  assert.equal(lg.successor.name, "LG C6 OLED 55-inch (OLED55C6PUA)");
  assert.equal(lg.suggestions[0].lineage.relation, "OTHER_BRAND");
});

test("a malformed or forged lineage block is dropped, never repaired, and never changes the status, standing or prices", () => {
  const base = fixture("lg-c3-after-stage-b");
  const baseline = project(clone(base));
  const forged = (change) => { const body = clone(base); change(body.successor); return project(body); };
  for (const [label, change] of Object.entries({
    "an unknown relation": (s) => { s.lineage.relation = "DIRECT_SUCCESSOR"; },
    "an extra key": (s) => { s.lineage.note = "x"; },
    "a generation with no basis": (s) => { s.lineage.basis = "NONE"; },
    "a basis with no generation": (s) => { s.lineage.generation = null; },
    "a generation that is free text": (s) => { s.lineage.generation = "see https://example.com"; },
    "a lower-case generation": (s) => { s.lineage.generation = "c6"; },
    "an unknown tier": (s) => { s.lineage.tier = "MUCH_HIGHER"; },
    "not an object": (s) => { s.lineage = "SAME_SERIES_NEWER"; },
  })) {
    const out = forged(change);
    assert.ok(out, label);
    assert.equal(out.successor.lineage, undefined, label);
    assert.deepEqual([out.successor.modelStatus, out.successor.standing, out.pricing.valuation.method], [baseline.successor.modelStatus, baseline.successor.standing, baseline.pricing.valuation.method], label);
  }
});

test("lineage describes lineage only: it cannot make a candidate verified, recommended or priced", () => {
  const body = clone(fixture("lg-c3-after-stage-b"));
  body.successor.lineage = { relation: "SAME_SERIES_NEWER", generation: "C6", basis: "LISTINGS", tier: "HIGHER" };
  body.successor.standing = "RECOMMENDED";
  const out = project(body);
  assert.equal(out.successor.verified, false);
  assert.notEqual(out.successor.modelStatus, "VERIFIED_LISTING", "model status is recomputed from the evidence, whatever the lineage says");
  assert.equal(RS.successorLabel(out.successor, true).text.includes("Direct"), false);
});

test("an older same-series alternative is labelled as one, not as the likely successor", () => {
  const out = clone(project(fixture("lg-c3-after-stage-b")));
  out.successor.lineage = { relation: "SAME_SERIES_OLDER", generation: "C5", basis: "LISTINGS", tier: "SAME" };
  out.successor.concern = "A newer generation (C6) was seen in listings, but not in the requested 55-inch size.";
  assert.equal(RS.successorLabel(out.successor, true).text, "Older same-series alternative");
  const line = RS.successorLine(out);
  assert.match(line, /^Older same-series alternative: /);
  assert.match(line, /newer generation was seen in listings/);
});

test("an alternative from another maker is labelled by tier as the model's estimate, and unlabelled when nothing is known", () => {
  const out = project(fixture("lg-c3-after-stage-b"));
  const alt = out.suggestions[0];
  const labelFor = (tier) => RS.alternativeLabel({ ...alt, lineage: { ...alt.lineage, tier } });
  assert.equal(labelFor("HIGHER").text, "Higher-tier alternative (AI estimate)");
  assert.equal(labelFor("LOWER").text, "Lower-tier alternative (AI estimate)");
  assert.equal(labelFor("SAME").text, "Close equivalent (AI estimate)");
  assert.equal(labelFor("UNKNOWN"), null);
  assert.equal(RS.alternativeLabel({ name: "x" }), null, "no lineage, no label (Production's engine today)");
});

test("the generation a candidate is presented as says where it came from", () => {
  const out = project(fixture("lg-c3-after-stage-b"));
  assert.equal(RS.generationLine(out.successor), "Generation C6, as stated in retailer listings.");
  const guess = { lineage: { relation: "SAME_SERIES_NEWER", generation: "C7", basis: "AI_HYPOTHESIS", tier: "SAME" } };
  assert.equal(RS.generationLine(guess), "Generation C7 is the AI's guess; no listing states it.");
  assert.equal(RS.generationLine({ lineage: { relation: "UNKNOWN", generation: null, basis: "NONE", tier: "UNKNOWN" } }), null);
  assert.equal(RS.generationLine({}), null);
});

test("saved production request: before it priced the C6 successor from a C5 listing; after, no price is attached to a model it does not belong to", () => {
  const before = project(fixture("lg-c3-saved-production-before"));
  const after = project(fixture("lg-c3-saved-production-after-stage-b"));
  assert.equal(RS.successorLabel(before.successor, true).text, "Likely Successor Family");
  assert.equal(RS.priceScope(before).kind, "SINGLE_LISTING_MODEL_NOT_STATED", "one Newegg listing that states no model, presented as the family's price");
  assert.equal(RS.successorLabel(after.successor, true).text, "Likely successor, model not confirmed");
  assert.equal(after.successor.name, "LG C6 OLED 55-inch (OLED55C6PUA)");
  assert.equal(JSON.stringify(after.pricing.prices).includes("1096"), false);
  assert.equal(after.pricing.valuation.method, "HISTORICAL_TIER_ESTIMATE");
  assert.match(after.successor.concern, /no price is attached/);
  const chat = RS.reply(after, null).lines.join("\n");
  assert.match(chat, /Likely successor: LG C6 OLED 55-inch \(OLED55C6PUA\)\./);
  assert.match(chat, /rough estimate/);
  assert.doesNotMatch(chat, /Direct successor|\$1,096/);
});

test("non-LG: the Samsung S90 result presents the S90H with its listing-derived generation and no price from another generation", () => {
  const out = project(fixture("samsung-s90c-after-stage-b"));
  assert.match(out.successor.name, /^Samsung S90H OLED 65-inch/);
  assert.deepEqual([out.successor.lineage.relation, out.successor.lineage.generation, out.successor.lineage.basis], ["SAME_SERIES_NEWER", "S90H", "LISTINGS"]);
  assert.equal(out.pricing.prices.filter((p) => p.candidate === "SUCCESSOR").length, 0);
});
