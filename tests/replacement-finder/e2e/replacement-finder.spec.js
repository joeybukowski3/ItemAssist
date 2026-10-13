// ItemAssist workspace (assistant + Product Intelligence) behaviour, driven through mocked /api/replacement-finder replies.
// Nothing here contacts the engine or any provider, and every test uses the analytics-blocking fixture from helpers.js.
const { test, expect, contracts, errorBody, prepare, openPrompt, fillAndSubmit, runLookup, openTab, tabControl, panelLocator, isLanded, isNarrowViewport, expectNoHorizontalOverflow, PAGE } = require("./helpers.js");

const PHONE_MAX = 520; // the width at and below which the chrome gets its tightest form
const settle = async (seen) => { expect(seen.consoleErrors).toEqual([]); expect(seen.pageErrors).toEqual([]); expect(seen.analytics).toEqual([]); };
const SECTIONS = ["Overview", "Specifications", "Replacement", "Pricing", "Evidence"];

/**
 * After a tab click, quick action or jump: the section is selected, and on the single page it has also scrolled into place.
 * `landing` is where the page should have scrolled to when that is an element inside the section rather than its top.
 */
async function expectSection(page, name, landing = panelLocator(page, name)) {
  if (isNarrowViewport(page)) {
    await expect(tabControl(page, name)).toHaveAttribute("aria-current", "location");
    await expect.poll(() => isLanded(page, landing)).toBe(true);
  } else {
    await expect(tabControl(page, name)).toHaveAttribute("aria-selected", "true");
    await expect(panelLocator(page, name)).toBeVisible();
  }
}
const reply = (body, status = 200, delayMs = 0) => ({ reply: () => ({ status, body, delayMs }) });
const best = () => reply(contracts.engineBestAvailableUnconfirmed());
const productPane = (page) => page.locator("#rf-product");
const paneWidth = (page) => page.evaluate(() => document.querySelector("#rf-product").getBoundingClientRect().width);

// ---- 1. initial workspace --------------------------------------------------------------------------------------------

test("initial: an application shell with an assistant pane and an empty Product Intelligence pane", async ({ page }) => {
  const seen = await prepare(page);
  await page.goto(PAGE);

  await expect(page.getByRole("heading", { level: 1, name: "ItemAssist Assistant" })).toBeVisible();
  if (page.viewportSize().width > PHONE_MAX) await expect(page.getByText("Research and replacement analysis")).toBeVisible();
  else await expect(page.getByText("Research and replacement analysis")).toBeHidden(); // phones: one line less before the conversation
  await expect(page.locator("#rf-log")).toContainText("Tell me what item you're researching. You can start with a brand and model number.");
  await expect(page.getByRole("button", { name: "Find Replacement" })).toBeEnabled();
  await expect(page.getByLabel("Message ItemAssist")).toBeVisible();
  await expect(page.getByPlaceholder("Ask about this item...")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Attach a photo or document/ })).toBeDisabled();
  for (const label of ["Verify Specs", "Compare Models", "Price Item"]) await expect(page.getByRole("button", { name: label })).toHaveAttribute("aria-disabled", "true");

  await expect(page.getByRole("heading", { level: 2, name: "Product Intelligence" })).toBeVisible();
  await expect(productPane(page)).toContainText("Research an item to build its product profile, replacement analysis and evidence.");
  // No fake demo data: no price, no model, no tabs, no report before a lookup.
  await expect(productPane(page).getByRole("tab")).toHaveCount(0);
  await expect(productPane(page)).not.toContainText("$");
  await expect(productPane(page)).not.toContainText("QN55");
  await expectNoHorizontalOverflow(page);
  await settle(seen);
});

test("initial: noindex, no site navigation, and a single header link", async ({ page }) => {
  await prepare(page);
  await page.goto(PAGE);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,nofollow");
  await expect(page.locator("nav")).toHaveCount(0);
  await expect(page.locator("header a")).toHaveCount(1);
});

test("initial: the availability check disables lookups when the feature flag is off", async ({ page }) => {
  await prepare(page, { enabled: false });
  await page.goto(PAGE);
  await expect(page.locator("#rf-unavailable")).toBeVisible();
  await page.locator('[data-action="find"]').click({ force: true }); // aria-disabled, not disabled: still clickable, and answers honestly
  await expect(page.locator("#rf-log")).toContainText("isn't available right now");
  await expect(page.locator("#rf-ask")).toHaveCount(0);
});

// ---- 2. structured Find Replacement flow ------------------------------------------------------------------------------

test("find replacement: the quick action opens a compact structured prompt inside the conversation", async ({ page }) => {
  await prepare(page);
  await page.goto(PAGE);
  await openPrompt(page);
  const ask = page.locator("#rf-ask");
  await expect(ask).toBeVisible();
  await expect(ask.getByRole("group", { name: "Category" })).toBeVisible();
  await expect(ask.getByLabel("Brand")).toHaveValue("Samsung");
  await expect(ask.getByLabel("Brand")).toHaveAttribute("readonly", "");
  await expect(ask.getByLabel("Model number")).toBeFocused();
  await expect(ask.getByLabel("Optional notes")).toBeVisible();
  await expect(page.locator("#rf-log .rf-msg--prompt")).toHaveCount(1);
  // Re-opening does not stack a second prompt.
  await page.locator('[data-action="find"]').click();
  await expect(page.locator("#rf-ask")).toHaveCount(1);

  await page.locator('label[for="rf-cat-refrigerator"]').click();
  await expect(ask.getByLabel("Brand")).toHaveValue("LG");
  await expect(page.locator("#rf-use-example")).toHaveText("LRFCS25D3S");
  await page.locator("#rf-use-example").click();
  await expect(ask.getByLabel("Model number")).toHaveValue("LRFCS25D3S");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("#rf-ask")).toHaveCount(0);
});

test("find replacement: Samsung QN55Q80C reaches the existing API and renders the returned result", async ({ page }) => {
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page, { notes: "Reusing existing wall mount" });
  expect(seen.posts).toEqual([{ category: "television", brand: "Samsung", model: "QN55Q80C", notes: "Reusing existing wall mount", website: "" }]);
  await expect(page.locator("#rf-log")).toContainText("Find replacement: Samsung QN55Q80C");
  await expect(page.locator("#rf-log")).toContainText("New · Available · Samsung.com · $999.99 · observed Oct 11, 2026");
  await expect(page.locator("#rf-product-name")).toHaveText("QN55Q80C");
  await expect(page.locator("#rf-product-name")).toBeFocused();
  await settle(seen);
});

