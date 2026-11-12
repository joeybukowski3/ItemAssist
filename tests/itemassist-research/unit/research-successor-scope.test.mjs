import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

// OFFLINE ONLY. Stage A: how the page labels a successor candidate and describes the scope of a price, from the fields research.2 already carries.
// The two successor fixtures are real pipeline output built from the engine's captured Shopping rows for "LG C3 55 inch" (2026-10-23):
//   family-mixed       what Production returns today: a family-level successor whose listings span C5 and C6
//   single-listing     one retailer listing that names OLED55C6PUA (the shape the engine emits once the model code is carried into evidence)
const require = createRequire(import.meta.url);
const RS = require("../../../assets/js/rf-research.js");
const { projectResearch } = require("../../../api/_lib/itemassist-research/projection.js");
const { research2Response, RESEARCH2_SCENARIOS } = require("../fixtures/research.js");

const load = (name) => JSON.parse(readFileSync(new URL(`../fixtures/successor/${name}.engine.json`, import.meta.url), "utf8"));
const LIVE = { requestId: "req-1", elapsedMs: 5, quota: null, allowLive: true };
const projected = (name) => projectResearch(load(name), LIVE);
const clone = (value) => JSON.parse(JSON.stringify(value));
const withStatus = (data, modelStatus, standing = "RECOMMENDED", concern = null) => ({ ...data, successor: { ...data.successor, modelStatus, standing, concern } });
const sessionWith = (data) => ({ base: "item", refinements: [], pending: [], last: data });

test("both successor fixtures are accepted by the current research.2 projection unchanged (existing responses stay compatible)", () => {
  for (const name of ["lg-c3-family-mixed", "lg-c3-c6-single-listing"]) {
    const out = projected(name);
    assert.ok(out, name);
    assert.equal(RS.isResearchResponse(out), true, name);
  }
});

test("a successor identified only as a product family is never called a direct successor, whatever its standing says", () => {
  const family = projected("lg-c3-family-mixed");
  assert.equal(family.successor.modelStatus, "FAMILY_LEVEL");
  assert.equal(family.successor.standing, "RECOMMENDED", "the engine's standing is the model's confidence, not evidence");
  assert.equal(RS.successorLabel(family.successor, true).text, "Likely Successor Family");
  assert.equal(RS.successorLabel(withStatus(family, "UNVERIFIED_MODEL").successor, true).text, "Likely successor, model not confirmed");
  assert.equal(RS.successorLabel(withStatus(family, "LISTED_PROVISIONAL").successor, true).text, "Likely successor, model seen in a listing");
  // Only an explicit FAMILY_LEVEL is read as a family; a status this page does not know is "not confirmed", never a claim about what the candidate is.
  assert.equal(RS.successorLabel({ standing: "CONDITIONAL", concern: null, modelStatus: undefined }, true).text, "Likely successor, model not confirmed");
  assert.equal(RS.successorLabel({ standing: "RECOMMENDED", concern: null, modelStatus: "SOMETHING_NEW" }, true).text, "Likely successor, model not confirmed");
});

test("direct-successor wording is reserved for a model confirmed on a cited page; a caveat is shown only with its concern", () => {
  const base = projected("lg-c3-c6-single-listing");
  assert.equal(RS.successorLabel(withStatus(base, "VERIFIED_LISTING").successor, true).text, "Direct successor");
  assert.equal(RS.successorLabel(withStatus(base, "VERIFIED_LISTING", "CONDITIONAL", "Check the door swing.").successor, true).text, "Successor, with a caveat");
  assert.equal(RS.successorLabel(withStatus(base, "VERIFIED_LISTING", "CONDITIONAL", null).successor, true), null, "a bare caveat with no concern shows nothing");
  assert.equal(RS.successorLabel(withStatus(base, "LISTED_PROVISIONAL").successor, true).text.includes("Direct"), false);
});

test("research.1 keeps its labels exactly", () => {
  assert.equal(RS.successorLabel({ standing: "RECOMMENDED" }, false).text, "Direct successor");
  assert.equal(RS.successorLabel({ standing: "CONDITIONAL" }, false).text, "Successor, with a caveat");
});

