// ItemAssist Research with research.2 (valuation, price kinds and evidence) inside the existing two-panel workspace. Every reply is a
// mocked /api/itemassist-research response built by projecting a golden engine response through the real proxy projection: no proxy,
// engine or provider is contacted. Uses the analytics-blocking `test` from the replacement-finder helpers.
const { test, expect, prepare, isNarrowViewport, expectNoHorizontalOverflow, PAGE } = require("../../replacement-finder/e2e/helpers.js");
const { researchResponse, research2Response, research2LiveResponse } = require("../fixtures/research.js");

const settle = (seen) => { expect(seen.consoleErrors).toEqual([]); expect(seen.pageErrors).toEqual([]); expect(seen.analytics).toEqual([]); };
const research = (reply) => ({ research: { reply } });
const ok = (body) => ({ status: 200, body });
const TABS = ["overview", "original", "requirements", "replacements", "pricing"];

async function send(page, text) {
  const input = page.getByLabel("Message ItemAssist");
  await input.fill(text);
  await input.press("Enter");
}
const log = (page) => page.locator("#rf-log");
const product = (page) => page.locator("#rf-product-root");
async function run(page, scenario, overrides = {}) {
  const seen = await prepare(page, research(() => ok(research2Response(scenario, overrides))));
  await page.goto(PAGE);
  await expect(page.locator('[data-action="research-new"]')).toBeVisible();
  await send(page, "test item");
  await expect(page.locator("#rf-product-name")).toBeVisible();
  return seen;
}
async function open(page, name) {
  if (!isNarrowViewport(page)) await page.locator(`#rf-rtab-${name}`).click();
  return page.locator(`#rf-rpanel-${name}`);
}

test("research.2 adds a fifth section and keeps the existing tabs, in the same pane", async ({ page }) => {
  const seen = await run(page, "fridge-constraints");
  if (isNarrowViewport(page)) {
    await expect(product(page).locator(".rf-tabbar")).toBeHidden();
    for (const name of TABS) await expect(product(page).locator(`#rf-rpanel-${name}`)).toBeVisible();
  } else {
    await expect(product(page).locator(".rf-tab")).toHaveText(["Overview", "Original product", "Requirements", "Replacements", "Pricing & evidence"]);
    await expect(product(page).locator("#rf-rpanel-overview")).toBeVisible();
    await expect(product(page).locator("#rf-rpanel-pricing")).toBeHidden();
  }
  await expectNoHorizontalOverflow(page);
  settle(seen);
});

test("research.1 still shows its four sections and no pricing tab", async ({ page }) => {
  const seen = await prepare(page, research(() => ok(researchResponse())));
  await page.goto(PAGE);
  await send(page, "LG C3 OLED TV");
  await expect(page.locator("#rf-product-name")).toBeVisible();
  await expect(product(page).locator("#rf-rtab-pricing")).toHaveCount(0);
  await expect(product(page).locator("#rf-rpanel-pricing")).toHaveCount(0);
  await expect(product(page).locator(".rf-rs-value")).toHaveCount(0);
  settle(seen);
});

test("Overview: one confirmed price gives a range with its method, date and caveats, in confirmed styling", async ({ page }) => {
  const seen = await run(page, "fridge-constraints");
  const overview = product(page).locator("#rf-rpanel-overview");
  const card = overview.locator(".rf-rs-value");
  await expect(card).toHaveClass(/rf-rs-value--confirmed/);
  await expect(card.locator(".rf-rs-range")).toHaveText("$2,399");
  await expect(card).toContainText("One confirmed current price");
  await expect(card).toContainText("Prices as of Oct 21, 2026");
  await expect(card).toContainText("Market tier: Premium. Based on the original's reported price.");
  await expect(card.locator("h3")).toHaveText("Replacement price anchor");
  await expect(card).toContainText("One confirmed price anchors one model. It is not a range.");
  await expect(card).not.toContainText(/appraisal|fair value/i);
  await expect(card).toContainText("The original's list price is context only. It does not set the replacement range.");
  await expect(card).toContainText("Alternative 2 is left out: it falls short of an essential requirement.");
  await expect(card).toContainText("Estimates and listing prices can differ from what a seller charges.");
  await expect(overview).toContainText("Closest successor to consider");
  await expect(overview.locator(".rf-lead")).toContainText("Model named on a cited seller or maker page");
  await expect(product(page).locator(".rf-rs-banner")).toContainText("A price is called confirmed only when it comes from the cited source on the date shown");
  settle(seen);
});