test("find replacement: a typed brand and model starts the lookup directly, without opening the form", async ({ page }) => {
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await page.getByLabel("Message ItemAssist").fill("Samsung qn55q80c");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator("#rf-log")).toContainText("I found Samsung QN55Q80C. Researching the current replacement now.");
  await expect(page.locator("#rf-product-name")).toHaveText("QN55Q80C");
  await expect(page.locator("#rf-ask")).toHaveCount(0);
  await expect(page.locator("#rf-log")).not.toContainText("free-form conversation");
  expect(seen.posts).toEqual([{ category: "television", brand: "Samsung", model: "QN55Q80C", notes: "", website: "" }]);
  await settle(seen);
});

test("find replacement: a general question gets the scope message, with no form and no API call", async ({ page }) => {
  const seen = await prepare(page);
  await page.goto(PAGE);
  await page.getByLabel("Message ItemAssist").fill("what is the best phone?");
  await page.getByLabel("Message ItemAssist").press("Enter");
  await expect(page.locator("#rf-log")).toContainText("I can currently help identify and research replacement models. Send me a brand and model number, or use Find Replacement.");
  await expect(page.locator("#rf-ask")).toHaveCount(0);
  expect(seen.posts).toEqual([]);
});

// ---- 3. validation ---------------------------------------------------------------------------------------------------

