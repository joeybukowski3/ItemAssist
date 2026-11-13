import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

// OFFLINE ONLY. Release 2, this side: the optional model-observation and specification-comparison blocks the engine adds to a candidate. Each is re-validated whole
// and dropped, never repaired; the wording shared by the cards and the chat comes from one set of pure functions. Fixtures are the new engine's real output on the
// engine's saved Shopping rows (and one synthetic conflict).
const require = createRequire(import.meta.url);
const RS = require("../../../assets/js/rf-research.js");
const { projectResearch } = require("../../../api/_lib/itemassist-research/projection.js");

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/successor/${name}.engine.json`, import.meta.url), "utf8"));
const LIVE = { requestId: "req-1", elapsedMs: 5, quota: null, allowLive: true };
const project = (body) => projectResearch(body, LIVE);
const clone = (value) => JSON.parse(JSON.stringify(value));
const canon = (value) => JSON.stringify(value, (key, item) => (item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map((name) => [name, item[name]])) : item));
const R2 = ["lg-c3-r2-clean-listing", "lg-c3-r2-bundle-only", "lg-c3-r2-conflict", "lg-c3-r2-sku-less-with-bundle-code"];
const capped = (body) => { const copy = clone(body); for (const entry of [copy.successor, ...copy.suggestions]) if (entry && entry.confidence === "HIGH" && entry.modelStatus !== "VERIFIED_LISTING") entry.confidence = "MEDIUM"; return copy; };
const without = (value) => { const copy = clone(value); delete copy.meta; delete copy.quota; return copy; };

test("the new engine's observations and comparisons survive projection exactly", () => {
  for (const name of R2) {
    const body = fixture(name);
    const out = project(clone(body));
    assert.ok(out, name);
    assert.equal(RS.isResearchResponse(out), true, name);
    assert.equal(canon(without(out)), canon(without(capped(body))), `${name}: the projection equals the engine's typed content`);
    assert.ok(out.successor.modelObservations && out.successor.specComparison, name);
  }
});

test("a response from an engine that predates Release 2 (no blocks) projects unchanged and invents none", () => {
  for (const name of ["lg-c3-after-stage-b", "lg-c3-c6-single-listing", "lg-c3-saved-production-after-stage-b", "samsung-s90c-after-stage-b", "lg-c3-family-mixed"]) {
    const out = project(fixture(name));
    for (const entry of [out.successor, ...out.suggestions].filter(Boolean)) {
      assert.equal(Object.hasOwn(entry, "modelObservations"), false, name);
      assert.equal(Object.hasOwn(entry, "specComparison"), false, name);
    }
  }
  assert.deepEqual(RS.observationLines({}), []);
  assert.deepEqual(RS.comparisonRows({}), []);
  assert.equal(RS.comparisonSummary({}), null);
});

test("a forged, edited or inflated observation block is dropped whole, and never changes a price, status or standing", () => {
  const base = fixture("lg-c3-r2-bundle-only");
  const baseline = project(clone(base));
  const forged = {
    "a retailer that is not in the registry": (b) => { b.items[0].retailers = ["Totally Real Store"]; },
    "a model that is not a model": (b) => { b.items[0].model = "hello"; },
    "a price in the excerpt": (b) => { b.items[0].excerpt = "LG OLED55C6PUA only $999.99 today"; },
    "a link in the excerpt": (b) => { b.items[0].excerpt = "see https://example.com/deal"; },
    "priced with an exclusion": (b) => { b.items[0].status = "PRICED_LISTING"; },
    "excluded without a reason": (b) => { b.items[0].exclusion = null; },
    "an unknown reason": (b) => { b.items[0].exclusion = "GREAT_DEAL"; },
    "an invented retrieval basis": (b) => { b.items[0].retrievedBasis = "UNKNOWN"; },
    "a source publication time": (b) => { b.items[0].publishedAt = "2026-11-01"; },
    "a conflict with a single model": (b) => { b.conflict = true; },
    "more models than allowed": (b) => { b.items = Array.from({ length: 4 }, (_, i) => ({ ...b.items[0], model: `OLED55C6P${i}A` })); },
    "no items": (b) => { b.items = []; },
  };
  for (const [label, change] of Object.entries(forged)) {
    const body = clone(base);
    change(body.successor.modelObservations);
    const out = project(body);
    assert.equal(Object.hasOwn(out.successor, "modelObservations"), false, label);
    assert.equal(canon(out.pricing), canon(baseline.pricing), `${label}: pricing unchanged`);
    assert.equal(out.successor.modelStatus, baseline.successor.modelStatus, label);
  }
});

