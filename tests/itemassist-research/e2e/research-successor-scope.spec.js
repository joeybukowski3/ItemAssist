// Stage A in the browser: how the page labels a successor and describes what a price is the price of. Every reply is a mocked
// /api/itemassist-research response: the engine's real pipeline output for "LG C3 55 inch" (captured Shopping rows) projected through the real
// proxy projection. No proxy, engine or provider is contacted. Uses the analytics-blocking `test` from the replacement-finder helpers.
const fs = require("fs");
const path = require("path");
const { test, expect, prepare, isNarrowViewport, expectNoHorizontalOverflow, PAGE } = require("../../replacement-finder/e2e/helpers.js");
const { projectResearch } = require("../../../api/_lib/itemassist-research/projection.js");

const settle = (seen) => { expect(seen.consoleErrors).toEqual([]); expect(seen.pageErrors).toEqual([]); expect(seen.analytics).toEqual([]); };
const fixture = (name) => projectResearch(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "successor", `${name}.engine.json`), "utf8")), { requestId: "req-e2e", elapsedMs: 5, quota: null, allowLive: true });
const reply = (name) => ({ research: { reply: () => ({ status: 200, body: { ...fixture(name), quota: { limit: 5, remaining: 4, charged: true } } }) } });
const log = (page) => page.locator("#rf-log");
const product = (page) => page.locator("#rf-product-root");

async function load(page, name) {
  const seen = await prepare(page, reply(name));
  await page.goto(PAGE);
  await expect(page.locator('[data-action="research-new"]')).toBeVisible();
  const input = page.getByLabel("Message ItemAssist");
  await input.fill("LG C3 55-inch TV");
  await input.press("Enter");
  await expect(page.locator("#rf-product-name")).toBeVisible();
  return seen;
}
async function open(page, name) {
  if (!isNarrowViewport(page)) await page.locator(`#rf-rtab-${name}`).click();
  return page.locator(`#rf-rpanel-${name}`);
}

test("a family-level successor is a 'Likely Successor Family', never a direct successor, in the chat and on the page", async ({ page }) => {
  const seen = await load(page, "lg-c3-family-mixed");
  const overview = product(page).locator("#rf-rpanel-overview");
  await expect(overview.locator(".rf-lead .rf-pill", { hasText: "Likely Successor Family" })).toHaveCount(1);
  await expect(overview.locator(".rf-pill", { hasText: "Direct successor" })).toHaveCount(0);
  await expect(product(page).locator(".rf-pill", { hasText: "Direct successor" })).toHaveCount(0);
  await expect(log(page)).toContainText("Likely successor family: LG C-series OLED.");
  await expect(log(page)).not.toContainText("Closest successor to consider");
  await expectNoHorizontalOverflow(page);
  settle(seen);
});

test("a family price range is headed as family pricing, and the chat and the card state the same scope", async ({ page }) => {
  const seen = await load(page, "lg-c3-family-mixed");
  const overview = product(page).locator("#rf-rpanel-overview");
  const card = overview.locator(".rf-rs-value");
  await expect(card.locator("h3")).toHaveText("Family listing prices (not one model)");
  await expect(card).not.toContainText("Replacement value range");
  const scope = await card.locator(".rf-rs-scope").allTextContents();
  expect(scope.length).toBe(2);
  expect(scope[0]).toMatch(/family pricing.*not a price for one specific model/i);
  expect(scope[1]).toMatch(/shows the lowest of the 3 listings; the figure covers all of them/);
  for (const sentence of scope) await expect(log(page)).toContainText(sentence);
  settle(seen);
});

test("the candidate card shows one listing and says it is the lowest of the listings behind the range, with each listing's own model status", async ({ page }) => {
  const seen = await load(page, "lg-c3-family-mixed");
  const replacements = await open(page, "replacements");
  const candidate = replacements.locator(".rf-rs-card").first();
  await expect(candidate.locator(".rf-rs-price-caption")).toHaveText("This is the lowest of 3 listings behind the figure on the Overview.");
  await expect(candidate.locator(".rf-rs-price")).toHaveCount(1);
  await expect(candidate.locator(".rf-pill", { hasText: "Listing names OLED55C6PUA" })).toHaveCount(1);
  const pricing = await open(page, "pricing");
  await expect(pricing.locator(".rf-pill", { hasText: "Listing does not state a model" }).first()).toBeVisible();
  settle(seen);
});

test("a bare seller address is text that says it is the seller's site only, never a link that appears to verify the listing", async ({ page }) => {
  const seen = await load(page, "lg-c3-family-mixed");
  const pricing = await open(page, "pricing");
  await expect(pricing.locator(".rf-rs-seller-only").first()).toContainText("seller site only, no link to the listing");
  await expect(pricing).toContainText("cannot be checked from here");
  const hrefs = await pricing.locator("a").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  for (const href of hrefs) expect(href).not.toMatch(/^https:\/\/[^/]+\/?$/);
  settle(seen);
});

test("one listing that names its model is a single provisional listing price, labelled as a likely successor whose model was seen in a listing", async ({ page }) => {
  const seen = await load(page, "lg-c3-c6-single-listing");
  const overview = product(page).locator("#rf-rpanel-overview");
  await expect(overview.locator(".rf-lead .rf-pill", { hasText: "Likely successor, model seen in a listing" })).toHaveCount(1);
  await expect(overview.locator(".rf-pill", { hasText: "Direct successor" })).toHaveCount(0);
  const card = overview.locator(".rf-rs-value");
  await expect(card.locator("h3")).toHaveText("Current listing price anchor");
  await expect(card.locator(".rf-rs-scope")).toHaveText(["Scope: one retailer listing that names OLED55C6PUA. It is a single provisional listing price and does not confirm what that model sells for."]);
  await expect(log(page)).toContainText("Scope: one retailer listing that names OLED55C6PUA.");
  await expect(log(page)).toContainText("Likely successor: LG C6 OLED 55-inch (OLED55C6PUA) (the model appears in a retailer listing; it is not confirmed).");
  const replacements = await open(page, "replacements");
  await expect(replacements.locator(".rf-rs-price-caption")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  settle(seen);
});