test("validation: the existing rules show an accessible error summary and send nothing", async ({ page }) => {
  const seen = await prepare(page);
  await page.goto(PAGE);
  await openPrompt(page);
  await page.locator("#rf-submit").click();
  const summary = page.locator("#rf-error-summary");
  await expect(summary).toBeVisible();
  await expect(summary).toHaveAttribute("role", "alert");
  await expect(summary).toBeFocused();
  await expect(page.locator("#rf-model")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#rf-model-error")).toContainText("Enter a model number");
  await page.locator("#rf-model").fill("<script>");
  await page.locator("#rf-submit").click();
  await expect(page.locator("#rf-model-error")).toContainText("letters, numbers");
  await page.locator("#rf-model").fill("QN55Q80C");
  await page.locator("#rf-notes").fill("x".repeat(301).slice(0, 300) + "y");
  await expect(page.locator("#rf-notes")).toHaveValue(/^x{300}$/); // maxlength stops the 301st character
  expect(seen.posts).toEqual([]);
  await settle(seen);
});

test("validation: an error link moves focus to the field, and typing clears the errors", async ({ page }) => {
  await prepare(page);
  await page.goto(PAGE);
  await openPrompt(page);
  await page.locator("#rf-submit").click();
  await page.locator("#rf-error-list a").first().click();
  await expect(page.locator("#rf-model")).toBeFocused();
  await page.locator("#rf-model").fill("Q");
  await expect(page.locator("#rf-error-summary")).toBeHidden();
});

// ---- 4. keyboard only ------------------------------------------------------------------------------------------------

test("keyboard: the quick action, prompt, tabs and quick actions all work without a pointer", async ({ page }) => {
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await page.locator('[data-action="find"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#rf-model")).toBeFocused();
  await page.keyboard.type("qn55q80c");
  await page.keyboard.press("Enter");
  await expect(page.locator("#rf-product-name")).toBeFocused();
  expect(seen.posts).toHaveLength(1);

  await page.keyboard.press("Tab");
  await expect(tabControl(page, "Overview")).toBeFocused();
  if (isNarrowViewport(page)) {
    // Jump links: each is its own tab stop, and Enter scrolls to the section and moves focus into it.
    await page.keyboard.press("Tab");
    await expect(tabControl(page, "Specifications")).toBeFocused();
    await page.keyboard.press("Enter");
    await expectSection(page, "Specifications");
    await expect(panelLocator(page, "Specifications")).toBeFocused();
  } else {
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Specifications" })).toBeFocused();
    await expect(page.getByRole("tab", { name: "Specifications" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Evidence" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(page.getByRole("tab", { name: "Overview" })).toBeFocused();
  }
  await settle(seen);
});

// ---- 5. loading ------------------------------------------------------------------------------------------------------

test("loading: a staged status appears in the assistant while the Product pane says it is researching", async ({ page }) => {
  const seen = await prepare(page, reply(contracts.engineComplete(), 200, 4000)); // long enough that a busy test machine still sees the loading state
  await page.goto(PAGE);
  await fillAndSubmit(page);
  await expect(page.locator("#rf-loading-h")).toBeFocused();
  await expect(page.locator("#rf-loading-h")).toContainText("Researching Samsung QN55Q80C");
  await expect(page.locator(".rf-stages li")).toHaveCount(5);
  await expect(page.locator(".rf-stages li.active")).toHaveCount(1);
  await expect(page.getByText("This may take up to about 20 seconds.")).toBeVisible();
  await expect(page.locator('[data-action="find"]').first()).toBeVisible();
  await expect(productPane(page).getByRole("status")).toContainText("Building the product profile");
  await expect(page.locator("#rf-product-name")).toBeVisible({ timeout: 12000 });
  await expect(page.locator(".rf-msg--loading")).toHaveCount(0);
  await settle(seen);
});

test("loading: Cancel stops the lookup, ignores the late reply and restores the previous state", async ({ page }) => {
  const seen = await prepare(page, reply(contracts.engineComplete(), 200, 3500));
  await page.goto(PAGE);
  await fillAndSubmit(page);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("#rf-log")).toContainText("Lookup cancelled");
  await expect(page.locator(".rf-msg--loading")).toHaveCount(0);
  await expect(page.getByLabel("Message ItemAssist")).toBeFocused();
  await page.waitForTimeout(4000); // past the mocked reply
  await expect(page.locator("#rf-product-name")).toHaveCount(0);
  await expect(productPane(page)).toContainText("Research an item to build its product profile");
  await settle(seen);
});

// ---- 6-7. result levels ----------------------------------------------------------------------------------------------

test("RECOMMENDED: a normal strong result is titled Recommended Replacement and shows its retail status", async ({ page }) => {
  const seen = await prepare(page, reply(contracts.engineComplete()));
  await page.goto(PAGE);
  await runLookup(page);
  const lead = page.locator(".rf-lead");
  await expect(lead).toHaveClass(/rf-lead--ok/);
  await expect(lead.locator("#rf-lead-h")).toHaveText("Recommended Replacement");
  await expect(lead).toContainText("Samsung QN55Q80D");
  await expect(lead).toContainText("Like-Kind & Quality");
  await expect(lead).toContainText("Medium");
  await expect(lead).not.toContainText("Best Available");
  await expect(lead).not.toContainText("No Confirmed LKQ");
  await expect(page.locator("#rf-why-h")).toContainText("Why ItemAssist selected this");
  await expect(page.locator("#rf-log")).toContainText("Recommended Replacement");
  await settle(seen);
});

test("BEST_AVAILABLE: the QN55Q80C case reads as Best Available Current Replacement, unconfirmed, with retail evidence", async ({ page }) => {
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  const lead = page.locator(".rf-lead");
  await expect(lead).toHaveClass(/rf-lead--best/);
  await expect(lead.locator("#rf-lead-h")).toHaveText("Best Available Current Replacement");
  await expect(lead).toContainText("Samsung QN55QN80H");
  await expect(lead).toContainText("Medium");
  await expect(lead).toContainText("Confidence");
  await expect(lead.locator(".rf-class")).toHaveText("Unconfirmed");
  await expect(lead).toContainText("No Confirmed LKQ");
  await expect(page.locator(".rf-lead-kicker")).not.toContainText("Recommended");
  await expect(page.locator("#rf-why-h")).toContainText("Why this remains best available");
  const why = page.locator(".rf-why-list");
  await expect(why).toContainText("Sold new and currently available from Samsung.com.");
  await expect(why).toContainText("All 2 required specifications are satisfied.");
  await expect(why).toContainText("1 important specification remains unverified.");
  await expect(why).toContainText("Equivalence to the original is not verified.");
  await expect(why).not.toContainText(/successor|lineage/i);
  await settle(seen);
});

test("headers: the product header states identity and only statuses the contract supports", async ({ page }) => {
  await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  await expect(page.locator(".rf-ph-brand")).toHaveText("Samsung");
  await expect(page.locator("#rf-product-name")).toHaveText("QN55Q80C");
  await expect(page.locator(".rf-ph-type")).toHaveText("Television · Q80 Series");
  const status = page.getByRole("group", { name: "Report status" });
  if (isNarrowViewport(page)) {
    // The single page shows the same facts as short chips so they sit on one line.
    await expect(status).toContainText("Verified");
    await expect(status).toContainText("Retail");
    await expect(status).toContainText("2 to verify");
    await expect(status).toContainText("Coverage Strong");
  } else {
    await expect(status).toContainText("Verified Product");
    await expect(status).toContainText("Retail Evidence");
    await expect(status).toContainText("Needs Verification · 2");
    await expect(status).toContainText("Source coverage Strong");
  }
  await expect(page.locator(".rf-ph")).not.toContainText("%");
});

test("headers: no retail evidence means no Retail Evidence status", async ({ page }) => {
  await prepare(page, reply(contracts.engineNoRetailReplacement()));
  await page.goto(PAGE);
  await runLookup(page);
  await expect(page.getByRole("group", { name: "Report status" })).not.toContainText(/Retail/);
});

// ---- 8. no result ----------------------------------------------------------------------------------------------------

test("NO_RESULT: no current retail replacement is stated plainly, with the engine's reason", async ({ page }) => {
  const seen = await prepare(page, reply(contracts.engineNoRetailReplacement()));
  await page.goto(PAGE);
  await runLookup(page);
  await expect(page.locator("#rf-lead-h")).toHaveText("No Current Retail Replacement Found");
  await expect(page.locator(".rf-lead--none")).toContainText("Older or unavailable models are not recommended.");
  await expect(page.locator(".rf-lead--none")).not.toContainText("$");
  await expect(page.locator("#rf-log")).toContainText("No Current Retail Replacement Found");
  const pricing = await openTab(page, "Pricing");
  await expect(pricing).toContainText("Not available yet");
  await expect(pricing).toContainText("No replacement was confirmed");
  const replacement = await openTab(page, "Replacement");
  await expect(replacement).toContainText("There is no replacement to compare");
  await settle(seen);
});

test("NO_RESULT: a generic no-replacement result is not mislabelled as a retail failure", async ({ page }) => {
  await prepare(page, reply(contracts.engineNoResult()));
  await page.goto(PAGE);
  await runLookup(page);
  await expect(page.locator("#rf-lead-h")).toHaveText("No Replacement Found");
  await expect(page.locator(".rf-lead--none")).toContainText("Not enough current product information");
  await expect(page.locator(".rf-tiles")).toHaveCount(0);
});

// ---- 9-10. retail, price, warnings ---------------------------------------------------------------------------------

test("retail: availability, seller, observed price and date are shown apart from the LKQ classification", async ({ page }) => {
  await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  const retail = page.locator(".rf-lead").getByRole("group", { name: "Retail availability" });
  await expect(retail).toContainText("New");
  await expect(retail).toContainText("Available");
  await expect(retail).toContainText("Current");
  await expect(retail.getByRole("link", { name: /Samsung\.com/ })).toHaveAttribute("href", "https://www.samsung.com/us/tvs/qn80h/");
  await expect(retail).toContainText("Manufacturer");
  await expect(retail).toContainText("$999.99");
  await expect(retail).toContainText("Observed Oct 11, 2026");
  await expect(page.locator(".rf-lead .rf-class")).not.toContainText("$");
});

test("pricing: only the observed retail price is shown; history and cost estimates are marked as not available", async ({ page }) => {
  await prepare(page, reply(contracts.engineComplete()));
  await page.goto(PAGE);
  await runLookup(page);
  const pricing = await openTab(page, "Pricing");
  await expect(pricing.locator(".rf-price-big").first()).toHaveText("$999.99");
  await expect(pricing).toContainText("Samsung QN55Q80D");
  await expect(pricing).toContainText("Observed Oct 11, 2026");
  await expect(pricing).toContainText("not part of the match result");
  await expect(pricing.locator("#rf-altprice-h")).toHaveText("Alternative models");
  await expect(pricing).toContainText("$1,499.00");
  await expect(pricing.locator("#rf-later-h")).toContainText("Not available yet");
  await expect(pricing).toContainText("Price history");
  await expect(pricing).toContainText("Replacement-cost calculation");
});

test("pricing: a model with no reported price says so instead of showing one", async ({ page }) => {
  const body = contracts.engineComplete();
  body.primary.retail.observedPrice = null;
  body.alternatives = [];
  await prepare(page, reply(body));
  await page.goto(PAGE);
  await runLookup(page);
  const pricing = await openTab(page, "Pricing");
  await expect(pricing).toContainText("No retail price was reported");
  await expect(pricing).not.toContainText("$");
});

test("warnings: no-confirmed-LKQ and non-U.S. source provenance are shown in plain language and are not hidden", async ({ page }) => {
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  const notes = page.locator(".rf-notes").first();
  await expect(notes.locator('[data-code="NO_CONFIRMED_LKQ"]')).toContainText("No confirmed LKQ");
  await expect(notes.locator('[data-code="NO_CONFIRMED_LKQ"]')).toContainText("not an equivalent");
  await expect(notes.locator('[data-code="ORIGINAL_SOURCE_NON_US"]')).toContainText("non-U.S. Samsung page");
  await expect(notes.locator('[data-code="ORIGINAL_SOURCE_NON_US"]')).toContainText("Verify them before buying");
  const specs = await openTab(page, "Specifications");
  if (isNarrowViewport(page)) {
    // Described in full once, under Overview; the specifications point to it.
    await expect(specs.locator('[data-code="ORIGINAL_SOURCE_NON_US"]')).toHaveCount(0);
    await expect(specs.locator(".rf-wref")).toContainText("Non-U.S. source for the original");
    await expect(specs.getByRole("button", { name: /See warning/ })).toBeVisible();
  } else {
    await expect(specs.locator('[data-code="ORIGINAL_SOURCE_NON_US"]')).toBeVisible();
  }
  const replacement = await openTab(page, "Replacement");
  await expect(replacement.locator("#rf-needs-h")).toContainText("Needs review");
  await expect(replacement).toContainText("Physical fit");
  await expect(replacement).toContainText("Confirm available space before purchase");
  await expect(page.getByText("HARD", { exact: true })).toHaveCount(0);
  await expect(page.getByText("STRONG", { exact: true })).toHaveCount(0);
  await settle(seen);
});

test("provenance: inferred facts are labelled as inferred, never as verified", async ({ page }) => {
  await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  const specs = await openTab(page, "Specifications");
  const tier = specs.locator(".rf-fact", { hasText: "Product tier" });
  await expect(tier).toContainText("Inferred");
  await expect(tier).not.toContainText("Verified");
  await expect(specs.locator(".rf-fact", { hasText: "Physical fit" })).toContainText("Not available");
  await expect(specs.getByLabel("Specification status counts")).toContainText("Verified");
});

test("partial: a banner is shown and the usable result is kept", async ({ page }) => {
  await prepare(page, reply(contracts.enginePartial()));
  await page.goto(PAGE);
  await runLookup(page);
  await expect(page.getByText("Partial report")).toBeVisible();
  await expect(page.locator(".rf-lead")).toContainText("Samsung QN55Q80D");
  await expect(page.locator(".rf-notes")).toContainText("Research time limit reached");
});

// ---- 11. comparison --------------------------------------------------------------------------------------------------

test("comparison: Specification, Original, Replacement and Assessment, with text status as well as icons", async ({ page }) => {
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  const panel = await openTab(page, "Replacement");
  const table = panel.getByRole("table", { name: "Original product compared with the replacement" });
  await expect(table).toBeAttached();
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(5);
  const wide = (await paneWidth(page)) > 560;
  if (wide) await expect(table.locator("thead th")).toHaveText(["Specification", "Original", "Replacement", "Assessment"]);
  const row = (label) => rows.filter({ hasText: label });
  await expect(row("Screen size")).toContainText("Required");
  await expect(row("Screen size")).toContainText("Meets");
  await expect(row("Display performance class")).toContainText("Neo QLED");
  await expect(row("Display performance class")).toContainText("Exceeds");
  await expect(row("HDR support")).toContainText("Verify");
  await expect(row("HDR support")).toContainText("Not available");
  await expect(row("Model year")).toContainText("Differs");
  await expect(rows.first().locator(".rf-pill svg")).toHaveCount(1);
  // Values use the monospace face; the table is a table when wide and stacked cards when narrow.
  const family = await row("Screen size").locator('td[data-label="Original"]').evaluate((cell) => getComputedStyle(cell).fontFamily);
  expect(family).toMatch(/mono|Consolas|Cascadia/i);
  const display = await rows.first().evaluate((tr) => getComputedStyle(tr).display);
  expect(display).toBe(wide ? "table-row" : "grid");
  await expectNoHorizontalOverflow(page);
  await settle(seen);
});

test("comparison: a conflict reads as Conflict with text, icon and a red tone only for the real failure", async ({ page }) => {
  const body = contracts.engineBestAvailableUnconfirmed();
  body.comparison[1] = { ...body.comparison[1], original: "8K", replacement: "4K", assessment: { code: "FAIL", label: "Does not meet requirement" } };
  await prepare(page, reply(body));
  await page.goto(PAGE);
  await runLookup(page);
  const panel = await openTab(page, "Replacement");
  const row = panel.locator("tbody tr", { hasText: "Resolution" });
  await expect(row).toContainText("Conflict");
  await expect(row.locator(".rf-pill--bad svg")).toHaveCount(1);
  await expect(panel.locator(".rf-pill--bad")).toHaveCount(1);
});

test("match summary: Required, Important, Additional and Needs Review counts come from the contract, with no score", async ({ page }) => {
  await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  const tiles = page.locator(".rf-tiles .rf-tile");
  await expect(tiles).toHaveCount(4);
  await expect(tiles.nth(0)).toContainText("Required");
  await expect(tiles.nth(0)).toContainText("2 / 2");
  await expect(tiles.nth(1)).toContainText("Important");
  await expect(tiles.nth(1)).toContainText("1 / 2");
  await expect(tiles.nth(1)).toContainText("1 unverified");
  await expect(tiles.nth(2)).toContainText("Additional");
  await expect(tiles.nth(3)).toContainText("Needs Review");
  await expect(tiles.nth(3)).toContainText("2");
  await expect(page.locator("#rf-product")).not.toContainText("%");
  await expect(page.getByText("HARD", { exact: true })).toHaveCount(0);
});

test("alternatives: at most two, each with its own retail line and differences", async ({ page }) => {
  await prepare(page, reply(contracts.engineComplete()));
  await page.goto(PAGE);
  await runLookup(page);
  const panel = await openTab(page, "Replacement");
  const alts = panel.locator(".rf-alt");
  await expect(alts).toHaveCount(1);
  await expect(alts.first()).toContainText("Samsung QN55QN90D");
  await expect(alts.first()).toContainText("Above LKQ");
  await expect(alts.first()).toContainText("Best Buy");
  await expect(alts.first()).toContainText("$1,499.00");
  await expect(alts.first()).toContainText("Neo QLED");
});

// ---- 12. evidence ----------------------------------------------------------------------------------------------------

test("evidence: sources are grouped as original, replacement and retail availability, with safe links", async ({ page }) => {
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  const panel = await openTab(page, "Evidence");
  await expect(panel.locator("#rf-ev-original-h")).toHaveText("Original product evidence");
  await expect(panel.locator("#rf-ev-replacement-h")).toHaveText("Replacement evidence");
  await expect(panel.locator("#rf-ev-retail-h")).toHaveText("Retail availability evidence");
  await expect(panel.locator("#rf-ev-support-h")).toContainText("Supporting sources");
  const original = panel.locator("section", { has: page.locator("#rf-ev-original-h") });
  await expect(original.getByRole("link", { name: /Open source/ })).toHaveAttribute("href", "https://www.samsung.com/ca/tvs/q80c/");
  await expect(original).toContainText("Original product specifications");
  if (isNarrowViewport(page)) await expect(original).toContainText("Non-U.S. source for the original"); // the full text is under Overview
  else await expect(original).toContainText("non-U.S. Samsung page");
  const retail = panel.locator("section", { has: page.locator("#rf-ev-retail-h") });
  await expect(retail).toContainText("Samsung QN55QN80H: new, available, $999.99");
  await expect(retail.getByRole("link", { name: /Open source/ })).toHaveAttribute("href", "https://www.samsung.com/us/tvs/qn80h/");
  const links = panel.locator("a[href]");
  for (let i = 0; i < await links.count(); i++) {
    await expect(links.nth(i)).toHaveAttribute("href", /^https:\/\//);
    await expect(links.nth(i)).toHaveAttribute("target", "_blank");
    await expect(links.nth(i)).toHaveAttribute("rel", "noopener noreferrer");
  }
  await expect(panel).not.toContainText(/token|prompt|diagnostic/i);
  await settle(seen);
});

test("evidence: an empty group says so plainly", async ({ page }) => {
  const body = contracts.engineBestAvailableUnconfirmed();
  body.sources = [];
  body.primary.retail = null;
  await prepare(page, reply(body));
  await page.goto(PAGE);
  await runLookup(page);
  const panel = await openTab(page, "Evidence");
  await expect(panel).toContainText("No original product source was available.");
  await expect(panel).toContainText("No retail availability evidence was available.");
  await expect(panel.locator("#rf-ev-support-h")).toHaveCount(0);
  await expect(page.locator(".rf-lead-note")).toContainText("Current retail availability could not be confirmed");
  await expect(page.locator("#rf-lead-h")).toHaveText("Best Available Replacement"); // no retail evidence, so no claim that it is current
});

// ---- tabs and quick actions ------------------------------------------------------------------------------------------

test("tabs: five controls with the right semantics for the layout, and sections that show as that layout expects", async ({ page }) => {
  await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  const narrow = isNarrowViewport(page);
  if (narrow) {
    // One continuous page: a navigation landmark of five jump links, and every section is on the page at once.
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect(page.getByRole("tabpanel")).toHaveCount(0);
    const nav = page.getByRole("navigation", { name: "Product intelligence sections" });
    await expect(nav.getByRole("button")).toHaveText(SECTIONS);
    for (const name of SECTIONS) {
      await expect(page.getByRole("group", { name, exact: true })).toBeVisible();
      await expect(panelLocator(page, name)).toBeVisible();
    }
  } else {
    await expect(page.getByRole("navigation", { name: "Product intelligence sections" })).toHaveCount(0);
    const tabs = page.getByRole("tablist", { name: "Product intelligence sections" }).getByRole("tab");
    await expect(tabs).toHaveText(SECTIONS);
  }
  for (const name of SECTIONS) {
    await tabControl(page, name).click();
    await expectSection(page, name);
    if (!narrow) {
      await expect(page.getByRole("tabpanel")).toHaveCount(1);
      await expect(page.getByRole("tabpanel", { name, exact: true })).toBeVisible();
    }
    await expectNoHorizontalOverflow(page);
  }
});

test("quick actions: report actions are honest before a report and navigate real data after one", async ({ page }) => {
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await page.getByRole("button", { name: "Verify Specs" }).click({ force: true });
  await expect(page.locator("#rf-log")).toContainText("isn't available yet");
  await page.getByRole("button", { name: "Price Item" }).click({ force: true });
  await expect(page.locator("#rf-log")).toContainText("Standalone pricing isn't available yet");
  await expect(page.getByRole("button", { name: "Why this match?" })).toBeHidden();
  expect(seen.posts).toEqual([]);

  await runLookup(page);
  await expect(page.getByRole("button", { name: "Verify Specs" })).toHaveAttribute("aria-disabled", "false");
  await page.getByRole("button", { name: "Verify Specs" }).click();
  await expectSection(page, "Specifications");
  await page.getByRole("button", { name: "Price Item" }).click();
  await expectSection(page, "Pricing");
  await page.getByRole("button", { name: "Compare Models" }).click();
  await expectSection(page, "Replacement");
  await page.getByRole("button", { name: "Why this match?" }).click();
  await expectSection(page, "Overview", page.locator("#rf-why-h"));
  await expect(page.locator("#rf-why-h")).toBeFocused();
  expect(seen.posts).toHaveLength(1);
});

// ---- 14. responsive behaviour ---------------------------------------------------------------------------------------

test("layout: no Assistant | Product switch at any width", async ({ page }) => {
  await prepare(page, best());
  await page.goto(PAGE);
  await expect(page.locator("#rf-view-assistant, #rf-view-product, .rf-toggle")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Workspace view" })).toHaveCount(0);
  await expect(page.locator("#rf-shell[data-view]")).toHaveCount(0);
  await runLookup(page);
  await expect(page.locator("#rf-view-assistant, #rf-view-product, .rf-toggle")).toHaveCount(0);
});

test("layout: two panes side by side on wide screens, one continuous page on narrow ones", async ({ page }) => {
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  const width = page.viewportSize().width;
  const boxes = () => page.evaluate(() => ["#rf-assistant", "#rf-product"].map((selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top + window.scrollY, bottom: r.bottom + window.scrollY, width: r.width }; }));
  if (!isNarrowViewport(page)) {
    const [assistant, product] = await boxes();
    expect(product.left).toBeGreaterThanOrEqual(assistant.right - 1);
    expect(assistant.width).toBeGreaterThanOrEqual(340);
    expect(assistant.width / width).toBeLessThanOrEqual(0.42);
    expect(product.width / width).toBeGreaterThanOrEqual(0.58);
    await runLookup(page);
    await expect(page.locator("#rf-assistant")).toBeVisible();
    await expect(page.locator("#rf-product")).toBeVisible();
  } else {
    // Stacked, full width, both on the page before and after a lookup, with the product below the assistant.
    for (const phase of ["before", "after"]) {
      if (phase === "after") await runLookup(page);
      await expect(page.locator("#rf-assistant")).toBeVisible();
      await expect(page.locator("#rf-product")).toBeVisible();
      const [assistant, product] = await boxes();
      expect(product.top).toBeGreaterThanOrEqual(assistant.bottom - 1);
      expect(assistant.width).toBeGreaterThan(width - 2);
      expect(product.width).toBeGreaterThan(width - 2);
    }
  }
  await expectNoHorizontalOverflow(page);
  await settle(seen);
});

test("single page: the conversation, composer and report follow the requested reading order with nothing hidden", async ({ page }) => {
  test.skip(!isNarrowViewport(page), "single-page flow applies at narrow widths");
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  // (The sticky bar and tab row are left out: their position follows the scroll, not the document order.)
  // (The composer is pinned to the bottom of the screen, so it is checked in its own test rather than by document position.)
  const order = ["#rf-assistant-h", "#rf-log", "#rf-quick", "#rf-product-h", "#rf-product-name", ".rf-status-row", ".rf-lead", ".rf-compare", "#rf-price-h", "#rf-ev-original-h"];
  const tops = await page.evaluate((selectors) => selectors.map((selector) => { const node = document.querySelector(selector); return node ? node.getBoundingClientRect().top + window.scrollY : null; }), order);
  expect(tops.includes(null), `missing: ${order.filter((_, i) => tops[i] === null)}`).toBe(false);
  for (let i = 1; i < tops.length; i += 1) expect(tops[i], `${order[i]} should sit below ${order[i - 1]}`).toBeGreaterThanOrEqual(tops[i - 1]);
  // Specifications come before the comparison, and the tab row is the jump navigation for these same sections.
  expect(await page.evaluate(() => document.querySelector("#rf-specs-h").getBoundingClientRect().top < document.querySelector(".rf-compare").getBoundingClientRect().top)).toBe(true);
  // Nothing is hidden: every section, and the assistant pane, is rendered.
  for (const name of SECTIONS) await expect(panelLocator(page, name)).toBeVisible();
  expect(await page.locator("#rf-product [hidden]:not(.rf-visually-hidden)").count()).toBe(0);
  // No duplicated content: ids are unique and each headline element exists once.
  const duplicates = await page.evaluate(() => { const seenIds = {}; const dup = []; document.querySelectorAll("[id]").forEach((node) => { if (seenIds[node.id]) dup.push(node.id); seenIds[node.id] = true; }); return dup; });
  expect(duplicates).toEqual([]);
  for (const selector of [".rf-lead", ".rf-compare", "#rf-product-name", ".rf-tablist"]) await expect(page.locator(selector)).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
  await settle(seen);
});

test("single page: a finished lookup does not switch anything; focus moves to the product identity and the conversation folds to a summary", async ({ page }) => {
  test.skip(!isNarrowViewport(page), "single-page flow applies at narrow widths");
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  await expect(page.locator("#rf-product-name")).toBeFocused();
  await expect.poll(() => isLanded(page, page.locator(".rf-ph"))).toBe(true);
  // The conversation is still on the page, folded to one summary card, and reachable by scrolling up.
  await expect(page.locator("#rf-log")).toContainText("Find replacement: Samsung QN55Q80C");
  await expect(page.locator(".rf-msg--summary")).toContainText("Best Available Current Replacement");
  await expect(page.locator(".rf-msg--summary")).toContainText("Samsung QN55QN80H");
  await expect(page.locator(".rf-msg--summary")).toContainText("$999.99");
  await expect(page.locator(".rf-msg--summary")).toContainText("No Confirmed LKQ");
  await expect(page.getByRole("button", { name: "View product intelligence" })).toBeHidden(); // the report starts right below the summary
  await page.waitForTimeout(1300); // the smooth scroll to the identity finishes before the test scrolls itself
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect(page.locator(".rf-msg--summary")).toBeInViewport();
  await expect(page.getByLabel("Message ItemAssist")).toBeVisible();
  await settle(seen);
});

test("single page: the folded conversation can be opened and closed, and errors are never folded away", async ({ page }) => {
  test.skip(!isNarrowViewport(page), "single-page flow applies at narrow widths");
  let calls = 0;
  const seen = await prepare(page, { reply: () => (++calls === 1 ? { status: 200, body: contracts.engineBestAvailableUnconfirmed() } : { status: 429, body: errorBody("RATE_LIMITED") }) });
  await page.goto(PAGE);
  const toggle = page.getByRole("button", { name: /conversation/ });
  await expect(toggle).toBeHidden(); // nothing is folded before a result
  await runLookup(page);
  const lookupLine = page.locator(".rf-msg--user", { hasText: "Find replacement: Samsung QN55Q80C" });
  await expect(lookupLine).toBeHidden();
  await expect(toggle).toHaveText("View conversation");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  const folded = await page.locator("#rf-log").evaluate((log) => log.getBoundingClientRect().height);
  await toggle.click();
  await expect(toggle).toHaveText("Hide conversation");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(lookupLine).toBeVisible();
  await expect(page.locator("#rf-log")).toContainText("Tell me what item you're researching");
  expect(await page.locator("#rf-log").evaluate((log) => log.getBoundingClientRect().height)).toBeGreaterThan(folded);
  await toggle.click();
  await expect(lookupLine).toBeHidden();
  // A second lookup folds the old summary away (it describes a report that is gone); the error that follows is on screen.
  await fillAndSubmit(page);
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("lookup limit");
  await expect(alert).toBeVisible();
  await expect(page.locator(".rf-msg--summary")).toBeHidden();
  await expect(page.locator("#rf-product-name")).toHaveCount(0);
  await expect(toggle).toBeVisible();
  await settle(seen);
});

test("single page: each jump link scrolls to its own section, marks it current and moves focus there", async ({ page }) => {
  test.skip(!isNarrowViewport(page), "jump navigation applies at narrow widths");
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  for (const name of ["Specifications", "Replacement", "Pricing", "Evidence", "Overview", "Pricing"]) {
    await tabControl(page, name).click();
    await expectSection(page, name);
    await expect(panelLocator(page, name)).toBeFocused();
    for (const other of SECTIONS.filter((section) => section !== name)) await expect(tabControl(page, other)).not.toHaveAttribute("aria-current", /.+/);
  }
  // The Replacement jump lands on the replacement section's own content, not on a neighbour.
  await tabControl(page, "Replacement").click();
  await expectSection(page, "Replacement");
  await expect(page.locator("#rf-repl-h")).toBeInViewport();
  await expectNoHorizontalOverflow(page);
  await settle(seen);
});

test("single page: the current tab follows the page when the reader scrolls by hand", async ({ page }) => {
  test.skip(!isNarrowViewport(page), "jump navigation applies at narrow widths");
  await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  const scrollToSection = (id) => page.evaluate((selector) => {
    const panel = document.querySelector(selector);
    window.scrollTo({ top: panel.getBoundingClientRect().top + window.scrollY - 110, behavior: "instant" });
  }, `#rf-panel-${id}`);
  await page.waitForTimeout(1300); // the jump after a lookup holds the scroll-spy briefly
  await scrollToSection("replacement");
  await expect(tabControl(page, "Replacement")).toHaveAttribute("aria-current", "location");
  await scrollToSection("specs");
  await expect(tabControl(page, "Specifications")).toHaveAttribute("aria-current", "location");
  await expect(tabControl(page, "Replacement")).not.toHaveAttribute("aria-current", /.+/);
  // At the very end of the page the last section is the current one, even when it is too short to reach the top.
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  await expect(tabControl(page, "Evidence")).toHaveAttribute("aria-current", "location");
});

test("single page: the tab row stays pinned under the bar while a section is read", async ({ page }) => {
  test.skip(!isNarrowViewport(page), "jump navigation applies at narrow widths");
  await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  await tabControl(page, "Evidence").click();
  await expectSection(page, "Evidence");
  const gap = await page.evaluate(() => document.querySelector(".rf-tabbar").getBoundingClientRect().top - document.querySelector(".rf-bar").getBoundingClientRect().bottom);
  expect(Math.abs(gap)).toBeLessThanOrEqual(1);
});

test("desktop: the two-pane split, sticky assistant and tab behaviour are unchanged", async ({ page }) => {
  test.skip(isNarrowViewport(page), "two-pane layout applies above 960px");
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  const css = await page.evaluate(() => {
    const style = (selector, prop) => getComputedStyle(document.querySelector(selector))[prop];
    return {
      shell: style("#rf-shell", "display"), assistantPosition: style("#rf-assistant", "position"), logOverflow: style("#rf-log", "overflowY"),
      assistantHeight: document.querySelector("#rf-assistant").getBoundingClientRect().height, viewport: window.innerHeight
    };
  });
  expect(css.shell).toBe("grid");
  expect(css.assistantPosition).toBe("sticky");
  expect(css.logOverflow).toBe("auto");
  expect(css.assistantHeight).toBeCloseTo(css.viewport - 52, 0);
  // One panel at a time, as real tabs, with the left pane still showing the conversation.
  await expect(page.getByRole("tablist")).toHaveCount(1);
  await expect(page.getByRole("tabpanel")).toHaveCount(1);
  await expect(page.locator("#rf-panel-specs")).toBeHidden();
  await expect(page.locator("#rf-log")).toContainText("Find replacement: Samsung QN55Q80C");
  await settle(seen);
});

test("layout: crossing the breakpoint switches an open report between tabs and jump links without losing it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1280", "viewport is changed explicitly; run once");
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  await tabControl(page, "Pricing").click();
  await expect(page.getByRole("tab", { name: "Pricing" })).toHaveAttribute("aria-selected", "true");
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(page.getByRole("tablist")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Product intelligence sections" })).toBeVisible();
  for (const name of SECTIONS) await expect(panelLocator(page, name)).toBeVisible();
  await expect(tabControl(page, "Pricing")).toHaveAttribute("aria-current", "location");
  await expect(page.locator("#rf-product-name")).toHaveCount(1);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("tablist")).toHaveCount(1);
  await expect(page.getByRole("tab", { name: "Pricing" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveCount(1);
  await expect(panelLocator(page, "Specifications")).toBeHidden();
  await settle(seen);
});

test("layout: the composer stays reachable and the page does not scroll sideways at any width", async ({ page }) => {
  await prepare(page, best());
  await page.goto(PAGE);
  await expect(page.getByLabel("Message ItemAssist")).toBeInViewport();
  await openPrompt(page);
  await page.locator("#rf-model").fill("QN55Q80C");
  await page.locator("#rf-notes").fill("Must fit existing opening, reusing wall mount.");
  await expectNoHorizontalOverflow(page);
  await expect(page.locator("#rf-submit")).toBeVisible();
  await page.locator("#rf-submit").click();
  await page.locator("#rf-product-name").waitFor();
  for (const tab of ["Overview", "Specifications", "Replacement", "Pricing", "Evidence"]) {
    await openTab(page, tab);
    await expectNoHorizontalOverflow(page);
  }
});

// ---- errors and safety -----------------------------------------------------------------------------------------------

test("unsupported: a calm assistant message lets the user pick a supported category", async ({ page }) => {
  const seen = await prepare(page, reply(errorBody("UNSUPPORTED"), 422));
  await page.goto(PAGE);
  await fillAndSubmit(page, { model: "ZZ99X" });
  await expect(page.locator("#rf-log")).toContainText("I couldn't match");
  await expect(page.locator("#rf-log")).toContainText("ZZ99X");
  await page.getByRole("button", { name: "LG refrigerators" }).click();
  await expect(page.locator("#rf-brand")).toHaveValue("LG");
  await expect(page.locator("#rf-product-name")).toHaveCount(0);
  await settle(seen);
});

for (const [code, status, text] of [
  ["RATE_LIMITED", 429, "lookup limit"], ["CAPACITY_REACHED", 503, "research capacity"], ["SERVICE_UNAVAILABLE", 503, "temporarily unavailable"],
  ["ENGINE_TIMEOUT", 504, "took longer than expected"], ["ENGINE_ERROR", 502, "couldn't complete this lookup"], ["API_DISABLED", 503, "isn't available right now"]
]) {
  test(`errors: ${code} maps to a fixed, user-safe message with a way to retry`, async ({ page }) => {
    const seen = await prepare(page, reply(errorBody(code), status));
    await page.goto(PAGE);
    await fillAndSubmit(page);
    const alert = page.getByRole("alert");
    await expect(alert).toContainText(text);
    await expect(alert).not.toContainText("server text the page must not show");
    // The conversation and composer stay where they were and the error is on screen; nothing of a report is left behind.
    await expect(alert).toBeInViewport();
    await expect(page.getByLabel("Message ItemAssist")).toBeVisible();
    await expect(page.locator("#rf-product-name, .rf-lead, .rf-tablist, .rf-tabbar")).toHaveCount(0);
    await expect(productPane(page)).toContainText("Research an item to build its product profile");
    if (isNarrowViewport(page)) {
      const [errorBottom, productTop] = await page.evaluate(() => [document.querySelector(".rf-msg--error").getBoundingClientRect().bottom, document.querySelector("#rf-product").getBoundingClientRect().top]);
      expect(productTop).toBeGreaterThanOrEqual(errorBottom - 1);
    }
    await alert.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator("#rf-model")).toHaveValue("QN55Q80C");
    await expect(page.locator("#rf-ask")).toBeVisible();
    expect(seen.consoleErrors).toEqual([]);
    expect(seen.pageErrors).toEqual([]);
    expect(seen.analytics).toEqual([]);
  });
}

test("errors: raw, malformed and unexpected responses show only the generic message", async ({ page }) => {
  for (const body of ["<html>boom</html>", "null", JSON.stringify({ status: "COMPLETE" }), JSON.stringify({ status: "COMPLETE", original: {}, comparison: "x" }), JSON.stringify({ status: "COMPLETE", original: {}, comparison: [], primary: null })]) {
    const seen = await prepare(page, reply(body, 200));
    await page.goto(PAGE);
    await fillAndSubmit(page);
    await expect(page.getByRole("alert")).toContainText("couldn't complete this lookup");
    await expect(page.getByRole("alert")).toBeFocused();
    await expect(page.locator("#rf-product-name")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("boom");
    expect(seen.pageErrors).toEqual([]);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});

test("errors: a network failure shows a connection message, clears the stale report and a retry works", async ({ page }) => {
  let calls = 0;
  const seen = await prepare(page, { reply: () => (++calls === 1 ? { status: 200, body: contracts.engineComplete() } : calls === 2 ? "abort" : { status: 200, body: contracts.engineBestAvailableUnconfirmed() }) });
  await page.goto(PAGE);
  await runLookup(page);
  await expect(page.locator("#rf-lead-h")).toHaveText("Recommended Replacement");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await fillAndSubmit(page);
  await expect(page.getByRole("alert")).toContainText("couldn't reach ItemAssist");
  await expect(page.getByRole("alert")).toBeFocused();
  // The earlier report must not sit beside a conversation about a different lookup.
  await expect(page.locator("#rf-product-name")).toHaveCount(0);
  await expect(page.locator(".rf-lead")).toHaveCount(0);
  await expect(productPane(page)).toContainText("Research an item to build its product profile");
  await expect(page.getByRole("button", { name: "Verify Specs" })).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("alert").getByRole("button", { name: "Try again" }).click();
  await page.locator("#rf-submit").click();
  await expect(page.locator("#rf-lead-h")).toHaveText("Best Available Current Replacement");
  expect(seen.failedApi).toBe(1);
});

test("safety: API text is rendered as inert text, never as markup, and unsafe links are dropped", async ({ page }) => {
  const body = contracts.engineBestAvailableUnconfirmed();
  body.primary.explanation = '<img src=x onerror="window.__pwned=1">Explained';
  body.warnings[0].message = "<script>window.__pwned=1</script>careful";
  body.original.facts[0].value = "<b>QN55Q80C</b>";
  body.primary.retail.sourceUrl = "https://www.samsung.com/us/tvs/qn80h/";
  body.sources.push({ domain: "evil.example", url: "javascript:alert(1)", role: "SUPPORT" });
  const seen = await prepare(page, reply(body));
  await page.goto(PAGE);
  await runLookup(page);
  await expect(page.locator(".rf-why-text")).toContainText("<img src=x");
  await expect(page.locator(".rf-notes").first()).toContainText("<script>window.__pwned=1</script>careful");
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  await expect(page.locator("#rf-product img, #rf-product script")).toHaveCount(0);
  expect(await page.locator('a[href^="javascript:"]').count()).toBe(0);
  await settle(seen);
});

// ---- accessibility and analytics -------------------------------------------------------------------------------------

test("accessibility: landmarks, a live conversation log, labelled controls and visible focus", async ({ page }) => {
  await prepare(page, best());
  await page.goto(PAGE);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("log", { name: "Conversation" })).toHaveAttribute("aria-live", "polite");
  await expect(page.getByRole("region", { name: "ItemAssist Assistant", includeHidden: true })).toBeAttached();
  await expect(page.getByRole("region", { name: "Product Intelligence", includeHidden: true })).toBeAttached();
  for (const control of await page.locator("button, input:not([type=hidden]), textarea").all()) {
    if (!(await control.isVisible())) continue;
    const name = await control.evaluate((node) => node.getAttribute("aria-label") || (node.labels && node.labels[0] && node.labels[0].textContent) || node.textContent || node.getAttribute("placeholder"));
    expect((name || "").trim().length).toBeGreaterThan(0);
  }
  await page.locator('[data-action="find"]').focus();
  const outline = await page.locator('[data-action="find"]').evaluate((node) => getComputedStyle(node).outlineStyle);
  expect(outline).not.toBe("none");
  await runLookup(page);
  if (isNarrowViewport(page)) {
    // Jump navigation: a labelled navigation landmark with named sections, and no tab roles that would promise hidden panels.
    await expect(page.getByRole("navigation", { name: "Product intelligence sections" })).toHaveCount(1);
    await expect(page.getByRole("group", { name: "Specifications", exact: true })).toHaveCount(1);
    await expect(page.getByRole("tablist")).toHaveCount(0);
  } else {
    await expect(page.getByRole("tablist")).toHaveCount(1);
    await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "rf-tab-overview");
  }
  // Status is text first: every pill and badge carries a visible label.
  for (const pill of await page.locator(".rf-pill, .rf-badge, .rf-class").all()) expect(((await pill.textContent()) || "").trim().length).toBeGreaterThan(0);
});

test("accessibility: reduced motion removes animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await prepare(page, reply(contracts.engineComplete(), 200, 800));
  await page.goto(PAGE);
  await fillAndSubmit(page);
  const animation = await page.locator(".rf-stages li.active .rf-dot").evaluate((node) => getComputedStyle(node, "::after").animationName);
  expect(animation).toBe("none");
});

// The fixture itself is exercised in tests/request-intake/e2e/analytics-blocking.spec.js; here the workspace must simply never ask for analytics.
test("analytics: the workspace loads no analytics or tag manager at any point in a lookup", async ({ page }) => {
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  const html = await page.content();
  expect(html).not.toMatch(/googletagmanager|google-analytics|gtag\(/);
  expect(await page.evaluate(() => typeof window.gtag + typeof window.dataLayer)).toBe("undefinedundefined");
  expect(seen.analytics).toEqual([]);
});

test("pricing: the observed price appears once on the Pricing tab", async ({ page }) => {
  await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  const pricing = await openTab(page, "Pricing");
  await expect(pricing.getByText("$999.99")).toHaveCount(1);
  await expect(pricing.getByRole("group", { name: "Retail availability" })).toContainText("Available");
});

test("availability off: free text and a prompt cannot start a lookup", async ({ page }) => {
  const seen = await prepare(page, { enabled: false });
  await page.goto(PAGE);
  await expect(page.locator("#rf-unavailable")).toBeVisible();
  await page.getByLabel("Message ItemAssist").fill("Samsung QN55Q80C");
  await page.getByLabel("Message ItemAssist").press("Enter");
  await expect(page.locator("#rf-log")).toContainText("isn't available right now");
  await expect(page.locator("#rf-ask")).toHaveCount(0);
  expect(seen.posts).toEqual([]);
});

test("retail: a link that does not match the claimed seller still shows its real domain", async ({ page }) => {
  const body = contracts.engineBestAvailableUnconfirmed();
  body.primary.retail = contracts.retail({ sourceName: "Best Buy", sourceUrl: "https://www.samsung.com/us/tvs/qn80h/" });
  await prepare(page, reply(body));
  await page.goto(PAGE);
  await runLookup(page);
  await expect(page.locator(".rf-lead .rf-retail-seller")).toContainText("Best Buy");
  await expect(page.locator(".rf-lead .rf-retail-seller")).toContainText("samsung.com");
});

test("retail: a malformed observation time is omitted everywhere; the page never shows Invalid Date or invents one", async ({ page }) => {
  for (const observedAt of ["not a date", "2026-02-30T00:00:00Z", "2026", null]) {
    const body = contracts.engineComplete();
    body.primary.retail.observedAt = observedAt;
    body.alternatives[0].retail.observedAt = observedAt;
    const seen = await prepare(page, reply(body));
    await page.goto(PAGE);
    await runLookup(page);
    for (const tab of SECTIONS) await openTab(page, tab);
    const content = await page.locator("#rf-log, #rf-product").evaluateAll((nodes) => nodes.map((node) => node.textContent).join(" "));
    expect(content).not.toMatch(/Invalid Date|NaN|undefined|null/);
    expect(content).not.toMatch(/observed (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
    expect(content).not.toMatch(/Observed (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/);
    expect(content).toContain("$999.99"); // the price observation itself is untouched
    await settle(seen);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});
