// Release 2 in the browser: model codes seen in seller listing titles (kept apart from price and from verified identity) and the evidence-supported specification
// comparison, on the candidate card and in the chat. Every reply is a mocked /api/itemassist-research response: the new engine's real pipeline output on the engine's
// saved Shopping rows (and one synthetic conflict), projected through the real proxy projection. No proxy, engine or provider is contacted. Uses the
// analytics-blocking `test` from the replacement-finder helpers.
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
async function replacements(page) {
  if (!isNarrowViewport(page)) await page.locator("#rf-rtab-replacements").click();
  return page.locator("#rf-rpanel-replacements");
}
async function ask(page, text) {
  const input = page.getByLabel("Message ItemAssist");
  await input.fill(text);
  await input.press("Enter");
}

test("clean listing: the observed model code, the comparison with each side's basis, and 'Not established' for what no source states", async ({ page }) => {
  const seen = await load(page, "lg-c3-r2-clean-listing");
  const card = (await replacements(page)).locator(".rf-rs-card").first();
  const observed = card.locator(".rf-rs-observed");
  await expect(observed).toContainText("Model code observed: OLED55C6PUA in 3 listing titles (Best Buy)");
  await expect(observed).toContainText("does not verify the model or its specifications");
  const comparison = card.locator(".rf-rs-speccmp");
  await expect(comparison.getByText("Specification comparison", { exact: true })).toBeVisible();
  const rows = comparison.locator(".rf-rs-spec-row");
  await expect(rows.nth(0)).toContainText("Screen size");
  await expect(rows.nth(0)).toContainText("Original: 55-inch (your description)");
  await expect(rows.nth(0)).toContainText("This candidate: 55-inch (4 seller listing titles)");
  await expect(rows.nth(0)).toContainText("Match");
  await expect(rows.nth(1)).toContainText("Original: OLED (manufacturer page title)");
  const refresh = comparison.locator(".rf-rs-spec-row", { hasText: "Refresh rate" });
  await expect(refresh).toContainText("Original: Not established");
  await expect(refresh).toContainText("This candidate: Not established");
  await expect(comparison.locator(".rf-rs-spec-summary")).toHaveText("Compared: screen size, display class and resolution. Not established: refresh rate and dolby vision.");
  await expect(comparison).toContainText("seller's wording, not manufacturer specifications");
  // Nothing claims an improvement, and the model is still not called verified.
  await expect(comparison).not.toContainText(/brighter|faster|improved|better|upgrade/i);
  await expect(observed).not.toContainText(/brighter|faster|improved|better|upgrade/i);
  await expect(card).not.toContainText("Direct successor");
  await expectNoHorizontalOverflow(page);
  settle(seen);
});

test("bundle-only: the code is observed, the price is excluded with its reason, and the model stays unconfirmed", async ({ page }) => {
  const seen = await load(page, "lg-c3-r2-bundle-only");
  const card = (await replacements(page)).locator(".rf-rs-card").first();
  await expect(card.locator(".rf-rs-observed")).toContainText("Model code observed: OLED55C6PUA in 2 listing titles (Best Buy). Price excluded: the listing includes a protection plan. Retrieved Nov 11, 2026.");
  await expect(card).not.toContainText("Direct successor");
  await expect(card.locator(".rf-pill", { hasText: /Model not confirmed|Unconfirmed|not confirmed/i }).first()).toBeVisible();
  await expect(product(page)).not.toContainText("$1,224.99");
  await expectNoHorizontalOverflow(page);
  settle(seen);
});

test("conflicting model codes: every code is shown, none is chosen, and the name carries no code", async ({ page }) => {
  const seen = await load(page, "lg-c3-r2-conflict");
  const card = (await replacements(page)).locator(".rf-rs-card").first();
  await expect(card.locator(".rf-rs-observed")).toContainText("Listings name more than one model code (OLED55C6PUA, OLED55C6AUA), so none is chosen.");
  await expect(card.locator(".rf-rs-observed li")).toHaveCount(3);
  await expect(card.locator(".rf-rs-observed")).toContainText("not priced as an exact model");
  await expect(card.locator(".rf-lead-name, .rf-rs-name, h4").first()).not.toContainText(/OLED55C6[AP]UA/);
  await expectNoHorizontalOverflow(page);
  settle(seen);
});

test("chat and card say the same about the model code and the comparison", async ({ page }) => {
  const seen = await load(page, "lg-c3-r2-bundle-only");
  const card = (await replacements(page)).locator(".rf-rs-card").first();
  const cardLine = (await card.locator(".rf-rs-observed li").first().innerText()).trim();
  const summary = (await card.locator(".rf-rs-spec-summary").innerText()).trim();
  await ask(page, "What is the exact model number?");
  await expect(log(page)).toContainText(cardLine);
  await expect(log(page)).toContainText("does not verify the model or its specifications");
  await ask(page, "How does it compare with mine?");
  await expect(log(page)).toContainText(summary);
  await expect(log(page)).toContainText("seller's wording, not manufacturer specifications");
  settle(seen);
});

test("a response from an engine without Release 2 shows neither section", async ({ page }) => {
  const seen = await load(page, "lg-c3-after-stage-b");
  const card = (await replacements(page)).locator(".rf-rs-card").first();
  await expect(card.locator(".rf-rs-observed")).toHaveCount(0);
  await expect(card.locator(".rf-rs-speccmp")).toHaveCount(0);
  await ask(page, "What is the exact model number?");
  // The pre-Release-2 fixture states generation C6 from listings: the chat acknowledges it and still says the exact model code is not confirmed.
  await expect(log(page)).toContainText("Retailer listings identify generation C6, but I couldn't confirm the exact model code from the available listings.");
  await expectNoHorizontalOverflow(page);
  settle(seen);
});

test("the new sections are real lists with readable labels and no repeated element ids", async ({ page }) => {
  const seen = await load(page, "lg-c3-r2-clean-listing");
  const card = (await replacements(page)).locator(".rf-rs-card").first();
  await expect(card.locator(".rf-rs-spec-list")).toHaveJSProperty("tagName", "UL");
  await expect(card.locator(".rf-rs-spec-name").first()).toHaveText("Screen size");
  const ids = await page.evaluate(() => [...document.querySelectorAll("[id]")].map((el) => el.id));
  expect(new Set(ids).size).toBe(ids.length);
  settle(seen);
});