test("price scope: family pricing across generations is not a price for one model", () => {
  const scope = RS.priceScope(projected("lg-c3-family-mixed"));
  assert.equal(scope.kind, "FAMILY_AMBIGUOUS");
  assert.equal(scope.model, null);
  assert.ok(scope.listings >= 2);
  const line = RS.scopeLines(projected("lg-c3-family-mixed")).join(" ");
  assert.match(line, /family pricing/i);
  assert.match(line, /not a price for one specific model/i);
  assert.doesNotMatch(line, /OLED55C6PUA/, "a model that only one of the listings names is not the scope of the range");
});

test("price scope: one listing that names its model is a single provisional listing, not a market price", () => {
  const data = projected("lg-c3-c6-single-listing");
  const scope = RS.priceScope(data);
  assert.equal(scope.kind, "EXACT_MODEL_SINGLE_LISTING");
  assert.equal(scope.model, "OLED55C6PUA");
  assert.equal(scope.sellers, 1);
  const line = RS.scopeLines(data).join(" ");
  assert.match(line, /one retailer listing that names OLED55C6PUA/i);
  assert.match(line, /does not confirm/i);
  assert.doesNotMatch(line, /corroborat/i);
});

test("price scope: listings from several sellers that name the same model corroborate each other, and are still listings", () => {
  const data = clone(projected("lg-c3-c6-single-listing"));
  const first = data.pricing.prices[0];
  data.pricing.prices = [first, { ...first, id: "p3", amount: { currency: "USD", low: 1009.99, high: 1009.99 }, evidenceId: "e2" }, data.pricing.prices[1]];
  data.pricing.evidence = [data.pricing.evidence[0], { ...data.pricing.evidence[0], id: "e2", sourceName: "Abt", sourceDomain: "abt.com", sourceUrl: "https://www.abt.com/" }];
  data.pricing.valuation = { ...data.pricing.valuation, range: { currency: "USD", low: 999.99, high: 1009.99 }, comparables: [{ priceId: "p1", candidate: "SUCCESSOR", verification: "SEARCH_LISTING" }, { priceId: "p3", candidate: "SUCCESSOR", verification: "SEARCH_LISTING" }] };
  const scope = RS.priceScope(data);
  assert.equal(scope.kind, "EXACT_MODEL_CORROBORATED");
  assert.equal(scope.sellers, 2);
  assert.match(RS.scopeLines(data).join(" "), /2 listings from 2 sellers name OLED55C6PUA/);
  assert.match(RS.scopeLines(data).join(" "), /still not confirmed on a (?:product|seller)/i);
});

test("price scope: a single listing that states no model cannot be tied to one model; estimates and empty valuations have their own scope", () => {
  const data = clone(projected("lg-c3-c6-single-listing"));
  data.pricing.prices[0].model = null;
  assert.equal(RS.priceScope(data).kind, "SINGLE_LISTING_MODEL_NOT_STATED");
  assert.match(RS.scopeLines(data).join(" "), /does not state its exact model/i);
  const kinds = Object.fromEntries(RESEARCH2_SCENARIOS.map((id) => [id, RS.priceScope(research2Response(id)).kind]));
  assert.equal(kinds["tv-strong-retail"], "CONFIRMED");
  assert.equal(kinds["insufficient"], "NONE");
  assert.ok(["ESTIMATE", "NONE"].includes(kinds["sparse-estimate"]), kinds["sparse-estimate"]);
});

test("chat and pricing card are built from the same scope sentences, so they can never describe different scopes", () => {
  for (const name of ["lg-c3-family-mixed", "lg-c3-c6-single-listing"]) {
    const data = projected(name);
    const chat = RS.reply(data, null).lines;
    const scope = RS.scopeLines(data);
    assert.ok(scope.length >= 1, name);
    for (const sentence of scope) assert.ok(chat.includes(sentence), `${name}: chat is missing "${sentence}"`);
    const answer = RS.localAnswer(sessionWith(data), "how much is it worth?");
    for (const sentence of scope) assert.ok(answer.includes(sentence), `${name}: the value answer is missing "${sentence}"`);
  }
});

