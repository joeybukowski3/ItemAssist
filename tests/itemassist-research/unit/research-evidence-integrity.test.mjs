import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

// OFFLINE ONLY. Release 1 (evidence integrity), this side: a candidate's confidence is capped unless a cited page confirms its model, and the original's own
// manufacturer page (optional) is re-derived from its address and never trusted from the payload.
const require = createRequire(import.meta.url);
const RS = require("../../../assets/js/rf-research.js");
const { projectResearch } = require("../../../api/_lib/itemassist-research/projection.js");

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/successor/${name}.engine.json`, import.meta.url), "utf8"));
const LIVE = { requestId: "req-1", elapsedMs: 5, quota: null, allowLive: true };
const project = (body) => projectResearch(body, LIVE);
const clone = (value) => JSON.parse(JSON.stringify(value));
const PAGE = Object.freeze({
  url: "https://www.lg.com/us/tvs/lg-oled55c3pua-oled-4k-tv", domain: "lg.com", sourceName: "LG", sourceClass: "MANUFACTURER", model: "OLED55C3PUA", pageKind: "PRODUCT",
  title: "LG 55-inch Class C3 Series OLED evo 4K Smart TV", foundVia: "SEARCH_RESULT",
});
const withPages = (pages) => { const body = clone(fixture("lg-c3-after-stage-b")); body.original.manufacturerPages = pages; return body; };
const pagesOf = (body) => project(body).original.manufacturerPages;

test("a genuine US product page for the original survives exactly, and the response without one has no such key", () => {
  assert.deepEqual(pagesOf(withPages([clone(PAGE)])), [PAGE]);
  const out = project(withPages([clone(PAGE)]));
  assert.equal(RS.isResearchResponse(out), true);
  assert.equal(Object.hasOwn(project(fixture("lg-c3-after-stage-b")).original, "manufacturerPages"), false, "an engine that sends none: nothing is invented");
  assert.equal(Object.hasOwn(project(withPages([])).original, "manufacturerPages"), false, "an empty list is not carried");
});

test("the page is the original's only: it changes no price, evidence entry, candidate, status or valuation", () => {
  const plain = project(fixture("lg-c3-after-stage-b"));
  const out = project(withPages([clone(PAGE)]));
  const strip = (value) => { const copy = clone(value); delete copy.original.manufacturerPages; delete copy.meta; delete copy.quota; return JSON.stringify(copy); };
  assert.equal(strip(out), strip(plain));
  assert.equal(out.pricing.evidence.some((entry) => /lg\.com/.test(entry.url || "")), false, "no evidence entry cites the manufacturer page");
});

test("forged or off-model pages are dropped, never repaired", () => {
  const cases = {
    "a retailer": { url: "https://www.bestbuy.com/site/lg-oled55c3pua/6535177.p", domain: "bestbuy.com", sourceName: "Best Buy", sourceClass: "RETAILER" },
    "a regional storefront": { url: "https://www.lg.com/in/tvs/lg-oled55c3pua-oled-4k-tv", domain: "lg.com" },
    "a newsroom page with no model": { url: "https://www.lg.com/us/discover/lg-oled-evo-c3-news" },
    "a page for a different model than the one claimed": { model: "OLED55C4PUA" },
    "two different models in the address": { url: "https://www.lg.com/us/tvs/lg-oled55c3pua-vs-oled55c4pua-tv" },
    "an address that is not normalized (a query string)": { url: "https://www.lg.com/us/tvs/lg-oled55c3pua-oled-4k-tv?utm=x" },
    "an insecure address": { url: "http://www.lg.com/us/tvs/lg-oled55c3pua-oled-4k-tv" },
    "another maker's page for an LG original": { url: "https://www.samsung.com/us/tvs/oled/qn55s90daafxza/", domain: "samsung.com", sourceName: "Samsung", model: "QN55S90DAAFXZA" },
    "a claimed page kind the address does not have": { pageKind: "SUPPORT" },
    "a claimed provenance other than a search result": { foundVia: "FETCHED" },
    "an extra key": { price: "$1,299" },
    "a price in the title": { title: "LG OLED55C3PUA for $1,299.99" },
    "a link in the title": { title: "Buy now at https://example.com" },
  };
  for (const [label, change] of Object.entries(cases)) {
    assert.equal(pagesOf(withPages([{ ...clone(PAGE), ...change }])), undefined, label);
  }
  assert.equal(pagesOf(withPages(["https://www.lg.com/us/tvs/lg-oled55c3pua-oled-4k-tv"])), undefined, "a bare string");
  assert.equal(pagesOf(withPages({ ...PAGE })), undefined, "an object, not a list");
});

test("the registry, not the payload, decides the name, domain and class", () => {
  const mislabelled = { ...clone(PAGE), sourceName: "Official LG Store", domain: "evil.example" };
  // The projection re-derives them from the address, so an untruthful label is replaced by the registry's values rather than relayed.
  const kept = pagesOf(withPages([mislabelled]));
  assert.deepEqual(kept && kept.map((page) => [page.sourceName, page.domain]), [["LG", "lg.com"]]);
});

test("at most two pages, product pages first, no duplicates; a support page is labelled as one", () => {
  const support = { ...clone(PAGE), url: "https://www.lg.com/us/support/product/lg-OLED55C3PUA", pageKind: "SUPPORT", title: null };
  const second = { ...clone(PAGE), url: "https://www.lg.com/us/tvs/lg-oled55c3pua-black", title: null };
  const third = { ...clone(PAGE), url: "https://www.lg.com/us/tvs/lg-oled55c3pua-white", title: null };
  const kept = pagesOf(withPages([support, clone(PAGE), clone(PAGE), second, third]));
  assert.equal(kept.length, 2);
  assert.deepEqual(kept.map((page) => page.pageKind), ["PRODUCT", "PRODUCT"]);
  assert.deepEqual(pagesOf(withPages([support])).map((page) => page.pageKind), ["SUPPORT"]);
});

test("an unidentified original carries no page", () => {
  const body = withPages([clone(PAGE)]);
  body.original.identity = null;
  assert.equal(project(body)?.original?.manufacturerPages, undefined);
});

test("a candidate is HIGH only when a cited page confirms its model; an engine that predates the cap is lowered here", () => {
  for (const name of ["lg-c3-after-stage-b", "lg-c3-c6-single-listing", "samsung-s90c-after-stage-b", "lg-c3-family-mixed"]) {
    const out = project(fixture(name));
    for (const entry of [out.successor, ...out.suggestions].filter(Boolean)) {
      if (entry.confidence === "HIGH") assert.equal(entry.modelStatus, "VERIFIED_LISTING", `${name}: ${entry.name}`);
    }
  }
  const out = project(fixture("lg-c3-after-stage-b"));
  assert.equal(fixture("lg-c3-after-stage-b").successor.confidence, "HIGH", "the saved engine output predates the cap");
  assert.equal(out.successor.confidence, "MEDIUM");
  assert.equal(out.original.confidence, "HIGH", "identifying the original is a separate statement and is not changed");
});

test("a blog, review or accessory page, and a trailing-slash duplicate, are not carried as the model's pages", () => {
  for (const url of ["https://www.lg.com/us/blog/lg-oled55c3pua-review", "https://www.lg.com/us/tvs/lg-oled55c3pua-oled-4k-tv/accessories", "https://www.lg.com/us/tvs/oled55c3pua-wall-mount"]) {
    assert.equal(pagesOf(withPages([{ ...clone(PAGE), url }])), undefined, url);
  }
  const kept = pagesOf(withPages([clone(PAGE), { ...clone(PAGE), url: PAGE.url + "/" }]));
  assert.equal(kept.length, 1);
});

test("the view helpers the page calls are exported, and each confidence label names what it is a confidence in", () => {
  assert.equal(typeof RS.manufacturerPageLines, "function", "a missing export made every result fail to render in the browser");
  assert.match(RS.IDENTIFICATION_CONFIDENCE, /identification/);
  assert.match(RS.MATCH_CONFIDENCE, /match/);
  assert.match(RS.PRICE_CONFIDENCE, /price range/);
  const lines = RS.manufacturerPageLines({ original: { manufacturerPages: [PAGE, { ...PAGE, url: "https://www.lg.com/us/support/product/lg-OLED55C3PUA", pageKind: "SUPPORT" }] } });
  assert.deepEqual(lines.map((line) => line.label), ["LG product page", "LG support page"]);
  assert.deepEqual(RS.manufacturerPageLines({ original: {} }), []);
  assert.match(RS.MANUFACTURER_PAGE_NOTE, /not opened/);
});

test("the chat says what a candidate's confidence is, and why it is capped when no page confirms a model", () => {
  const out = project(fixture("lg-c3-after-stage-b"));
  const answer = RS.localAnswer({ last: out }, "How confident are you?");
  const text = JSON.stringify(answer);
  assert.match(text, /confidence in the identification is high/i);
  assert.match(text, /capped at medium because no cited page confirms any candidate's model/);
});