test("Overview: unconfirmed listings are provisional, amber, and never styled as confirmed", async ({ page }) => {
  const seen = await run(page, "tv-premium-oled");
  const card = product(page).locator("#rf-rpanel-overview .rf-rs-value");
  await expect(card).toHaveClass(/rf-rs-value--estimate/);
  await expect(card.locator(".rf-rs-range")).toHaveText("$1,199 to $1,399");
  await expect(card).toContainText("Unconfirmed retailer listings");
  await expect(card).toContainText("not confirmed on the product page");
  await expect(card).toContainText("These are listing prices, not confirmed on the product page.");
  await expect(card).not.toContainText("Listing prices can differ from the seller's page.");
  await expect(card.locator(".rf-pill--ok")).toHaveCount(0);
  await expect(card).not.toContainText(/cited seller pages|One confirmed/);
  settle(seen);
});

test("Overview: confirmed current prices from several sellers give a confirmed range", async ({ page }) => {
  const seen = await run(page, "tv-strong-retail");
  const card = product(page).locator("#rf-rpanel-overview .rf-rs-value");
  await expect(card).toHaveClass(/rf-rs-value--confirmed/);
  await expect(card.locator(".rf-rs-range")).toHaveText("$1,499 to $1,649");
  await expect(card).toContainText("Confirmed current prices");
  await expect(card.locator(".rf-pill--ok")).toHaveCount(1);
  settle(seen);
});

test("Overview: an AI-only range is labelled an estimate with no source, and a missing identification still gets a range only as an estimate", async ({ page }) => {
  const seen = await run(page, "ambiguous-model");
  const card = product(page).locator("#rf-rpanel-overview .rf-rs-value");
  await expect(card).toHaveClass(/rf-rs-value--estimate/);
  await expect(card.locator(".rf-rs-range")).toHaveText("$450 to $1,400");
  await expect(card).toContainText("AI estimate only");
  await expect(card).toContainText("No source supports this range. It is an AI estimate.");
  await expect(card.locator(".rf-pill--ok")).toHaveCount(0);
  await expect(log(page)).toContainText("A rough AI estimate is $450 to $1,400. No source supports it.");
  settle(seen);
});

test("Overview: with no current price, a band from the original's price is called an estimate, not a price", async ({ page }) => {
  const seen = await run(page, "sparse-estimate");
  const card = product(page).locator("#rf-rpanel-overview .rf-rs-value");
  await expect(card.locator(".rf-rs-range")).toHaveText("$620 to $1,000");
  await expect(card).toContainText("Estimate from the original's price");
  await expect(card).toContainText("No current retail price is included in this research. The band scales the original's reported price to 65% to 105%");
  await expect(log(page)).toContainText("It is an estimate, not a price for a replacement.");
  settle(seen);
});

test("Overview: without evidence there is no figure at all", async ({ page }) => {
  const seen = await run(page, "insufficient");
  const card = product(page).locator("#rf-rpanel-overview .rf-rs-value");
  await expect(card.locator(".rf-rs-range")).toHaveText("Not enough evidence to estimate");
  await expect(card).toContainText("There is not enough evidence to estimate a value yet.");
  expect(/\$\d/.test(await product(page).innerText())).toBe(false);
  settle(seen);
});

test("Original product: market tier and a dated, sourced list price shown as context, not as today's price", async ({ page }) => {
  const seen = await run(page, "fridge-constraints");
  const panel = await open(page, "original");
  await expect(panel).toContainText("Market tier and price history");
  await expect(panel).toContainText("Market tier: Premium. Based on the original's reported price.");
  const price = panel.locator(".rf-rs-price");
  await expect(price).toHaveCount(1);
  await expect(price).toContainText("Original list price (MSRP)");
  await expect(price).toContainText("$2,799");
  await expect(price).toContainText("Published Jun 10, 2021");
  await expect(price).toContainText("Shown on the cited source page");
  await expect(price.locator("a")).toHaveAttribute("href", "https://www.samsung.com/us/");
  await expect(panel).toContainText("It is not today's retail price and it does not set the replacement range.");
  await expect(price).not.toContainText("Current new-retail price");
  settle(seen);
});

