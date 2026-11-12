// Release 1 (evidence integrity) in the browser: what each confidence label is a confidence in, the original product's manufacturer page, and that the chat and the
// cards say the same. Every reply is a mocked /api/itemassist-research response (a saved engine body, projected through the real proxy projection). No proxy, engine
// or provider is contacted. Uses the analytics-blocking `test` from the replacement-finder helpers.
const fs = require("fs");
const path = require("path");
const { test, expect, prepare, isNarrowViewport, expectNoHorizontalOverflow, PAGE } = require("../../replacement-finder/e2e/helpers.js");
const { projectResearch } = require("../../../api/_lib/itemassist-research/projection.js");

const settle = (seen) => { expect(seen.consoleErrors).toEqual([]); expect(seen.pageErrors).toEqual([]); expect(seen.analytics).toEqual([]); };
const PRODUCT_URL = "https://www.lg.com/us/tvs/lg-oled55c3pua-oled-4k-tv";
const PAGE_ENTRY = { url: PRODUCT_URL, domain: "lg.com", sourceName: "LG", sourceClass: "MANUFACTURER", model: "OLED55C3PUA", pageKind: "PRODUCT", title: "LG 55-inch C3 OLED evo", foundVia: "SEARCH_RESULT" };
const engineBody = (pages) => {
  const body = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "successor", "lg-c3-after-stage-b.engine.json"), "utf8"));
  if (pages) body.original.manufacturerPages = pages;
  return projectResearch(body, { requestId: "req-e2e", elapsedMs: 5, quota: null, allowLive: true });
};
const reply = (pages) => ({ research: { reply: () => ({ status: 200, body: { ...engineBody(pages), quota: { limit: 5, remaining: 4, charged: true } } }) } });
const log = (page) => page.locator("#rf-log");
const product = (page) => page.locator("#rf-product-root");

async function load(page, pages) {
  const seen = await prepare(page, reply(pages));
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

test("each confidence label says what it is a confidence in, and a candidate whose model no page confirms is never High", async ({ page }) => {
  const seen = await load(page, null);
  await expect(product(page).locator(".rf-conf", { hasText: "High confidence in the identification" }).first()).toBeVisible();
  const overview = product(page).locator("#rf-rpanel-overview");
  await expect(overview.locator(".rf-conf", { hasText: "confidence in the price range" })).toHaveCount(1);
  const matches = overview.locator(".rf-lead-meta .rf-conf", { hasText: "in the match" });
  await expect(matches.first()).toContainText("Medium confidence in the match (model estimate)");
  for (const label of await matches.allTextContents()) expect(label).not.toMatch(/^High/);
  await expect(product(page).locator(".rf-conf", { hasText: "High confidence in the match" })).toHaveCount(0);
  const replacements = await open(page, "replacements");
  for (const label of await replacements.locator(".rf-rs-card .rf-conf").allTextContents()) expect(label).not.toMatch(/^High/);
  await expectNoHorizontalOverflow(page);
  settle(seen);
});

test("the chat explains the confidence labels in the same terms as the cards", async ({ page }) => {
  const seen = await load(page, null);
  const input = page.getByLabel("Message ItemAssist");
  await input.fill("How confident are you?");
  await input.press("Enter");
  await expect(log(page)).toContainText("My confidence in the identification is high.");
  await expect(log(page)).toContainText("capped at medium because no cited page confirms any candidate's model");
  await expect(product(page).locator("#rf-rpanel-overview .rf-lead-meta .rf-conf", { hasText: "in the match" }).first()).toContainText("Medium");
  settle(seen);
});

test("the original product's manufacturer page is a labelled link that says it was not opened and gives no specification or price", async ({ page }) => {
  const seen = await load(page, [PAGE_ENTRY]);
  const original = await open(page, "original");
  const link = original.getByRole("link", { name: /LG product page/ });
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute("href", PRODUCT_URL);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
  await expect(original).toContainText("names the model OLED55C3PUA");
  await expect(original).toContainText("not opened");
  await expect(original).toContainText("no specification or price is taken from it");
  await expect(original.getByText("Manufacturer page", { exact: true })).toHaveCount(1);
  // It is the original's page only: nothing about it appears among the replacements or in the pricing sources.
  const replacements = await open(page, "replacements");
  await expect(replacements.locator(`a[href="${PRODUCT_URL}"]`)).toHaveCount(0);
  const pricing = await open(page, "pricing");
  await expect(pricing.locator(`a[href="${PRODUCT_URL}"]`)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  settle(seen);
});

test("a response without a manufacturer page shows no such section", async ({ page }) => {
  const seen = await load(page, null);
  const original = await open(page, "original");
  await expect(original.getByText("Manufacturer page", { exact: true })).toHaveCount(0);
  await expect(original.getByRole("link", { name: /product page|support page/ })).toHaveCount(0);
  settle(seen);
});

test("the new link and labels are reachable by keyboard and named for assistive technology", async ({ page }) => {
  const seen = await load(page, [PAGE_ENTRY, { ...PAGE_ENTRY, url: "https://www.lg.com/us/support/product/lg-OLED55C3PUA", pageKind: "SUPPORT", title: null }]);
  const original = await open(page, "original");
  const links = original.getByRole("link", { name: /LG (product|support) page/ });
  await expect(links).toHaveCount(2);
  await links.first().focus();
  await expect(links.first()).toBeFocused();
  for (let index = 0; index < 2; index += 1) await expect(links.nth(index)).toHaveAccessibleName(/LG (product|support) page/);
  await expect(original.getByRole("link", { name: "LG product page" })).toHaveCount(1);
  await expect(original.getByRole("link", { name: "LG support page" })).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
  settle(seen);
});
