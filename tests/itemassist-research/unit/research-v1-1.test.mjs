import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// OFFLINE ONLY. V1.1: a request that failed at the provider is never worded as an unknown product, a laptop listing whose configuration was not
// matched is an example and says so, and the answer to "what processor, RAM and storage?" is more detail on the same item (never a new one).
const require = createRequire(import.meta.url);
const RS = require("../../../assets/js/rf-research.js");
const { researchResponse } = require("../fixtures/research.js");

const incomplete = (identity) => researchResponse({
  status: identity ? "PARTIAL" : "GUIDANCE_ONLY",
  original: { identity, confidence: "LOW", characteristics: [], uncertainty: identity ? "Named from your wording and web results. The research step did not finish." : null },
  requirementsSource: "CATEGORY_GUIDANCE", successor: null, suggestions: [], clarify: [],
  warnings: ["PROVIDER_UNAVAILABLE"], meta: { requestId: "r", elapsedMs: 1600, cached: false, answerSource: "CATEGORY_GUIDANCE" }, quota: { limit: 5, remaining: 5, charged: false }
});
const unknownProduct = () => researchResponse({
  status: "GUIDANCE_ONLY", original: { identity: null, confidence: "LOW", characteristics: [], uncertainty: null }, successor: null, suggestions: [], clarify: [],
  warnings: ["PRODUCT_NOT_IDENTIFIED"], meta: { requestId: "r", elapsedMs: 1600, cached: false, answerSource: "AI_ESTIMATE" }
});