test("Original product: a price seen only in a search snippet says so", async ({ page }) => {
  const seen = await run(page, "sparse-estimate");
  const panel = await open(page, "original");
  await expect(panel.locator(".rf-rs-price")).toContainText("Seen in a search snippet, not confirmed");
  await expect(panel.locator(".rf-rs-price .rf-pill--ok")).toHaveCount(0);
  settle(seen);
});

test("Original product: with no price history it says so rather than inventing one", async ({ page }) => {
  const seen = await run(page, "ambiguous-model");
  const panel = await open(page, "original");
  await expect(panel).toContainText("Market tier: Not determined");
  await expect(panel).toContainText("No list or past retail price is included in this research for the original");
  settle(seen);
});

// ---- a live answer (no demo marker) through the real projection with the server's live switch on ----------------------------------------------

async function runLive(page, scenario, change) {
  const seen = await prepare(page, research(() => ok(research2LiveResponse(scenario, change))));
  await page.goto(PAGE);
  await expect(page.locator('[data-action="research-new"]')).toBeVisible();
  await send(page, "test item");
  await expect(page.locator("#rf-product-name")).toBeVisible();
  return seen;
}

test("Live answer: listing prices are labelled as listings, never styled as confirmed, and carry no demo label", async ({ page }) => {
  const seen = await runLive(page, "tv-premium-oled");
  const card = product(page).locator("#rf-rpanel-overview .rf-rs-value");
  await expect(card).toHaveClass(/rf-rs-value--estimate/);
  await expect(card.locator(".rf-rs-range")).toHaveText("$1,199 to $1,399");
  await expect(card).toContainText("These are listing prices, not confirmed on the product page.");
  await expect(card).not.toContainText(/appraisal|fair value|guaranteed/i);
  await expect(card.locator(".rf-pill--ok")).toHaveCount(0);
  await expect(page.locator(".rf-rs-demo-note")).toHaveCount(0);
  await expect(page.getByText("Demo research data")).toHaveCount(0);
  const pricing = await open(page, "pricing");
  await expect(pricing).toContainText("A listing's source links to the seller's site, not to a product page.");
  await expect(pricing.locator(".rf-pill--ok")).toHaveCount(0);
  await expect(pricing).not.toContainText("Shown on the cited source page");
  settle(seen);
});

test("Live answer: one qualifying listing is a 'Current listing price anchor', and unsized listings are examples marked 'Size not confirmed'", async ({ page }) => {
  const seen = await runLive(page, "tv-premium-oled", (body) => {
    const [, successor, alt, other] = body.pricing.prices;
    Object.assign(alt, { amount: { currency: "USD", low: 1398, high: 1398 }, sizeConfirmed: false });
    Object.assign(other, { amount: { currency: "USD", low: 2359.41, high: 2359.41 }, sizeConfirmed: false });
    body.pricing.valuation = {
      method: "PROVISIONAL_LISTINGS", basis: "PROVISIONAL_LISTINGS", verified: false, range: { currency: "USD", low: successor.amount.low, high: successor.amount.high }, confidence: "LOW", asOf: successor.asOf,
      comparables: [{ priceId: "p2", candidate: "SUCCESSOR", verification: "SEARCH_LISTING" }], excluded: [{ candidate: "ALT_1", reason: "NO_CURRENT_PRICE" }, { candidate: "ALT_2", reason: "NO_CURRENT_PRICE" }],
      reference: { priceId: "p1", kind: "MSRP" },
      notes: [{ code: "BASED_ON_LISTINGS", count: 1 }, { code: "LISTINGS_NOT_CONFIRMED" }, { code: "EXCLUDED_NO_CURRENT_PRICE", candidate: "ALT_1" }, { code: "EXCLUDED_NO_CURRENT_PRICE", candidate: "ALT_2" }, { code: "MSRP_CONTEXT_ONLY" }, { code: "CURRENT_BELOW_ORIGINAL", ratio: 0.65 }, { code: "NOT_AN_APPRAISAL" }]
    };
  });
  const card = product(page).locator("#rf-rpanel-overview .rf-rs-value");
  await expect(card.locator("h3")).toHaveText("Current listing price anchor");
  await expect(card.locator(".rf-rs-range")).toHaveText("$1,299");
  await expect(card).toContainText("One retailer listing shows $1,299, as of Oct 20, 2026. It is a single listing price, not confirmed on the product page, and not a value range.");
  await expect(card).not.toContainText(/appraisal|fair value|guaranteed|Replacement value range/i);
  await expect(card.locator(".rf-pill--ok")).toHaveCount(0);
  const pricing = await open(page, "pricing");
  await expect(pricing.locator(".rf-pill", { hasText: "Size not confirmed" })).toHaveCount(2);
  await expect(pricing.locator(".rf-rs-price[data-price-id='p3']")).toContainText("A retail example whose listing does not state the screen size. It does not confirm a match and does not set the range.");
  await expect(pricing.locator(".rf-rs-price[data-price-id='p3']")).toHaveAttribute("data-price-role", "CONTEXT_ONLY");
  await expect(pricing.locator(".rf-rs-price[data-price-id='p2']")).toHaveAttribute("data-price-role", "USED_IN_RANGE");
  await expect(pricing.locator(".rf-rs-price[data-price-id='p2']").getByText("Size not confirmed")).toHaveCount(0);
  settle(seen);
});

