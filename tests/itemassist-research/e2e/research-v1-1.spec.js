// V1.1 in the browser: a request that failed at the provider, a laptop answer that asks for its configuration and shows unmatched listings as
// examples, and the note for listings set aside for their spread. Every reply is a mocked /api/itemassist-research response projected through the
// real proxy projection: no proxy, engine or provider is contacted. Uses the analytics-blocking `test` from the replacement-finder helpers.
const { test, expect, prepare, isNarrowViewport, expectNoHorizontalOverflow, PAGE } = require("../../replacement-finder/e2e/helpers.js");
const { research2LiveResponse } = require("../fixtures/research.js");

const settle = (seen) => { expect(seen.consoleErrors).toEqual([]); expect(seen.pageErrors).toEqual([]); expect(seen.analytics).toEqual([]); };
const research = (reply) => ({ research: { reply } });
const ok = (body) => ({ status: 200, body });
const log = (page) => page.locator("#rf-log");
const product = (page) => page.locator("#rf-product-root");

async function send(page, text) {
  const input = page.getByLabel("Message ItemAssist");
  await input.fill(text);
  await input.press("Enter");
}
async function runLive(page, scenario, change, text = "test item") {
  const seen = await prepare(page, research(() => ok(research2LiveResponse(scenario, change))));
  await page.goto(PAGE);
  await expect(page.locator('[data-action="research-new"]')).toBeVisible();
  await send(page, text);
  await expect(page.locator("#rf-product-name")).toBeVisible();
  return seen;
}
async function open(page, name) {
  if (!isNarrowViewport(page)) await page.locator(`#rf-rtab-${name}`).click();
  return page.locator(`#rf-rpanel-${name}`);
}

const failedAtProvider = (identity) => (body) => {
  body.status = identity ? "PARTIAL" : "GUIDANCE_ONLY";
  body.original = { identity, confidence: "LOW", characteristics: [], uncertainty: identity ? "Named from your wording and web results. The research step did not finish." : null };
  body.successor = null; body.suggestions = []; body.clarify = [];
  body.warnings = ["PROVIDER_UNAVAILABLE", "VALUATION_INSUFFICIENT"];
  body.meta.answerSource = "CATEGORY_GUIDANCE";
  body.pricing.prices = []; body.pricing.evidence = [];
  body.pricing.valuation = { method: "INSUFFICIENT", basis: "NONE", verified: false, range: null, confidence: "LOW", asOf: null, comparables: [], excluded: [], reference: null, notes: [{ code: "INSUFFICIENT" }, { code: "NOT_AN_APPRAISAL" }] };
  body.pricing.tier = { level: "UNKNOWN", basis: "UNKNOWN" };
};