test("the chat names the successor as a family when it is one, and does not call it the closest successor outright", () => {
  const family = RS.reply(projected("lg-c3-family-mixed"), null).lines;
  assert.ok(family.some((line) => /^Likely successor family: LG C-series OLED\./.test(line)), family.join("\n"));
  assert.ok(family.some((line) => /generation|exact model/i.test(line) && /not identified|couldn't identify|not confirmed/i.test(line)));
  assert.equal(family.some((line) => line.startsWith("Closest successor to consider")), false);
  const listed = RS.reply(projected("lg-c3-c6-single-listing"), null).lines;
  assert.ok(listed.some((line) => /^Likely successor: LG C6 OLED 55-inch \(OLED55C6PUA\)/.test(line) && /listing/.test(line) && /not confirmed/.test(line)), listed.join("\n"));
  const verified = RS.reply(withStatus(projected("lg-c3-c6-single-listing"), "VERIFIED_LISTING"), null).lines;
  assert.ok(verified.some((line) => line === "Closest successor to consider: LG C6 OLED 55-inch (OLED55C6PUA)."), verified.join("\n"));
});

test("the candidate card shows the lowest of the listings behind the figure, and says so when the figure is a range", () => {
  const data = projected("lg-c3-family-mixed");
  const pick = RS.candidatePriceFor(data, "SUCCESSOR");
  assert.ok(pick.price);
  const comparable = data.pricing.valuation.comparables.map((row) => data.pricing.prices.find((p) => p.id === row.priceId));
  assert.equal(pick.price.amount.low, Math.min(...comparable.map((p) => p.amount.low)), "a listing that sets the range, the lowest one");
  assert.equal(pick.of, comparable.length);
  assert.match(RS.CANDIDATE_PRICE_CAPTION(pick.of), /lowest of 3 listings behind the figure on the Overview/);
  assert.equal(RS.candidatePriceFor(projected("lg-c3-c6-single-listing"), "SUCCESSOR").of, 1);
  assert.equal(RS.candidatePriceFor(projected("lg-c3-c6-single-listing"), "ALT_1").price, null);
});

test("an unsized or excluded listing is never the one shown for a candidate when a listing that sets the range exists", () => {
  const data = clone(projected("lg-c3-family-mixed"));
  const unsized = data.pricing.prices.find((p) => p.sizeConfirmed === false);
  assert.ok(unsized);
  assert.notEqual(RS.candidatePriceFor(data, "SUCCESSOR").price.id, unsized.id);
});

test("a seller's homepage is not a verifying link; a page on the seller's site is", () => {
  assert.equal(RS.isSellerSiteOnly("https://www.bestbuy.com/"), true);
  assert.equal(RS.isSellerSiteOnly("https://www.bestbuy.com"), true);
  assert.equal(RS.isSellerSiteOnly("https://www.bestbuy.com/site/lg-c6/6590000.p"), false);
  assert.equal(RS.isSellerSiteOnly("not a url"), false);
  assert.equal(RS.isSellerSiteOnly(null), false);
});

// ---- findings from the independent review of Stage A -------------------------------------------------------------------------------------------

const twoSellers = () => {
  const data = clone(projected("lg-c3-c6-single-listing"));
  const first = data.pricing.prices[0];
  data.pricing.prices = [first, { ...first, id: "p3", amount: { currency: "USD", low: 1009.99, high: 1009.99 }, evidenceId: "e2" }, data.pricing.prices[1]];
  data.pricing.evidence = [data.pricing.evidence[0], { ...data.pricing.evidence[0], id: "e2", sourceName: "Abt", sourceDomain: "abt.com", sourceUrl: "https://www.abt.com/" }];
  data.pricing.valuation = { ...data.pricing.valuation, range: { currency: "USD", low: 999.99, high: 1009.99 }, comparables: [{ priceId: "p1", candidate: "SUCCESSOR", verification: "SEARCH_LISTING" }, { priceId: "p3", candidate: "SUCCESSOR", verification: "SEARCH_LISTING" }] };
  return data;
};

test("listings of one model at very different prices are not said to corroborate each other", () => {
  const data = twoSellers();
  assert.equal(RS.priceScope(data).agree, true);
  assert.match(RS.scopeLines(data)[0], /corroborate each other/);
  data.pricing.prices[1] = { ...data.pricing.prices[1], amount: { currency: "USD", low: 1499, high: 1499 } };
  data.pricing.valuation.range = { currency: "USD", low: 999.99, high: 1499 };
  const scope = RS.priceScope(data);
  assert.equal(scope.kind, "EXACT_MODEL_CORROBORATED");
  assert.equal(scope.agree, false);
  assert.doesNotMatch(RS.scopeLines(data)[0], /corroborate/);
  assert.match(RS.scopeLines(data)[0], /name OLED55C6PUA, at different prices/);
});

test("a listing whose source is missing is never counted as another seller", () => {
  const data = twoSellers();
  data.pricing.prices[1] = { ...data.pricing.prices[1], evidenceId: "e99" };
  const scope = RS.priceScope(data);
  assert.equal(scope.sellers, 1);
  assert.equal(scope.kind, "EXACT_MODEL_SINGLE_LISTING", "two listings, one nameable seller: not corroborated");
  assert.doesNotMatch(RS.scopeLines(data).join(" "), /corroborate each other/);
  assert.match(RS.scopeLines(data)[0], /One seller cannot corroborate a price/);
});

test("comparables across several candidates are described as such, and the candidate caption says what the figure also includes", () => {
  const data = twoSellers();
  const alt = { ...data.pricing.prices[0], id: "p4", candidate: "ALT_1", model: "XR65A95L", amount: { currency: "USD", low: 1698, high: 1698 } };
  data.pricing.prices.push(alt);
  data.pricing.valuation.comparables.push({ priceId: "p4", candidate: "ALT_1", verification: "SEARCH_LISTING" });
  data.pricing.valuation.range = { currency: "USD", low: 999.99, high: 1698 };
  const scope = RS.priceScope(data);
  assert.deepEqual([scope.kind, scope.candidates, scope.candidate], ["MULTI_CANDIDATE", 2, null]);
  const lines = RS.scopeLines(data);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /3 listings are for more than one candidate/);
  assert.doesNotMatch(lines.join(" "), /shows the lowest/, "no claim that one candidate card shows the lowest of all the listings");
  const successor = RS.candidatePriceFor(data, "SUCCESSOR");
  assert.deepEqual([successor.of, successor.total], [2, 3]);
  assert.equal(RS.CANDIDATE_PRICE_CAPTION(successor.of, successor.total), "This is the lowest of 2 listings of this candidate behind the figure on the Overview, which also includes 1 listing from other candidates.");
  const other = RS.candidatePriceFor(data, "ALT_1");
  assert.equal(RS.CANDIDATE_PRICE_CAPTION(other.of, other.total), "This is the only listing of this candidate behind the figure on the Overview, which also includes 2 listings from other candidates.");
  assert.equal(RS.CANDIDATE_PRICE_CAPTION(1, 1), null);
});

test("a valuation that includes prices confirmed on the cited page is not described as listings only", () => {
  const data = twoSellers();
  data.pricing.prices[1] = { ...data.pricing.prices[1], verification: "VERIFIED_PAGE" };
  data.pricing.valuation.comparables[1] = { ...data.pricing.valuation.comparables[1], verification: "VERIFIED_PAGE" };
  data.pricing.valuation.method = "MIXED_VERIFIED_AND_LISTINGS";
  assert.equal(RS.priceScope(data).kind, "MIXED_VERIFIED");
  assert.deepEqual(RS.scopeLines(data), [], "the valuation line already says which prices are confirmed");
});

test("the unverified-model chat line does not repeat the unconfirmed-identity line the reply already adds", () => {
  const unconfirmed = withStatus(projected("lg-c3-c6-single-listing"), "UNVERIFIED_MODEL");
  const lines = RS.reply(unconfirmed, null).lines;
  assert.ok(lines.includes("Likely successor: LG C6 OLED 55-inch (OLED55C6PUA)."));
  assert.equal(lines.filter((line) => /exact model/i.test(line)).length, 1, "one line about the unconfirmed model identity, not two");
});