test("observations must fit the candidate: a priced model needs a listing-backed status and a price of that model; a conflict leaves no code in the name", () => {
  const unverified = fixture("lg-c3-r2-bundle-only");
  unverified.successor.modelObservations.items[0].status = "PRICED_LISTING";
  unverified.successor.modelObservations.items[0].exclusion = null;
  assert.equal(Object.hasOwn(project(unverified).successor, "modelObservations"), false, "UNVERIFIED_MODEL cannot carry a priced observation");
  const noPrice = fixture("lg-c3-r2-clean-listing");
  noPrice.pricing.prices = noPrice.pricing.prices.filter((price) => price.subject === "ORIGINAL");
  assert.equal(Object.hasOwn(project(noPrice).successor, "modelObservations"), false, "a priced observation with no price of that model behind it is dropped");
  const named = fixture("lg-c3-r2-conflict");
  named.successor.name = "LG C6 OLED 55-inch (OLED55C6PUA)";
  assert.equal(Object.hasOwn(project(named).successor, "modelObservations"), false, "a conflict beside a named code does not fit");
});

test("a forged, edited or inflated comparison is dropped whole; a comparison needs a lineage block; candidate values are listing titles only", () => {
  const base = fixture("lg-c3-r2-clean-listing");
  const forged = {
    "a result that does not follow from the values": (c) => { c.rows[0].result = "DIFFERENT"; },
    "a value outside its shape": (c) => { c.rows[0].original.value = "huge"; },
    "a basis that is not a source": (c) => { c.rows[0].original.basis = "AI_ESTIMATE"; },
    "a candidate value from the person or a page": (c) => { c.rows[1].candidate.basis = "MANUFACTURER_PAGE_TITLE"; },
    "a summary that disagrees with the rows": (c) => { c.compared = ["SCREEN_SIZE"]; },
    "a missing core attribute": (c) => { c.rows = c.rows.filter((row) => row.attribute !== "REFRESH_RATE"); c.notEstablished = c.notEstablished.filter((a) => a !== "REFRESH_RATE"); },
    "an optional row nobody states": (c) => { c.rows.push({ attribute: "HDMI_2_1", original: null, candidate: null, result: "NOT_ESTABLISHED" }); c.notEstablished.push("HDMI_2_1"); },
    "a free-text note": (c) => { c.note = "much brighter"; },
    "out of order": (c) => { c.rows.reverse(); },
    "an extra key in a side": (c) => { c.rows[0].original.note = "x"; },
  };
  for (const [label, change] of Object.entries(forged)) {
    const body = clone(base);
    change(body.successor.specComparison);
    assert.equal(Object.hasOwn(project(body).successor, "specComparison"), false, label);
  }
  const noLineage = clone(base);
  delete noLineage.successor.lineage;
  assert.equal(Object.hasOwn(project(noLineage).successor, "specComparison"), false);
});

test("wording: an observed code is an observation with its exclusion and retrieval date; a conflict names every code and chooses none", () => {
  const lines = (name) => RS.observationLines(project(fixture(name)).successor);
  assert.deepEqual(lines("lg-c3-r2-bundle-only"), ["Model code observed: OLED55C6PUA in 2 listing titles (Best Buy). Price excluded: the listing includes a protection plan. Retrieved Nov 11, 2026."]);
  assert.match(lines("lg-c3-r2-clean-listing")[0], /^Model code observed: OLED55C6PUA in 3 listing titles \(Best Buy\)\. Its eligible listings set the price shown\./);
  const conflict = lines("lg-c3-r2-conflict");
  assert.match(conflict[0], /^Listings name more than one model code \(OLED55C6PUA, OLED55C6AUA\), so none is chosen\.$/);
  assert.ok(conflict.slice(1).every((line) => /not priced as an exact model/.test(line)));
  assert.match(lines("lg-c3-r2-sku-less-with-bundle-code")[0], /Price excluded: the listing includes a protection plan\./);
  const legacy = fixture("lg-c3-r2-bundle-only");
  legacy.successor.modelObservations.items[0].retrievedAt = null;
  legacy.successor.modelObservations.items[0].retrievedBasis = "UNKNOWN";
  assert.match(RS.observationLines(project(legacy).successor)[0], /Retrieval date not recorded\.$/, "no time is invented");
  assert.equal(/verified|confirmed|official/i.test(lines("lg-c3-r2-bundle-only").join(" ")), false);
  assert.match(RS.OBSERVATION_NOTE, /does not verify the model or its specifications/);
});