test("Live answer: MSRP and past retail stay distinct, and a spread of dated sources is described once and shown in full", async ({ page }) => {
  const seen = await runLive(page, "tv-premium-oled", (body) => {
    body.pricing.prices.push({ id: "p5", kind: "HISTORICAL_RETAIL", subject: "ORIGINAL", candidate: null, model: null, amount: { currency: "USD", low: 2299, high: 2299 }, asOf: "2025-05-14", asOfBasis: "PUBLISHED", verification: "SEARCH_SNIPPET", evidenceId: "e1" });
  });
  const panel = await open(page, "original");
  await expect(panel.locator(".rf-rs-price")).toHaveCount(2);
  await expect(panel).toContainText("Original list price (MSRP)");
  await expect(panel).toContainText("Past retail price");
  await expect(panel).toContainText("Dated sources put the original at $1,999 to $2,299 when new. They differ, so each is shown.");
  await expect(panel.locator(".rf-pill--ok")).toHaveCount(0);
  settle(seen);
});

test("Live answer: with no dated price the original gets a labelled AI estimate, not a price presented as found", async ({ page }) => {
  const seen = await runLive(page, "ambiguous-model");
  const panel = await open(page, "original");
  await expect(panel).toContainText("No list or past retail price is included in this research for the original");
  await expect(panel).toContainText("No dated price is included. An AI estimate puts the original at $400 to $1,500 when new.");
  await expect(panel.locator(".rf-rs-price")).toContainText("AI estimate");
  await expect(panel.locator(".rf-rs-price")).not.toContainText(/Original list price|Past retail price/);
  settle(seen);
});

test("Requirements: weighted criteria grouped by importance, with the rule that an essential shortfall rules a candidate out", async ({ page }) => {
  const seen = await run(page, "fridge-constraints");
  const panel = await open(page, "requirements");
  await expect(panel.locator(".rf-rs-reqgroup--essential li")).toHaveCount(3);
  await expect(panel.locator(".rf-rs-reqgroup--important li")).toHaveCount(1);
  await expect(panel.locator(".rf-rs-reqgroup--minor li")).toHaveCount(2);
  await expect(panel.locator(".rf-rs-reqgroup--essential")).toContainText("Same door layout");
  await expect(panel).toContainText("Essential (3)");
  await expect(panel).toContainText("a candidate that falls short of one is left out of the value range, however good its price");
  await expect(panel).toContainText("Standard criteria for this type of item");
  settle(seen);
});