test("a request that failed at the provider is worded as a request that did not finish, never as an unknown product", () => {
  assert.equal(RS.providerIncomplete(incomplete("Nintendo Wii")), true);
  assert.equal(RS.providerIncomplete(incomplete(null)), true);
  assert.equal(RS.providerIncomplete(unknownProduct()), false);
  assert.equal(RS.providerIncomplete(researchResponse()), false);
  assert.equal(RS.providerIncomplete(null), false);

  const named = RS.reply(incomplete("Nintendo Wii"), { limit: 5, remaining: 5 });
  assert.equal(named.kicker, "Research didn't finish");
  assert.match(named.lines[0], /^I recognised this as Nintendo Wii, but the research step didn't finish/);
  assert.match(named.lines.join(" "), /not a finding about the product/);
  assert.match(named.lines.join(" "), /doesn't use up your daily allowance/);
  assert.equal(named.lines.join(" ").includes("couldn't identify"), false);

  const nameless = RS.reply(incomplete(null), null);
  assert.equal(nameless.kicker, "Research didn't finish");
  assert.match(nameless.lines[0], /can't say anything about this item yet/);
  assert.equal(`${nameless.kicker} ${nameless.lines.join(" ")}`.includes("not identified"), false);
});

test("an item the model could not place is still said to be unidentified, so the two outcomes stay different", () => {
  const unknown = RS.reply(unknownProduct(), null);
  assert.equal(unknown.kicker, "Product not identified");
  assert.match(unknown.lines[0], /couldn't identify this item from the description/);
});

test("asked how sure it is, an unfinished request says it cannot say yet, and a recognised name keeps its low confidence", () => {
  const session = RS.adopt(RS.initialSession(), "new", "nintendo wii", { query: "nintendo wii", refinements: [] }, incomplete(null));
  const answer = RS.localAnswer(session, "how sure are you?");
  assert.match(answer.join(" "), /research step didn't finish, so I can't say yet/);
  assert.equal(answer.join(" ").includes("wasn't able to identify"), false);
  const named = RS.adopt(RS.initialSession(), "new", "nintendo wii", { query: "nintendo wii", refinements: [] }, incomplete("Nintendo Wii"));
  assert.match(RS.localAnswer(named, "how sure are you?")[0], /confidence in the identification is low/);
});

test("the note about listings left out for being too far apart is a fixed sentence, singular and plural", () => {
  assert.equal(RS.noteText({ code: "LISTINGS_SPREAD_TRIMMED", count: 1 }), "1 listing was left out because its price is too far from the others to be the same product or configuration.");
  assert.equal(RS.noteText({ code: "LISTINGS_SPREAD_TRIMMED", count: 3 }), "3 listings were left out because their prices are too far from the others to be the same product or configuration.");
});

const listing = (id, candidate, extra = {}) => ({ id, kind: "CURRENT_RETAIL_NEW", subject: "REPLACEMENT", candidate, model: null, amount: { currency: "USD", low: 500, high: 500 }, asOf: "2026-10-30", asOfBasis: "OBSERVED", verification: "SEARCH_LISTING", evidenceId: "e1", ...extra });
const valuation = (over = {}) => ({ method: "PROVISIONAL_LISTINGS", comparables: [{ priceId: "p1", candidate: "SUCCESSOR", verification: "SEARCH_LISTING" }], excluded: [], reference: null, notes: [], ...over });

test("a laptop listing whose configuration was not matched is context only, with its own reason; a listing set aside for its spread says that", () => {
  const unmatched = listing("p2", "SUCCESSOR", { configConfirmed: false });
  assert.deepEqual(RS.priceRole({ valuation: valuation() }, unmatched), { role: "CONTEXT_ONLY", note: "CONFIG_NOT_CONFIRMED", exclusion: null });
  assert.match(RS.PRICE_ROLE_REASONS.CONFIG_NOT_CONFIRMED, /processor, memory and storage are not matched to what you described/);
  assert.equal(RS.PRICE_ROLE_REASONS.CONFIG_NOT_CONFIRMED.includes("range."), true);
  // Not among the comparables, for the same candidate, while the engine reports that it trimmed listings.
  const trimmedValuation = valuation({ notes: [{ code: "LISTINGS_SPREAD_TRIMMED", count: 1 }] });
  assert.deepEqual(RS.priceRole({ valuation: trimmedValuation }, listing("p3", "SUCCESSOR")), { role: "CONTEXT_ONLY", note: "SPREAD_TRIMMED", exclusion: null });
  assert.match(RS.PRICE_ROLE_REASONS.SPREAD_TRIMMED, /too far from the other listings/);
  // The one that set the range is still marked as setting it, and without the engine's note a price outside it is just not comparable.
  assert.equal(RS.priceRole({ valuation: trimmedValuation }, listing("p1", "SUCCESSOR")).role, "USED_IN_RANGE");
  assert.equal(RS.priceRole({ valuation: valuation() }, listing("p3", "SUCCESSOR")).note, "NOT_COMPARABLE");
});

// ---- the answer to "what processor, RAM and storage?" is a detail of the same laptop ----------------------------------------------------------

const QUESTION = "What processor, RAM and storage does it have? (for example Core i5, 16 GB, 512 GB)";
const asked = (base) => RS.adopt(RS.initialSession(), "new", base, { query: base, refinements: [] }, researchResponse({ clarify: [QUESTION] }));

test("the reply that gives the configuration is more detail on the same laptop, however it is worded", () => {
  const session = asked("Asus vivobook 15");
  for (const reply of ["core i5, 16gb ram, 512gb ssd", "i5 16gb 512gb", "Ryzen 5, 8GB, 256GB", "it has an i7 with 16 GB and a 1TB SSD"]) {
    assert.equal(RS.classify(session, reply).kind, "refine", reply);
    assert.equal(RS.turnIntent(session, reply), "FOLLOW_UP", reply);
  }
  assert.deepEqual(RS.composeQuery(session, "core i5, 16gb, 512gb", "refine"), { query: "Asus vivobook 15, core i5, 16gb, 512gb", refinements: ["core i5, 16gb, 512gb"] });
});

test("a processor class is not a model code: it never turns the answer into a different product, even for a laptop typed with its model", () => {
  const session = asked("Asus F1502ZA vivobook");
  assert.equal(RS.classify(session, "i5, 16gb, 512gb").kind, "refine");
  assert.equal(RS.classify(session, "ddr5 16gb 1tb").kind, "refine");
  assert.equal(RS.classify(asked("MacBook Air A2681"), "M2, 8gb, 256gb").kind, "refine", "an Apple chip answers the question too");
  assert.equal(RS.classify(session, "Asus M1502YA").kind, "new", "another model code is still another product");
  assert.equal(RS.classify(asked("LG C3 OLED TV"), "Samsung QN55Q80C").kind, "new");
});