test("wording: the comparison states each side with its basis, says 'Not established' for what no source states, and never claims better, brighter or improved", () => {
  const candidate = project(fixture("lg-c3-r2-clean-listing")).successor;
  const rows = Object.fromEntries(RS.comparisonRows(candidate).map((row) => [row.attribute, row]));
  assert.deepEqual([rows.SCREEN_SIZE.original, rows.SCREEN_SIZE.candidate, rows.SCREEN_SIZE.resultLabel], ["55-inch (your description)", "55-inch (4 seller listing titles)", "Match"]);
  assert.deepEqual([rows.DISPLAY_CLASS.original, rows.RESOLUTION.original], ["OLED (manufacturer page title)", "4K (manufacturer page title)"]);
  assert.deepEqual([rows.REFRESH_RATE.original, rows.REFRESH_RATE.candidate, rows.REFRESH_RATE.resultLabel], ["Not established", "Not established", "Not established"]);
  assert.equal(RS.comparisonSummary(candidate), "Compared: screen size, display class and resolution. Not established: refresh rate and dolby vision.");
  const all = JSON.stringify([RS.comparisonRows(candidate), RS.comparisonSummary(candidate), RS.comparisonSentence(candidate), RS.COMPARISON_NOTE]);
  assert.equal(/\b(?:better|brighter|faster|improved|upgrade|superior)\b/i.test(all.replace(/Nothing is inferred[^"]*/, "")), false);
  assert.match(RS.COMPARISON_NOTE, /seller's wording, not manufacturer specifications/);
});

test("a difference is stated with both values", () => {
  const body = fixture("lg-c3-r2-clean-listing");
  const row = body.successor.specComparison.rows.find((entry) => entry.attribute === "RESOLUTION");
  row.original = { value: "8K", basis: "USER_STATED", sources: 1 };
  row.result = "DIFFERENT";
  body.successor.specComparison.compared = body.successor.specComparison.compared.slice();
  const candidate = project(body).successor;
  assert.match(RS.comparisonSentence(candidate), /Resolution differs: 8K \(your description\) for the original, 4K \(\d+ seller listing titles?\) for this candidate\./);
});

test("chat and cards say the same: the chat answers come from the same functions as the card text", () => {
  const out = project(fixture("lg-c3-r2-bundle-only"));
  const session = { last: out };
  const model = RS.localAnswer(session, "What is the exact model number?");
  assert.ok(model.some((line) => line.startsWith(out.successor.name + ": ") && line.includes(RS.observationLines(out.successor).join(" ")) && line.includes(RS.OBSERVATION_NOTE)), "the model-code answer is the card's observation text");
  const compare = RS.localAnswer(session, "How does it compare with mine?");
  assert.ok(compare.some((line) => line.includes(RS.comparisonSummary(out.successor)) && line.includes(RS.COMPARISON_NOTE)), "the comparison answer is the card's summary");
  const none = project(fixture("lg-c3-after-stage-b"));
  // With no observation the chat says no exact model is established or confirmed (Release 2.1: and acknowledges a generation the lineage states, see research-release-2-1.test.mjs).
  assert.ok(RS.localAnswer({ last: none }, "What is the exact model number?").every((line) => /exact model is not established|couldn't confirm the exact model code/.test(line)), "with no observation the chat says so");
});

test("non-television results carry neither block and render exactly as before", () => {
  const out = project(fixture("samsung-s90c-after-stage-b"));
  for (const entry of [out.successor, ...out.suggestions].filter(Boolean)) {
    assert.deepEqual(RS.observationLines(entry), []);
    assert.equal(RS.comparisonSummary(entry), null);
  }
});

test("review: a comparison citing the original's page needs the page; a retrieval date is recent and not in the future; a priced model must be the one in the name; a seller storefront is a recognised seller", () => {
  const bundle = fixture("lg-c3-r2-bundle-only");
  const noPage = clone(bundle);
  delete noPage.original.manufacturerPages;
  assert.equal(Object.hasOwn(project(noPage).successor, "specComparison"), false, "a page-title basis with no page is dropped");
  for (const retrievedAt of ["2099-01-01", "1999-01-01"]) {
    const body = clone(bundle);
    body.successor.modelObservations.items[0].retrievedAt = retrievedAt;
    assert.equal(Object.hasOwn(project(body).successor, "modelObservations"), false, retrievedAt);
  }
  const clean = fixture("lg-c3-r2-clean-listing");
  clean.successor.modelObservations.items[0].model = "OLED55C6XUA";
  assert.equal(Object.hasOwn(project(clean).successor, "modelObservations"), false, "a priced model the name does not carry");
  const store = fixture("lg-c3-r2-clean-listing");
  store.successor.modelObservations.items[0].retailers = ["Best Buy", "LG"];
  assert.deepEqual(project(store).successor.modelObservations.items[0].retailers, ["Best Buy", "LG"]);
});
