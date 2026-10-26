import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// OFFLINE ONLY. The research.2 wording the page shows: every price-related code has fixed wording, an estimate is never worded as confirmed,
// a historical price is never worded as current, and a research.1 response keeps working unchanged.
const require = createRequire(import.meta.url);
const RS = require("../../../assets/js/rf-research.js");
const V2 = require("../../../api/_lib/itemassist-research/projection-v2.js");
const { research2Response, researchResponse, RESEARCH2_SCENARIOS } = require("../fixtures/research.js");

const clone = (value) => JSON.parse(JSON.stringify(value));
const scenario = (id) => research2Response(id);
const sessionWith = (data) => ({ base: "item", refinements: [], pending: [], last: data });

test("isResearchResponse accepts research.1 and a complete research.2, and nothing else", () => {
  assert.equal(RS.isResearchResponse(researchResponse()), true);
  for (const id of RESEARCH2_SCENARIOS) assert.equal(RS.isResearchResponse(scenario(id)), true, id);
  const v2 = scenario("fridge-constraints");
  assert.equal(RS.isResearchResponse({ ...v2, contractVersion: "research.3" }), false);
  assert.equal(RS.isResearchResponse({ ...v2, pricing: undefined }), false);
  assert.equal(RS.isResearchResponse({ ...v2, pricing: { ...v2.pricing, valuation: null } }), false);
  assert.equal(RS.isResearchResponse({ ...v2, pricing: { ...v2.pricing, prices: "none" } }), false);
  assert.equal(RS.isResearchResponse({ ...v2, requirements: ["a string requirement"] }), false, "research.2 requirements are objects");
  assert.equal(RS.isResearchResponse({ ...researchResponse(), requirements: [{ text: "object" }] }), true, "research.1 is not inspected for v2 rules");
  assert.equal(RS.isResearchResponse({ ...v2, kind: "OTHER" }), false);
});

