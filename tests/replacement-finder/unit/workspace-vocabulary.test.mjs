import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { engineComplete, engineBestAvailable, engineBestAvailableUnconfirmed, engineNoRetailReplacement, engineNoResult } from "../endpoint/helpers.mjs";

const require = createRequire(import.meta.url);
const RF = require("../../../assets/js/rf-shared.js");
const { projectResult } = require("../../../api/_lib/replacement-finder/projection.js");

const project = (contract) => projectResult(contract);

test("headline: each engine result level gets its own title", () => {
  assert.equal(RF.headlineFor(project(engineComplete())).title, "Recommended Replacement");
  assert.equal(RF.headlineFor(project(engineBestAvailableUnconfirmed())).title, "Best Available Current Replacement");
  assert.equal(RF.headlineFor(project(engineBestAvailable())).key, "BEST_AVAILABLE");
  assert.equal(RF.headlineFor(project(engineNoRetailReplacement())).title, "No Current Retail Replacement Found");
  assert.equal(RF.headlineFor(project(engineNoResult())).title, "No Replacement Found");
});

test("headline: an older engine that only sends isBestAvailableOnly still reads as best available", () => {
  const data = project(engineBestAvailable());
  delete data.primary.recommendationLevel;
  assert.equal(RF.headlineFor(data).key, "BEST_AVAILABLE");
  data.primary.isBestAvailableOnly = false;
  assert.equal(RF.headlineFor(data).key, "RECOMMENDED");
});

test("headline: fails closed and never claims 'current' without retail evidence", () => {
  const data = project(engineBestAvailableUnconfirmed());
  data.primary.retail = null;
  assert.equal(RF.headlineFor(data).title, "Best Available Replacement");
  assert.equal(RF.headlineFor(data).key, "BEST_AVAILABLE");
  const contradictory = project(engineComplete());
  contradictory.primary.isBestAvailableOnly = true;
  assert.equal(RF.headlineFor(contradictory).key, "BEST_AVAILABLE");
  const unsignalled = project(engineComplete());
  delete unsignalled.primary.recommendationLevel;
  delete unsignalled.primary.isBestAvailableOnly;
  assert.equal(RF.headlineFor(unsignalled).key, "BEST_AVAILABLE");
});

test("no confirmed LKQ is read from the engine warnings, not computed", () => {
  assert.equal(RF.hasNoConfirmedLkq(project(engineBestAvailableUnconfirmed())), true);
  assert.equal(RF.hasNoConfirmedLkq(project(engineBestAvailable())), true, "NO_LKQ_CANDIDATE counts too");
  assert.equal(RF.hasNoConfirmedLkq(project(engineComplete())), false);
});

test("assessment display: statuses use consumer wording and never lose their tone", () => {
  const row = (code, importance = "IMPORTANT") => ({ importance, assessment: { code, label: "engine label" } });
  assert.deepEqual(RF.assessmentDisplay(row("MATCH", "REQUIRED")), { code: "MATCH", label: "Meets", tone: "ok", icon: "check" });
  assert.equal(RF.assessmentDisplay(row("MATCH")).label, "Match");
  assert.equal(RF.assessmentDisplay(row("EXCEEDS")).label, "Exceeds");
  for (const code of ["UNKNOWN", "VERIFY", "ASSUMED"]) assert.equal(RF.assessmentDisplay(row(code)).label, "Verify", code);
  assert.deepEqual([RF.assessmentDisplay(row("FAIL")).label, RF.assessmentDisplay(row("FAIL")).tone], ["Conflict", "bad"]);
  assert.equal(RF.assessmentDisplay(row("SOMETHING_NEW")).label, "Verify", "unknown codes fall back to the cautious label");
});

test("whyPoints: derived only from contract data, and honest about what is unverified", () => {
  const points = RF.whyPoints(project(engineBestAvailableUnconfirmed()));
  const texts = points.map((point) => point.text);
  assert.ok(texts.includes("Sold new and currently available from Samsung.com."));
  assert.ok(texts.includes("All 2 required specifications are satisfied."));
  assert.ok(texts.includes("1 important specification remains unverified."));
  assert.ok(texts.includes("Original product tier was inferred, not stated directly by a source."));
  assert.ok(texts.includes("Equivalence to the original is not verified."));
  assert.equal(points.find((point) => point.text.startsWith("Sold new")).tone, "ok");
  assert.equal(points.find((point) => point.text.includes("unverified")).tone, "warn");
  assert.equal(texts.some((text) => /successor|lineage|equivalent family/i.test(text)), false, "no lineage claim without contract support");
  assert.deepEqual(RF.whyPoints(project(engineNoResult())), []);
});

test("whyPoints: no retail evidence means no availability claim", () => {
  const data = project(engineComplete());
  data.primary.retail = null;
  assert.equal(RF.whyPoints(data).some((point) => /available|sold/i.test(point.text)), false);
});

test("formatting: price and observation date render the observed values without adjustment", () => {
  assert.equal(RF.formatPrice({ amount: 999.99, currency: "USD" }), "$999.99");
  assert.equal(RF.formatPrice({ amount: 1300, currency: "USD" }), "$1,300.00");
  assert.equal(RF.formatPrice(null), null);
  assert.equal(RF.formatPrice({ amount: 5, currency: "ZZZZ" }), "5.00 ZZZZ");
  assert.equal(RF.formatObservedDate("2026-10-11T23:59:00.000Z"), "Oct 11, 2026");
  assert.equal(RF.formatObservedDate("nope"), null);
  assert.equal(RF.formatObservedDate(null), null);
});

test("observation time: only a real ISO date-time with a zone is formatted; everything else is omitted, never shown as Invalid Date", () => {
  assert.equal(RF.formatObservedDate("2026-10-11T16:30:00+02:00"), "Oct 11, 2026");
  assert.equal(RF.formatObservedDate("2026-10-11T23:30:00-05:00"), "Oct 12, 2026", "formatted in UTC so it reads the same everywhere");
  assert.equal(RF.normalizeObservedAt("2026-10-11T14:30:00.000Z"), "2026-10-11T14:30:00.000Z");
  for (const value of ["2026-02-30T00:00:00Z", "2026", "Oct 11 2026", "2026-10-11", "2026-10-11T14:30:00", "", "undefined", 1791743400000, undefined, NaN, {}]) {
    assert.equal(RF.normalizeObservedAt(value), null, String(value));
    assert.equal(RF.formatObservedDate(value), null, String(value));
  }
});

test("existing validation rules are unchanged", () => {
  assert.equal(RF.validateLookup({ category: "television", brand: "Samsung", model: "qn55q80c", notes: "", website: "" }).value.model, "QN55Q80C");
  assert.equal(RF.validateLookup({ category: "television", brand: "LG", model: "QN55Q80C" }).ok, false);
  assert.equal(RF.validateLookup({ category: "television", brand: "Samsung", model: "<x>" }).errors.model.startsWith("Use letters"), true);
});