test("a console the provider could not research is recognised by name and the request is said not to have finished, never 'Product not identified'", async ({ page }) => {
  const seen = await runLive(page, "insufficient", failedAtProvider("Nintendo Wii"), "nintendo wii");
  await expect(page.locator("#rf-product-name")).toHaveText("Nintendo Wii");
  const banner = product(page).locator(".rf-rs-banner");
  await expect(banner).toContainText("Research didn't finish");
  await expect(banner).toContainText("The name below comes from your wording and web results only.");
  await expect(banner).toContainText("That's not a finding about the product");
  await expect(product(page).locator(".rf-pill", { hasText: "Research incomplete" })).toBeVisible();
  await expect(log(page)).toContainText("I recognised this as Nintendo Wii, but the research step didn't finish");
  await expect(log(page)).toContainText("doesn't use up your daily allowance");
  const overview = await open(page, "overview");
  await expect(overview).toContainText("Only the name could be recognised. There is no value estimate and no candidate to show yet.");
  await expect(overview.locator(".rf-rs-value")).toHaveCount(0);
  await expect(page.getByText("Product not identified")).toHaveCount(0);
  await expect(page.getByText("couldn't identify this item")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  settle(seen);
});

test("when the provider failed and not even the name is recognised, the page still says the request did not finish", async ({ page }) => {
  const seen = await runLive(page, "insufficient", failedAtProvider(null), "quasar widget frobnicator 9000");
  await expect(page.locator("#rf-product-name")).toHaveText("Research didn't finish");
  await expect(product(page).locator(".rf-rs-banner")).toContainText("couldn't complete this request");
  await expect(log(page)).toContainText("The research step didn't finish, so I can't say anything about this item yet.");
  const original = await open(page, "original");
  await expect(original).toContainText("nothing is known about this item yet");
  await expect(page.getByText("Product not identified")).toHaveCount(0);
  settle(seen);
});

test("an item the model could not place is still 'Product not identified'", async ({ page }) => {
  const seen = await runLive(page, "insufficient", () => {}, "something I cannot describe");
  await expect(page.locator("#rf-product-name")).toHaveText("Product not identified");
  await expect(log(page)).toContainText("Product not identified");
  await expect(page.getByText("Research didn't finish")).toHaveCount(0);
  settle(seen);
});

// A laptop answer with no configuration: one question, listings shown as examples, nothing sets a value.
const laptopWithoutConfiguration = (body) => {
  body.clarify = ["What processor, RAM and storage does it have? (for example Core i5, 16 GB, 512 GB)"];
  for (const price of body.pricing.prices) if (price.id !== "p1") Object.assign(price, { configConfirmed: false });
  body.pricing.valuation = { method: "INSUFFICIENT", basis: "NONE", verified: false, range: null, confidence: "LOW", asOf: null, comparables: [], excluded: [], reference: null, notes: [{ code: "INSUFFICIENT" }, { code: "NOT_AN_APPRAISAL" }] };
};

test("a laptop with no configuration: one question in the conversation, and the sellers' listings are examples marked 'Configuration not confirmed'", async ({ page }) => {
  const seen = await runLive(page, "tv-premium-oled", laptopWithoutConfiguration, "Asus vivobook 15");
  await expect(log(page)).toContainText("What processor, RAM and storage does it have? (for example Core i5, 16 GB, 512 GB)");
  const card = product(page).locator("#rf-rpanel-overview .rf-rs-value");
  await expect(card.locator(".rf-rs-range")).toHaveText("Not enough evidence to estimate");
  const pricing = await open(page, "pricing");
  await expect(pricing.locator(".rf-pill", { hasText: "Configuration not confirmed" })).toHaveCount(3);
  for (const id of ["p2", "p3", "p4"]) {
    const price = pricing.locator(`.rf-rs-price[data-price-id='${id}']`);
    await expect(price).toHaveAttribute("data-price-role", "CONTEXT_ONLY");
    await expect(price).toContainText("A laptop listing whose processor, memory and storage are not matched to what you described. It is an example, not a match, and it does not set the range.");
  }
  await expect(pricing).toContainText("No price here sets a figure.");
  await expect(pricing).not.toContainText(/Sets the range/);
  await expectNoHorizontalOverflow(page);
  settle(seen);
});

test("the answer that gives the configuration is sent as more detail on the same laptop, not as a new item", async ({ page }) => {
  const sent = [];
  const seen = await prepare(page, research((request) => { sent.push(request.query); return ok(research2LiveResponse("tv-premium-oled", laptopWithoutConfiguration)); }));
  await page.goto(PAGE);
  await send(page, "Asus F1502ZA vivobook");
  await expect(page.locator("#rf-product-name")).toBeVisible();
  await send(page, "i5, 16gb, 512gb");
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toBe("Asus F1502ZA vivobook, i5, 16gb, 512gb");
  await expect(page.getByText("Is that more detail about this item, or a different item?")).toHaveCount(0);
  settle(seen);
});

test("listings set aside for being too far from the rest are said to be, and the range is only the listings that agree", async ({ page }) => {
  const seen = await runLive(page, "tv-premium-oled", (body) => {
    const [, successor, alt, other] = body.pricing.prices;
    Object.assign(successor, { amount: { currency: "USD", low: 480, high: 480 } });
    Object.assign(alt, { amount: { currency: "USD", low: 520, high: 520 }, candidate: "SUCCESSOR", evidenceId: "e2" });
    Object.assign(other, { amount: { currency: "USD", low: 999.99, high: 999.99 }, candidate: "SUCCESSOR", evidenceId: "e2" });
    body.pricing.valuation = {
      method: "PROVISIONAL_LISTINGS", basis: "PROVISIONAL_LISTINGS", verified: false, range: { currency: "USD", low: 480, high: 520 }, confidence: "MEDIUM", asOf: successor.asOf,
      comparables: [{ priceId: "p2", candidate: "SUCCESSOR", verification: "SEARCH_LISTING" }, { priceId: "p3", candidate: "SUCCESSOR", verification: "SEARCH_LISTING" }],
      excluded: [{ candidate: "ALT_1", reason: "NO_CURRENT_PRICE" }, { candidate: "ALT_2", reason: "NO_CURRENT_PRICE" }], reference: null,
      notes: [{ code: "BASED_ON_LISTINGS", count: 2 }, { code: "LISTINGS_NOT_CONFIRMED" }, { code: "LISTINGS_SPREAD_TRIMMED", count: 1 }, { code: "NOT_AN_APPRAISAL" }],
    };
  });
  const card = product(page).locator("#rf-rpanel-overview .rf-rs-value");
  await expect(card.locator(".rf-rs-range")).toHaveText("$480 to $520");
  await expect(card).toContainText("1 listing was left out because its price is too far from the others to be the same product or configuration.");
  const pricing = await open(page, "pricing");
  await expect(pricing.locator(".rf-rs-price[data-price-id='p4']")).toContainText("Priced too far from the other listings to be the same product or configuration, so it does not set the range.");
  await expect(pricing.locator(".rf-rs-price[data-price-id='p4']")).toHaveAttribute("data-price-role", "CONTEXT_ONLY");
  await expect(pricing.locator(".rf-rs-price[data-price-id='p2']")).toHaveAttribute("data-price-role", "USED_IN_RANGE");
  settle(seen);
});

test("a retailer homepage is labelled as the seller's site, never as a product or purchase link; only a real page path drops that label", async ({ page }) => {
  const seen = await runLive(page, "tv-premium-oled", () => {});
  let pricing = await open(page, "pricing");
  await expect(pricing).toContainText("A listing's source links to the seller's site, not to a product page.");
  await expect(pricing.locator(".rf-rs-sources a").first()).toHaveAttribute("href", /^https:\/\/www\.[a-z.]+\/(us\/)?$/);
  await expect(pricing).not.toContainText(/buy now|buy at|purchase link|add to cart/i);
  settle(seen);
});

test("when every listing carries its seller's own page, the seller's-site caveat is not shown, and the link is that page", async ({ page }) => {
  const seen = await runLive(page, "tv-premium-oled", (body) => {
    const pages = { e2: "https://www.bestbuy.com/site/lg-c-series-oled/6590000.p", e3: "https://www.abt.com/product/123/lg-c-series-oled.html", e4: "https://www.homedepot.com/p/lg-oled/300000000" };
    for (const entry of body.pricing.evidence) if (pages[entry.id]) entry.sourceUrl = pages[entry.id];
    body.pricing.evidence.find((entry) => entry.id === "e1").sourceUrl = "https://www.cnet.com/tech/lg-c3-review/";
  });
  const pricing = await open(page, "pricing");
  await expect(pricing).not.toContainText("not to a product page");
  await expect(pricing.locator(".rf-rs-sources a[href='https://www.bestbuy.com/site/lg-c-series-oled/6590000.p']")).toHaveCount(1);
  settle(seen);
});