test("a confirmed price is worded as confirmed only for confirmed methods", () => {
  for (const id of RESEARCH2_SCENARIOS) {
    const data = scenario(id);
    const valuation = data.pricing.valuation;
    const line = RS.valuationLine(valuation);
    assert.ok(line, id);
    if (valuation.verified) assert.match(line, /cited seller pages|One confirmed current new-retail price/, id);
    else assert.doesNotMatch(line, /cited seller pages|One confirmed|verified/i, id);
    if (["HISTORICAL_TIER_ESTIMATE", "AI_ESTIMATE_ONLY"].includes(valuation.method)) assert.match(line, /estimate/i, id);
    if (["MIXED_VERIFIED_AND_LISTINGS", "PROVISIONAL_LISTINGS"].includes(valuation.method)) assert.match(line, /not confirmed on the product page|None is confirmed/, id);
    // Nothing says a search or a check happened that did not: no "found", "could not find" or "couldn't confirm" claims.
    assert.doesNotMatch(line, /\bfound\b|couldn't|could not|searched|looked/i, id);
  }
});

test("the valuation line names the range, the date it applies to, and says nothing without evidence", () => {
  assert.equal(RS.valuationLine(scenario("fridge-constraints").pricing.valuation), "One confirmed current new-retail price: $2,399, as of Oct 21, 2026.");
  assert.match(RS.valuationLine(scenario("tv-strong-retail").pricing.valuation), /cited seller pages: \$1,499 to \$1,649, as of Oct 21, 2026/);
  assert.equal(RS.valuationLine(scenario("insufficient").pricing.valuation), "There isn't enough evidence to estimate a value yet.");
  const noRange = { ...scenario("tv-strong-retail").pricing.valuation, range: null };
  assert.equal(RS.valuationLine(noRange), null, "a range-based method without a range yields no sentence rather than a made-up one");
});

test("a historical price is described as context, never as today's price", () => {
  const sparse = scenario("sparse-estimate");
  const reference = RS.referencePrice(sparse.pricing);
  assert.equal(reference.kind, "MSRP");
  assert.equal(RS.label(RS.PRICE_KIND_LABELS, reference.kind), "Original list price (MSRP)");
  assert.doesNotMatch(Object.values(RS.PRICE_KIND_LABELS).filter((text) => /current/i.test(text)).join("|"), /MSRP|past|historical/i);
  assert.match(RS.noteText({ code: "STALE_PRICES_NOT_CURRENT", count: 2 }), /Older prices are never shown as current/);
  assert.match(RS.noteText({ code: "MSRP_CONTEXT_ONLY" }), /context only/);
  assert.equal(RS.label(RS.DATE_LABELS, "PUBLISHED"), "Published");
  assert.equal(RS.label(RS.DATE_LABELS, "UNKNOWN"), "Date not stated");
});

test("a past retail price is never called a list price, and another family's price is listed apart rather than hidden or blended", () => {
  assert.match(RS.noteText({ code: "MSRP_CONTEXT_ONLY" }, { referenceKind: "MSRP" }), /^The original's list price is context only/);
  assert.match(RS.noteText({ code: "MSRP_CONTEXT_ONLY" }, { referenceKind: "HISTORICAL_RETAIL" }), /^The original's past retail price is context only/);
  assert.equal(RS.noteText({ code: "OTHER_FAMILIES_SEPARATE", count: 1 }), "Prices for another candidate family are listed separately. They do not set this range.");
  assert.equal(RS.noteText({ code: "OTHER_FAMILIES_SEPARATE", count: 2 }), "Prices for 2 other candidate families are listed separately. They do not set this range.");
  const price = (id, candidate) => ({ id, kind: "CURRENT_RETAIL_NEW", subject: "REPLACEMENT", candidate, amount: { currency: "USD", low: 1000, high: 1000 } });
  const pricing = { prices: [price("p1", "SUCCESSOR"), price("p2", "ALT_1"), price("p3", "ALT_2")], valuation: { method: "PROVISIONAL_LISTINGS", comparables: [{ priceId: "p1", candidate: "SUCCESSOR", verification: "SEARCH_LISTING" }], excluded: [{ candidate: "ALT_2", reason: "NO_CURRENT_PRICE" }], reference: null } };
  assert.deepEqual(RS.priceRole(pricing, pricing.prices[0]), { role: "USED_IN_RANGE", note: "CURRENT_COMPARABLE", exclusion: null });
  assert.deepEqual(RS.priceRole(pricing, pricing.prices[1]), { role: "CONTEXT_ONLY", note: "OTHER_FAMILY", exclusion: null }, "a priced family that does not set the headline is context, with its own reason");
  assert.equal(RS.priceRole(pricing, pricing.prices[2]).role, "EXCLUDED", "an excluded candidate keeps its exclusion reason");
  assert.match(RS.label(RS.PRICE_ROLE_REASONS, "OTHER_FAMILY"), /different candidate family/);
});

test("one qualifying listing is worded as a single listing price, never as a range or a value conclusion; a size-unconfirmed listing is context", () => {
  const listing = (comparables) => ({ method: "PROVISIONAL_LISTINGS", range: { low: 1096, high: 1096 }, asOf: "2026-10-26", comparables: comparables.map((priceId) => ({ priceId, candidate: "SUCCESSOR", verification: "SEARCH_LISTING" })) });
  const single = RS.valuationLine(listing(["p1"]));
  assert.equal(single, "One retailer listing shows $1,096, as of Oct 26, 2026. It is a single listing price, not confirmed on the product page, and not a value range.");
  assert.doesNotMatch(single, /appraisal|fair value|guaranteed|provisional|worth/i);
  assert.match(RS.valuationLine({ ...listing(["p1", "p2"]), range: { low: 999, high: 1096 } }), /^Retailer listings suggest roughly \$999 to \$1,096/, "two or more listings keep the range wording");
  const price = (id, extra = {}) => ({ id, kind: "CURRENT_RETAIL_NEW", subject: "REPLACEMENT", candidate: "ALT_1", amount: { currency: "USD", low: 1398, high: 1398 }, ...extra });
  const pricing = { prices: [price("p1"), price("p2", { sizeConfirmed: false })], valuation: { method: "PROVISIONAL_LISTINGS", comparables: [], excluded: [{ candidate: "ALT_1", reason: "NO_CURRENT_PRICE" }], reference: null } };
  assert.deepEqual(RS.priceRole(pricing, pricing.prices[1]), { role: "CONTEXT_ONLY", note: "SIZE_NOT_CONFIRMED", exclusion: null }, "an example stays context even though its candidate is excluded");
  assert.equal(RS.priceRole(pricing, pricing.prices[0]).role, "EXCLUDED");
  assert.match(RS.label(RS.PRICE_ROLE_REASONS, "SIZE_NOT_CONFIRMED"), /does not state the screen size.*does not confirm a match/);
});

test("the original's price history keeps every dated source (list price first, then by date), keeps an AI estimate apart, and describes a spread in one sentence", () => {
  const price = (id, kind, low, high, asOf, subject = "ORIGINAL") => ({ id, kind, subject, candidate: null, amount: { currency: "USD", low, high }, asOf });
  const prices = [price("p3", "HISTORICAL_RETAIL", 3299, 3299, "2025-05-14"), price("p1", "HISTORICAL_RETAIL", 2600, 2600, "2023-04-11"), price("p2", "MSRP", 2699, 2699, "2023-03-01"),
    price("p4", "AI_ESTIMATE", 2000, 3000, null), price("p5", "CURRENT_RETAIL_NEW", 1099, 1099, "2026-10-23", "REPLACEMENT")];
  const history = RS.originalPrices({ prices });
  assert.deepEqual(history.sourced.map((item) => item.id), ["p2", "p1", "p3"]);
  assert.equal(history.estimate.id, "p4");
  assert.equal(RS.historySummary({ prices }), "Dated sources put the original at $2,600 to $3,299 when new. They differ, so each is shown.");
  assert.equal(RS.historySummary({ prices: [price("p1", "MSRP", 1899, 1899, "2023-02-28"), price("p2", "HISTORICAL_RETAIL", 1899, 1899, "2023-03-02")] }), "Dated sources agree on $1,899 for the original when new.");
  assert.equal(RS.historySummary({ prices: [price("p1", "MSRP", 1899, 1899, "2023-02-28")] }), null, "one sourced price needs no summary");
  assert.equal(RS.historySummary({ prices: [price("p4", "AI_ESTIMATE", 2000, 3000, null)] }), "No dated price is included. An AI estimate puts the original at $2,000 to $3,000 when new.");
  assert.equal(RS.historySummary({ prices: [price("p5", "CURRENT_RETAIL_NEW", 1099, 1099, "2026-10-23", "REPLACEMENT")] }), null);
  assert.deepEqual(RS.originalPrices(null), { sourced: [], estimate: null });
  assert.doesNotMatch([RS.noteText({ code: "NOT_AN_APPRAISAL" }), RS.noteText({ code: "ONE_COMPARABLE" }), RS.noteText({ code: "LISTINGS_NOT_CONFIRMED" }), RS.valuationLine({ method: "PROVISIONAL_LISTINGS", range: { low: 999, high: 1449 }, asOf: "2026-10-23" })].join(" "), /appraisal|fair value|guaranteed|provisional/i, "no formal-appraisal wording");
});

test("every code the proxy can send has fixed wording: no code falls through to blank or to the response's own words", () => {
  for (const kind of V2.PRICE_KINDS) assert.ok(RS.label(RS.PRICE_KIND_LABELS, kind), kind);
  for (const verification of V2.VERIFICATIONS) assert.ok(RS.label(RS.VERIFICATION_LABELS, verification), verification);
  for (const method of Object.keys(V2.METHODS)) assert.ok(RS.label(RS.METHOD_LABELS, method), method);
  for (const status of V2.MODEL_STATUSES) assert.ok(RS.label(RS.MODEL_STATUS_LABELS, status), status);
  for (const reason of V2.REJECTION_REASONS) assert.ok(RS.label(RS.REJECTION_REASON_LABELS, reason), reason);
  for (const cls of ["MANUFACTURER", "RETAILER", "REVIEW", "TECH_DATABASE", "MARKETPLACE"]) assert.ok(RS.label(RS.SOURCE_CLASS_LABELS, cls), cls);
  for (const relation of ["EXACT", "VARIANT", "DIFFERENT", "UNKNOWN"]) assert.ok(RS.label(RS.MODEL_RELATION_LABELS, relation), relation);
  for (const reason of ["NO_CURRENT_PRICE", "CONFIRMED_ESSENTIAL_SHORTFALL", "SUSPECTED_ESSENTIAL_SHORTFALL"]) assert.ok(RS.label(RS.EXCLUSION_LABELS, reason), reason);
  for (const level of ["VALUE", "STANDARD", "PREMIUM", "UPPER_PREMIUM", "LUXURY", "UNKNOWN"]) assert.ok(RS.label(RS.TIER_LABELS, level), level);
  for (const [code, params] of Object.entries(V2.NOTE_PARAMS)) {
    const sample = { code, ...Object.fromEntries(params.map((param) => [param, param === "candidate" ? "ALT_1" : param === "count" ? 2 : 0.8])) };
    const text = RS.noteText(sample);
    assert.ok(text && !/undefined|NaN/.test(text), code);
  }
  assert.equal(RS.noteText({ code: "SELLING_FAST" }), null);
  assert.equal(RS.noteText(null), null);
  assert.equal(RS.label(RS.PRICE_KIND_LABELS, "__proto__", "fallback"), "fallback");
});

test("estimated comparisons are labelled estimates and the model-status wording never claims an unconfirmed model exists", () => {
  assert.equal(RS.label(RS.BASIS_LABELS, "AI_ESTIMATE"), "AI estimate");
  assert.equal(RS.label(RS.MODEL_STATUS_LABELS, "UNVERIFIED_MODEL"), "Exact model identity has not been independently confirmed");
  assert.match(RS.label(RS.MODEL_STATUS_LABELS, "LISTED_PROVISIONAL"), /not confirmed/);
  assert.match(RS.label(RS.MODEL_STATUS_LABELS, "FAMILY_LEVEL"), /exact model not confirmed/);
});

test("the wording never claims a search, a fetch or a source check that did not happen", () => {
  // Every fixed table and note, scanned for phrases that would imply a search was run, a page was fetched, or a source was checked.
  const everything = [
    ...Object.values(RS.VERIFICATION_LABELS), ...Object.values(RS.MODEL_STATUS_LABELS), ...Object.values(RS.MODEL_RELATION_LABELS), ...Object.values(RS.EXCLUSION_LABELS),
    ...Object.values(RS.REJECTION_REASON_LABELS), ...Object.values(RS.PRICE_ROLE_REASONS), ...Object.values(RS.PRICE_ROLE_LABELS), ...Object.values(RS.METHOD_LABELS),
    ...Object.entries(V2.NOTE_PARAMS).map(([code, params]) => RS.noteText({ code, ...Object.fromEntries(params.map((param) => [param, param === "candidate" ? "ALT_1" : param === "count" ? 2 : 0.8])) }))
  ];
  for (const text of everything) {
    assert.doesNotMatch(text, /not found in any|in any source|was found|were found|couldn't find|could not find|could not be confirmed as real|searched|looked for|exhaustive|every source/i, text);
  }
  assert.equal(RS.label(RS.EXCLUSION_LABELS, "NO_CURRENT_PRICE"), "Not in the range: no current retail price is included in this research");
  assert.match(RS.label(RS.VERIFICATION_LABELS, "VERIFIED_PAGE"), /cited source page/);
  assert.match(RS.label(RS.MODEL_RELATION_LABELS, "UNKNOWN"), /not shown in the evidence/);
});

test("the assistant's reply for research.2 carries the valuation, the exclusions and the caveats, and never says 'verified' for an estimate", () => {
  const fridge = RS.reply(scenario("fridge-constraints"), null);
  assert.ok(fridge.lines.some((line) => /One confirmed current new-retail price: \$2,399/.test(line)));
  assert.ok(fridge.lines.some((line) => /left 1 candidate out of the value range because it falls short of an essential requirement/.test(line)));
  assert.ok(fridge.lines.includes("Candidates are suggestions, not confirmed equivalents."));
  const washer = RS.reply(scenario("washer-dimensions"), null);
  assert.ok(washer.lines.some((line) => /not confirmed on the product page/.test(line)));
  const unsupported = RS.reply(scenario("unsupported-claims"), null);
  assert.ok(unsupported.lines.some((line) => /Exact model identity for LG OLED77C4PUA has not been independently confirmed/.test(line)));
  for (const id of ["ambiguous-model", "sparse-estimate", "unsupported-claims", "tv-premium-oled", "washer-dimensions"]) {
    const text = RS.reply(scenario(id), null).lines.join(" ");
    assert.doesNotMatch(text, /\bverified\b|cited seller pages|One confirmed/i, id);
  }
  for (const id of RESEARCH2_SCENARIOS) assert.doesNotMatch(RS.reply(scenario(id), null).lines.join(" "), /in any source|couldn't find|exhaustive/i, id);
  const insufficient = RS.reply(scenario("insufficient"), null);
  assert.equal(insufficient.lines.some((line) => /\$\d/.test(line)), false, "no figure without evidence");
});

test("research.1 replies are unchanged: still the 'hasn't been verified' closing line and no valuation", () => {
  const lines = RS.reply(researchResponse(), null).lines;
  assert.equal(lines[lines.length - 1], "This is an AI estimate and hasn't been verified.");
  assert.equal(lines.some((line) => /\$\d/.test(line)), false);
});

test("a question about worth or price is answered from the valuation, with the date, the sources, and the reminder to check with a seller", () => {
  for (const question of ["what is it worth?", "how much should I expect to pay", "what was the original msrp", "what is the price"]) {
    const answer = RS.localAnswer(sessionWith(scenario("washer-dimensions")), question);
    assert.ok(Array.isArray(answer), question);
    assert.match(answer[0], /\$999 to \$1,099, as of Oct 21, 2026/, question);
    assert.ok(answer.some((line) => /Pricing & evidence/.test(line)), question);
    assert.ok(answer.some((line) => /Check specifications, availability and price with a seller/.test(line)), question);
  }
  const none = RS.localAnswer(sessionWith(scenario("insufficient")), "what is it worth?");
  assert.equal(none[0], "There isn't enough evidence to estimate a value yet.");
  assert.equal(none.some((line) => /Pricing & evidence/.test(line)), false, "no sources to point at");
  const v1 = RS.localAnswer(sessionWith(researchResponse()), "what is the price?");
  assert.match(v1[0], /doesn't check prices/);
});

test("a requirements question lists the weighted criteria with their importance", () => {
  const answer = RS.localAnswer(sessionWith(scenario("fridge-constraints")), "what should I match?");
  assert.equal(answer[0], "A replacement should match:");
  assert.ok(answer.some((line) => /Total capacity close to the original \(cubic feet\) \(essential\)/.test(line)));
  assert.ok(answer.some((line) => /\(minor\)$/.test(line)));
  const v1 = RS.localAnswer(sessionWith(researchResponse()), "what should I match?");
  assert.ok(v1.includes("• Same screen size class"));
});

test("money, range and date formatting is exact and refuses anything that is not a real value", () => {
  assert.equal(RS.formatMoney(2399), "$2,399");
  assert.equal(RS.formatMoney(2399.5), "$2,399.50");
  assert.equal(RS.formatMoney(NaN), null);
  assert.equal(RS.formatMoney("2399"), null);
  assert.equal(RS.formatRange({ low: 1199, high: 1399 }), "$1,199 to $1,399");
  assert.equal(RS.formatRange({ low: 2399, high: 2399 }), "$2,399");
  assert.equal(RS.formatRange(null), null);
  assert.equal(RS.formatRange({ low: 1, high: "x" }), null);
  assert.equal(RS.formatDay("2026-10-21"), "Oct 21, 2026");
  assert.equal(RS.formatDay("2026-02-30"), null, "an impossible date is refused, not shown as another day");
  assert.equal(RS.formatDay("2026-10-21T10:00:00Z"), null);
  assert.equal(RS.formatDay("yesterday"), null);
  assert.equal(RS.formatDay(null), null);
});

test("the demo-data note and the research.2 summary note never call an estimate verified", () => {
  assert.match(RS.DEMO_PRICE_NOTE, /illustrative, not real prices/);
  assert.match(RS.SUMMARY_NOTE_V2, /confirmed only when it comes from the cited source on the date shown/);
  assert.match(RS.SUMMARY_NOTE_V2, /every other figure is an estimate or an unconfirmed listing/);
  assert.match(RS.FINEPRINT_V2, /confirm specifications, availability and price with a seller/);
});

test("research.1 chat behaviour is unchanged: the value topic and the trailing-period tidy exist only for research.2", () => {
  const v1 = researchResponse();
  const buying = RS.localAnswer(sessionWith(v1), "what is the price?");
  assert.match(buying[0], /doesn't check prices/);
  // These questions had no local answer in research.1 and still have none (the research.2 "value" topic must not leak into it).
  for (const question of ["what is it worth?", "is it good value", "ballpark", "valuation please", "what is the msrp", "how much"]) {
    assert.equal(RS.localAnswer(sessionWith(v1), question), null, question);
  }
  // "price range" has always reached the buying answer through the word "price".
  assert.deepEqual(RS.localAnswer(sessionWith(v1), "price range?"), buying);
  // The same questions on research.2 are answered from the valuation.
  for (const question of ["what is it worth?", "is it good value", "ballpark"]) assert.ok(RS.localAnswer(sessionWith(scenario("fridge-constraints")), question), question);
  // research.1 punctuation: the uncertainty is relayed as given, so a trailing full stop doubles, exactly as before.
  const withNote = { ...v1, original: { ...v1.original, uncertainty: "Size not given." } };
  assert.ok(RS.reply(withNote, null).lines.includes("Not sure about: Size not given.."));
  const v2 = scenario("fridge-constraints");
  assert.ok(RS.reply({ ...v2, original: { ...v2.original, uncertainty: "Finish not given." } }, null).lines.includes("Not sure about: Finish not given."));
});

test("every price has exactly one role, and the roles reconcile with the valuation: what sets the range, what is context only, what was left out", () => {
  for (const id of RESEARCH2_SCENARIOS) {
    const { pricing } = scenario(id);
    const groups = RS.pricesByRole(pricing);
    const total = groups.USED_IN_RANGE.length + groups.CONTEXT_ONLY.length + groups.EXCLUDED.length;
    assert.equal(total, pricing.prices.length, `${id}: every price lands in exactly one group`);
    const setters = groups.USED_IN_RANGE.map((price) => price.id).sort();
    const expected = pricing.valuation.comparables.map((row) => row.priceId);
    if (pricing.valuation.method === "HISTORICAL_TIER_ESTIMATE") expected.push(pricing.valuation.reference.priceId);
    assert.deepEqual(setters, expected.sort(), `${id}: the prices that set the range are the valuation's comparables`);
    for (const price of groups.EXCLUDED) assert.ok(pricing.valuation.excluded.some((row) => row.candidate === price.candidate), `${id}: ${price.id} belongs to an excluded candidate`);
    for (const price of groups.CONTEXT_ONLY) assert.ok(RS.PRICE_ROLE_REASONS[RS.priceRole(pricing, price).note], `${id}: ${price.id} says why it is context only`);
  }
  const fridge = scenario("fridge-constraints").pricing;
  const role = (id) => RS.priceRole(fridge, fridge.prices.find((price) => price.id === id));
  assert.equal(role("p2").role, "USED_IN_RANGE");
  assert.deepEqual([role("p1").role, role("p1").note], ["CONTEXT_ONLY", "ORIGINAL_CONTEXT"], "the original's list price is context, never the range");
  assert.deepEqual([role("p3").role, role("p3").exclusion], ["EXCLUDED", "CONFIRMED_ESSENTIAL_SHORTFALL"], "the higher price of the candidate that falls short stays out");
  const sparse = scenario("sparse-estimate").pricing;
  assert.equal(RS.priceRole(sparse, sparse.prices[0]).note, "ESTIMATE_ANCHOR", "an estimate band says which price it scales");
  assert.equal(RS.priceRole(null, {}), null);
});