test("Requirements: a criterion the AI added is marked as such", async ({ page }) => {
  const seen = await run(page, "washer-dimensions");
  const panel = await open(page, "requirements");
  await expect(panel).toContainText("Total height with the stacked dryer under the cabinet limit");
  await expect(panel.locator(".rf-rs-reqlist .rf-pill--warn")).toContainText("Added by the AI estimate");
  await expect(panel).toContainText("Standard criteria plus AI-added detail");
  settle(seen);
});

test("Replacements: a candidate with a confirmed essential shortfall is shown as left out, however its price compares", async ({ page }) => {
  const seen = await run(page, "fridge-constraints");
  const panel = await open(page, "replacements");
  const cards = panel.locator(".rf-rs-card");
  await expect(cards).toHaveCount(3);
  const ge = cards.nth(2);
  await expect(ge).toContainText("GE side-by-side series");
  await expect(ge.locator(".rf-rs-excluded")).toContainText("Not in the range: it falls short of an essential requirement (confirmed by a cited source)");
  await expect(ge).toContainText("Essential requirements: 1 met, 1 short, 1 not known.");
  await expect(ge.locator(".rf-rs-cmp-row", { hasText: "Same door layout" })).toContainText("Falls short");
  await expect(ge.locator(".rf-rs-cmp-row", { hasText: "Same door layout" }).locator("a")).toHaveAttribute("href", "https://www.geappliances.com/");
  await expect(ge.locator(".rf-rs-price")).toContainText("$3,299");
  await expect(ge.locator(".rf-rs-price")).toContainText("Excluded from the range");
  // The successor, which is in the range, is not marked excluded.
  await expect(cards.nth(0).locator(".rf-rs-excluded")).toHaveCount(0);
  await expect(cards.nth(0)).toContainText("Model named on a cited seller or maker page");
  await expect(cards.nth(1)).toContainText("Not in the range: no current retail price is included in this research");
  await expect(cards.nth(1)).toContainText("Product family, exact model not confirmed");
  settle(seen);
});

test("Replacements: an estimated 'meets' is not shown as settled, and a confirmed one is", async ({ page }) => {
  const seen = await run(page, "fridge-constraints");
  const panel = await open(page, "replacements");
  const successor = panel.locator(".rf-rs-card").nth(0);
  await expect(successor.locator(".rf-rs-cmp-row", { hasText: "Total capacity" }).locator(".rf-pill--ok")).toContainText("Meets");
  await expect(successor.locator(".rf-rs-cmp-row", { hasText: "Width, height and depth" })).toContainText("Not known");
  const alt = panel.locator(".rf-rs-card").nth(1);
  await expect(alt.locator(".rf-rs-cmp-row", { hasText: "Total capacity" })).toContainText("Meets (estimate)");
  await expect(alt.locator(".rf-rs-cmp-row", { hasText: "Total capacity" }).locator(".rf-pill--ok")).toHaveCount(0);
  settle(seen);
});

