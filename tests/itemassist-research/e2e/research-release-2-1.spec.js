// Release 2.1 in the browser, replaying SAVED PRODUCTION responses ("LG OLED55C3PUA", fresh; "LG C3 55-inch TV", cached) through the mocked /api/itemassist-research route. No proxy,
// engine or provider is contacted. The chat and the cards must agree about the generation and the model; the original's characteristics are labelled as the AI's estimate;
// the original's historical list price is dated context and never a percentage of today's listing. Uses the analytics-blocking `test` from the replacement-finder helpers.
const fs = require("fs");
const path = require("path");
const { test, expect, prepare, isNarrowViewport, expectNoHorizontalOverflow, PAGE } = require("../../replacement-finder/e2e/helpers.js");

const saved = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "production", `${name}.json`), "utf8"));
const settle = (seen) => { expect(seen.consoleErrors).toEqual([]); expect(seen.pageErrors).toEqual([]); expect(seen.analytics).toEqual([]); };
const log = (page) => page.locator("#rf-log");
const root = (page) => page.locator("#rf-product-root");

async function load(page, body, query) {
  const seen = await prepare(page, { research: { reply: () => ({ status: 200, body }) } });
  await page.goto(PAGE);
  await expect(page.locator('[data-action="research-new"]')).toBeVisible();
  const input = page.getByLabel("Message ItemAssist");
  await input.fill(query);
  await input.press("Enter");
  await expect(page.locator("#rf-product-name")).toBeVisible();
  expect(seen.researchPosts.length).toBe(1);
  return seen;
}
async function openTab(page, name) {
  if (!isNarrowViewport(page)) await page.locator(`#rf-rtab-${name}`).click();
  return page.locator(`#rf-rpanel-${name}`);
}
async function ask(page, text) {
  const input = page.getByLabel("Message ItemAssist");
  await input.fill(text);
  await input.press("Enter");
}

test("fresh Production answer: the chat and the candidate card agree that generation C6 is known and the exact model is not", async ({ page }) => {
  const seen = await load(page, saved("lg-oled55c3pua-fresh"), "LG OLED55C3PUA");
  const card = (await openTab(page, "replacements")).locator(".rf-rs-card").first();
  await expect(card.locator(".rf-rs-generation")).toHaveText("Generation C6, as stated in retailer listings.");
  await expect(card).toContainText("Product family, exact model not confirmed");
  // The reply that opens the chat: no longer "I couldn't identify its generation".
  await expect(log(page)).toContainText("Retailer listings identify generation C6, but I couldn't confirm the exact model, so treat it as a family, not a specific model.");
  await expect(log(page)).not.toContainText("couldn't identify its generation");
  await ask(page, "What is the exact model number?");
  await expect(log(page)).toContainText("Retailer listings identify generation C6, but I couldn't confirm the exact model code from the available listings.");
  // The alternatives from other makers keep the conservative answer.
  await expect(log(page)).toContainText("Sony A Series OLED TV: no model code was seen in the listings I found, so the exact model is not established.");
  await expectNoHorizontalOverflow(page);
  settle(seen);
});

test("the original's characteristics are labelled as an AI estimate next to the sourced comparison and the manufacturer page", async ({ page }) => {
  const seen = await load(page, saved("lg-oled55c3pua-fresh"), "LG OLED55C3PUA");
  const original = await openTab(page, "original");
  await expect(original.getByText("Key characteristics (AI estimate)", { exact: true })).toBeVisible();
  await expect(original).toContainText("From the AI's general knowledge and not verified against the maker's specifications.");
  await expect(original.getByText("120Hz refresh rate", { exact: true })).toBeVisible();
  await expect(original).toContainText("Not found in the sources checked: 120Hz or higher refresh rate for gaming.");
  const page1 = original.locator("a[href*='lg.com/us/tvs']");
  await expect(page1).toHaveText("LG product page");
  await expect(page1).toHaveAttribute("rel", /noopener/);
  await expectNoHorizontalOverflow(page);
  settle(seen);
});

test("the original's list price is dated context: shown with its date, qualified, and never as a percentage of today's listing", async ({ page }) => {
  const seen = await load(page, saved("lg-oled55c3pua-fresh"), "LG OLED55C3PUA");
  const pricing = await openTab(page, "pricing");
  await expect(pricing).toContainText("Original list price (MSRP)");
  await expect(pricing).toContainText("$1,899.99");
  await expect(pricing).toContainText("Published Apr 14, 2023");
  await expect(pricing).toContainText("The original's list price is context only. It does not set the replacement range. It is a past price for a different model and is not compared with today's listings.");
  // The saved answer still carries CURRENT_BELOW_ORIGINAL (the engine that produced it predates 2.1): the page does not word it.
  await expect(root(page)).not.toContainText(/about \d+% of the original/);
  await expect(root(page)).not.toContainText(/Current prices are about/);
  // The candidate's own listing price and its scope are unchanged.
  await expect(root(page)).toContainText("$1,025");
  await expectNoHorizontalOverflow(page);
  settle(seen);
});

test("a corrected engine's comparison: a display class read only from a model code is not 'your description'", async ({ page }) => {
  const body = saved("lg-oled55c3pua-fresh");
  const display = body.successor.specComparison.rows.find((row) => row.attribute === "DISPLAY_CLASS");
  display.original = { value: "OLED", basis: "MANUFACTURER_PAGE_TITLE", sources: 1 };
  const seen = await load(page, body, "LG OLED55C3PUA");
  const row = (await openTab(page, "replacements")).locator(".rf-rs-spec-row", { hasText: "Display class" });
  await expect(row).toContainText("Original: OLED (manufacturer page title)");
  await expect(row).not.toContainText("your description");
  await expect(row).toContainText("Match");
  settle(seen);
});

test("cached Production answer (generation C6 from listings, no comparison blocks): the chat and the card still agree", async ({ page }) => {
  const seen = await load(page, saved("lg-c3-55-tv-cached"), "LG C3 55-inch TV");
  const card = (await openTab(page, "replacements")).locator(".rf-rs-card").first();
  await expect(card.locator(".rf-rs-generation")).toHaveText("Generation C6, as stated in retailer listings.");
  await expect(card.locator(".rf-rs-observed")).toHaveCount(0);
  await expect(log(page)).toContainText("Retailer listings identify generation C6, but I couldn't confirm the exact model");
  await ask(page, "What is the exact model number?");
  await expect(log(page)).toContainText("Retailer listings identify generation C6, but I couldn't confirm the exact model code from the available listings.");
  await expectNoHorizontalOverflow(page);
  settle(seen);
});

test("with no generation evidence the conservative chat wording is unchanged", async ({ page }) => {
  const body = saved("lg-oled55c3pua-fresh");
  body.successor.lineage = { relation: "UNKNOWN", generation: null, basis: "NONE", tier: "SAME" };
  const seen = await load(page, body, "LG OLED55C3PUA");
  await expect(log(page)).toContainText("I couldn't identify its generation or exact model, so treat it as a family, not a specific model.");
  await ask(page, "What is the exact model number?");
  await expect(log(page)).toContainText("LG C6 OLED TV 55-inch: no model code was seen in the listings I found, so the exact model is not established.");
  settle(seen);
});