test("Replacements: an exact-looking model with nothing behind it is flagged as not independently confirmed", async ({ page }) => {
  const seen = await run(page, "unsupported-claims");
  const panel = await open(page, "replacements");
  await expect(panel.locator(".rf-rs-card").nth(0)).toContainText("LG OLED77C4PUA");
  await expect(panel.locator(".rf-rs-card").nth(0)).toContainText("Exact model identity has not been independently confirmed");
  await expect(log(page)).toContainText("Exact model identity for LG OLED77C4PUA has not been independently confirmed, so treat that model number as unconfirmed.");
  expect(/in any source|couldn't find/i.test(await page.locator("#rf-shell").innerText())).toBe(false);
  settle(seen);
});

test("Pricing & evidence: every price carries its kind, verification level, date and source; sources are safe links", async ({ page }) => {
  const seen = await run(page, "fridge-constraints");
  const panel = await open(page, "pricing");
  await expect(panel.locator("#rf-prices-h")).toHaveText("Prices in this research (3)");
  const prices = panel.locator(".rf-rs-price");
  await expect(prices).toHaveCount(3);
  await expect(panel.locator('[data-price-id="p1"]')).toContainText("Original list price (MSRP)");
  const current = panel.locator('[data-price-id="p2"]');
  await expect(current).toContainText("Current new-retail price");
  await expect(current).toContainText("Observed Oct 21, 2026");
  await expect(current).toContainText("Shown on the cited source page");
  await expect(current).toContainText("The successor candidate · DEMO-BESPOKE-28");
  await expect(current).toContainText("Lowe’s (lowes.com)");
  await expect(panel.locator("#rf-sources-h")).toHaveText("Sources (4)");
  await expect(panel.locator(".rf-rs-sources li")).toHaveCount(4);
  await expect(panel.locator(".rf-rs-sources li").nth(1)).toContainText("Retailer · The successor candidate · Seen Oct 21, 2026 · Same model code");
  const links = await panel.locator("a").evaluateAll((nodes) => nodes.map((node) => ({ href: node.href, rel: node.rel, target: node.target })));
  expect(links.length).toBeGreaterThanOrEqual(4);
  for (const link of links) {
    expect(link.href).toMatch(/^https:\/\/(www\.)?(samsung|lowes|homedepot|geappliances)\.com\//);
    expect(link.rel).toContain("noopener");
    expect(link.target).toBe("_blank");
  }
  await expect(panel.locator("#rf-rejected-h")).toHaveCount(0);
  settle(seen);
});

test("Pricing & evidence: an estimate shows no source, and no sources are cited when none exist", async ({ page }) => {
  const seen = await run(page, "ambiguous-model");
  const panel = await open(page, "pricing");
  await expect(panel.locator(".rf-rs-price").first()).toContainText("AI estimate");
  await expect(panel.locator(".rf-rs-price").first()).toContainText("No source: this is an estimate.");
  await expect(panel.locator(".rf-rs-price").first()).toContainText("No source: estimate");
  await expect(panel).toContainText("No sources were cited.");
  await expect(panel.locator("a")).toHaveCount(0);
  settle(seen);
});

test("Pricing & evidence: unsupported claims are set aside under fixed wording and never shown", async ({ page }) => {
  const seen = await run(page, "unsupported-claims");
  const panel = await open(page, "pricing");
  const set = panel.locator(".rf-block").filter({ has: page.locator("#rf-rejected-h") });
  await expect(set).toContainText("Set aside (source, 1 item): a link that was not a usable web address");
  await expect(set).toContainText("Set aside (price, 2 items): a citation whose link and stated source did not match");
  await expect(set).toContainText("Set aside (price, 1 item): a price for a different model");
  await expect(set).toContainText("Downgraded (price, 1 item): a price too old to be called current");
  await expect(set).toContainText("These were removed before anything was shown, so they do not affect the range.");
  // The surviving prices are estimates or dated prices; none is a confirmed current price.
  await expect(panel.locator(".rf-rs-price .rf-pill--ok")).toHaveCount(0);
  await expect(panel.locator(".rf-rs-price", { hasText: "Current new-retail price" })).toHaveCount(0);
  await expect(panel.locator(".rf-rs-price", { hasText: "Past retail price" })).toHaveCount(1);
  await expect(product(page).locator("#rf-rpanel-overview .rf-rs-value")).toHaveClass(/rf-rs-value--estimate/);
  settle(seen);
});

test("a historical price is never labelled current and a current price is never undated", async ({ page }) => {
  for (const scenario of ["tv-premium-oled", "washer-dimensions", "fridge-constraints"]) {
    const seen = await run(page, scenario);
    const panel = await open(page, "pricing");
    const count = await panel.locator(".rf-rs-price").count();
    for (let index = 0; index < count; index += 1) {
      const text = await panel.locator(".rf-rs-price").nth(index).innerText();
      if (/Current new-retail price/.test(text)) expect(text).toMatch(/Observed [A-Z][a-z]{2} \d{1,2}, \d{4}/);
      if (/Original list price|Past retail price/.test(text)) expect(text).not.toMatch(/Observed/);
    }
    settle(seen);
    await page.reload();
  }
});

test("research.2 is always a labelled demo: the indicator and the demo-data note show, and the layout does not change", async ({ page }) => {
  const seen = await run(page, "fridge-constraints");
  await expect(product(page).locator(".rf-rs-demo")).toHaveText("Demo research data");
  await expect(product(page).locator("#rf-rpanel-overview .rf-rs-demo-note")).toContainText("illustrative, not real prices");
  await expectNoHorizontalOverflow(page);
  settle(seen);
});

test("the two-panel layout is preserved with a research.2 report (left about 38%, right about 62%)", async ({ page }) => {
  test.skip(isNarrowViewport(page), "the single-page layout is covered separately");
  const seen = await run(page, "washer-dimensions");
  const [left, right] = await Promise.all([page.locator("#rf-assistant").boundingBox(), page.locator("#rf-product").boundingBox()]);
  expect(left.x).toBeLessThan(right.x);
  const ratio = left.width / (left.width + right.width);
  expect(ratio).toBeGreaterThan(0.33);
  expect(ratio).toBeLessThan(0.43);
  await expectNoHorizontalOverflow(page);
  settle(seen);
});

test("every research.2 scenario renders without overflow, with every panel reachable", async ({ page }) => {
  for (const scenario of ["tv-premium-oled", "tv-strong-retail", "fridge-constraints", "washer-dimensions", "ambiguous-model", "sparse-estimate", "unsupported-claims", "insufficient"]) {
    const seen = await run(page, scenario);
    for (const name of TABS) {
      const panel = await open(page, name);
      await expect(panel).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
    settle(seen);
    await page.reload();
  }
});

test("the tab row is keyboard operable across all five sections", async ({ page }) => {
  test.skip(isNarrowViewport(page), "the tab row is hidden on the single page");
  const seen = await run(page, "fridge-constraints");
  await page.locator("#rf-rtab-overview").focus();
  for (const name of ["original", "requirements", "replacements", "pricing"]) {
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(`#rf-rtab-${name}`)).toBeFocused();
    await expect(page.locator(`#rf-rtab-${name}`)).toHaveAttribute("aria-selected", "true");
  }
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#rf-rtab-overview")).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.locator("#rf-rtab-pricing")).toBeFocused();
  settle(seen);
});

test("a question about worth is answered in the conversation from the valuation, with no new research request", async ({ page }) => {
  const seen = await run(page, "washer-dimensions");
  expect(seen.researchPosts).toHaveLength(1);
  await send(page, "what is it worth?");
  await expect(log(page)).toContainText("Current retail prices point to $999 to $1,099, as of Oct 21, 2026.");
  await expect(log(page)).toContainText("The sources are listed under Pricing & evidence");
  expect(seen.researchPosts).toHaveLength(1);
  settle(seen);
});

test("a research.2 response without its pricing block is an engine error, never a half-built report", async ({ page }) => {
  const broken = research2Response("fridge-constraints");
  delete broken.pricing;
  const seen = await prepare(page, research(() => ok(broken)));
  await page.goto(PAGE);
  await send(page, "test item");
  await expect(log(page)).toContainText("I couldn't complete that research. Please try again later.");
  await expect(page.locator("#rf-product-name")).toHaveCount(0);
  settle(seen);
});

test("the research.2 report offers no purchase, stock or equivalence promise anywhere on the page", async ({ page }) => {
  for (const scenario of ["tv-strong-retail", "fridge-constraints", "unsupported-claims"]) {
    const seen = await run(page, scenario);
    for (const name of TABS) await open(page, name);
    const text = await page.locator("#rf-shell").innerText();
    expect(/in stock|add to cart|buy now|\bLKQ\b|like[- ]kind|guaranteed price|best price|lowest price/i.test(text)).toBe(false);
    settle(seen);
    await page.reload();
  }
});

test("no element id is repeated in the report, and every aria-labelledby points at a real heading", async ({ page }) => {
  for (const scenario of ["fridge-constraints", "unsupported-claims"]) {
    const seen = await run(page, scenario);
    const problems = await page.evaluate(() => {
      const ids = [...document.querySelectorAll("#rf-product-root [id]")].map((node) => node.id);
      const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
      const dangling = [...document.querySelectorAll("#rf-product-root [aria-labelledby]")].filter((node) => !document.getElementById(node.getAttribute("aria-labelledby"))).length;
      return { duplicates, dangling };
    });
    expect(problems.duplicates).toEqual([]);
    expect(problems.dangling).toBe(0);
    settle(seen);
    await page.reload();
  }
});

test("Pricing & evidence reconciles with the Overview: the prices that set the range are the valuation's comparables, and the range is what they say", async ({ page }) => {
  const RS = require("../../../assets/js/rf-research.js");
  for (const scenario of ["tv-strong-retail", "tv-premium-oled", "fridge-constraints", "washer-dimensions", "ambiguous-model", "sparse-estimate", "unsupported-claims"]) {
    const data = research2Response(scenario);
    const value = data.pricing.valuation;
    const seen = await run(page, scenario);
    const overview = product(page).locator("#rf-rpanel-overview .rf-rs-value .rf-rs-range");
    const panel = await open(page, "pricing");
    const expected = value.comparables.map((row) => row.priceId);
    if (value.method === "HISTORICAL_TIER_ESTIMATE") expected.push(value.reference.priceId);
    const shown = await panel.locator('[data-price-role="USED_IN_RANGE"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-price-id")));
    expect(shown.sort(), scenario).toEqual(expected.sort());
    if (!["HISTORICAL_TIER_ESTIMATE"].includes(value.method)) {
      const amounts = value.comparables.map((row) => data.pricing.prices.find((price) => price.id === row.priceId).amount);
      expect(await overview.innerText(), scenario).toBe(RS.formatRange({ low: Math.min(...amounts.map((a) => a.low)), high: Math.max(...amounts.map((a) => a.high)) }));
    }
    // Every price is in exactly one role, and the summary names how many set the figure.
    expect(await panel.locator("[data-price-role]").count(), scenario).toBe(data.pricing.prices.length);
    if (expected.length) await expect(panel.locator(".rf-rs-reconcile")).toContainText(expected.length + " of " + data.pricing.prices.length);
    settle(seen);
    await page.reload();
  }
});

test("Pricing & evidence marks each price: sets the range, context only, or excluded with the reason", async ({ page }) => {
  const seen = await run(page, "fridge-constraints");
  const panel = await open(page, "pricing");
  await expect(panel.locator(".rf-rs-reconcile")).toHaveText("1 of 3 prices sets the figure above. The rest are context only or were left out, with the reason shown on each.");
  const used = panel.locator('[data-price-id="p2"]');
  await expect(used).toHaveAttribute("data-price-role", "USED_IN_RANGE");
  await expect(used).toContainText("Sets the range");
  const context = panel.locator('[data-price-id="p1"]');
  await expect(context).toHaveAttribute("data-price-role", "CONTEXT_ONLY");
  await expect(context).toContainText("Context only");
  await expect(context).toContainText("never sets the replacement range");
  const left = panel.locator('[data-price-id="p3"]');
  await expect(left).toHaveAttribute("data-price-role", "EXCLUDED");
  await expect(left).toContainText("$3,299");
  await expect(left).toContainText("Excluded from the range");
  await expect(left).toContainText("Not in the range: it falls short of an essential requirement (confirmed by a cited source)");
  await expect(panel.locator(".rf-rs-pricegroup .rf-rs-sub")).toHaveText(["Sets the range (1)", "Context only (1)", "Excluded from the range (1)"]);
  settle(seen);
});

test("Pricing & evidence with no prices says so plainly and claims no search", async ({ page }) => {
  const seen = await run(page, "insufficient");
  const panel = await open(page, "pricing");
  await expect(panel).toContainText("No prices are included in this research, so nothing here is a price.");
  await expect(panel.locator("[data-price-role]")).toHaveCount(0);
  await expect(panel.locator(".rf-rs-reconcile")).toHaveCount(0);
  await expect(panel).toContainText("No sources were cited.");
  expect(/was found|were found|couldn't find|in any source/i.test(await page.locator("#rf-shell").innerText())).toBe(false);
  settle(seen);
});

test("the research.2 fine print resets to the standard wording when a new research session starts", async ({ page }) => {
  const seen = await run(page, "fridge-constraints");
  await expect(page.locator(".rf-fineprint")).toContainText("combines AI estimates with cited sources");
  await page.locator('[data-action="research-new"]').click();
  await expect(page.locator(".rf-fineprint")).toContainText("gives AI estimates from general product knowledge");
  await expect(page.locator(".rf-fineprint")).not.toContainText("cited sources");
  settle(seen);
});
