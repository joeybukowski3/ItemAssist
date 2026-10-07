const { test, expect, contracts, errorBody, prepare, fillAndSubmit, expectNoHorizontalOverflow, PAGE } = require("./helpers.js");

const isNarrow = (testInfo) => testInfo.project.use.viewport.width <= 720;
const settle = async (seen) => { expect(seen.consoleErrors).toEqual([]); expect(seen.pageErrors).toEqual([]); expect(seen.analytics).toEqual([]); };

// ---- initial ---------------------------------------------------------------------------------------------------------

test("initial: the hero, lookup form and methodology render without overflow, errors or analytics", async ({ page }) => {
  const seen = await prepare(page);
  await page.goto(PAGE);

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Find the Right Replacement.");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Based on real time data and research.");
  await expect(page.getByText("Replacement Intelligence")).toHaveCount(0);
  await expect(page.locator(".rf-hero .rf-eyebrow")).toHaveText("Replacement Finder");
  await expect(page.getByText("Proprietary LKQ Research Engine")).toHaveCount(1);
  await expect(page.getByText("Specification-driven")).toBeVisible();
  await expect(page.getByRole("group", { name: "Category" })).toBeVisible();
  await expect(page.getByLabel("Brand")).toHaveValue("Samsung");
  await expect(page.getByLabel("Brand")).toHaveAttribute("readonly", "");
  await expect(page.getByLabel("Model number")).toBeVisible();
  await expect(page.getByLabel("Optional notes")).toBeVisible();
  await expect(page.getByText("Installation and fit requirements can affect the recommendation.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Find Replacement" })).toBeEnabled();
  await expect(page.getByText("Currently supports Samsung televisions and LG refrigerators.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "How ItemAssist evaluates replacements" })).toBeVisible();
  await expect(page.locator(".rf-steps li")).toHaveCount(4);
  await expect(page.locator(".rf-steps li h3")).toHaveText(["Identify", "Verify", "Compare", "Recommend"]);
  await expect(page.locator(".rf-steps .rf-step-icon svg")).toHaveCount(4);
  await expect(page.locator(".rf-header")).toContainText("Proprietary LKQ Research Engine");
  await expect(page.locator(".rf-header")).toContainText("Proof of concept");
  await expect(page.locator("#rf-results")).toBeEmpty();
  await expectNoHorizontalOverflow(page);
  await settle(seen);
});

test("initial: the page is noindex and has no site navigation", async ({ page }) => {
  await prepare(page);
  await page.goto(PAGE);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,nofollow");
  await expect(page.locator("nav")).toHaveCount(0);
  await expect(page.locator("header a")).toHaveCount(1);
});

test("initial: switching category swaps the supported brand and example, and keeps the model field usable", async ({ page }) => {
  await prepare(page);
  await page.goto(PAGE);
  await page.locator('label[for="rf-cat-refrigerator"]').click();
  await expect(page.getByLabel("Brand")).toHaveValue("LG");
  await expect(page.locator("#rf-use-example")).toHaveText("LRFCS25D3S");
  await page.locator("#rf-use-example").click();
  await expect(page.getByLabel("Model number")).toHaveValue("LRFCS25D3S");
});

test("form: availability check disables the form when the feature flag is off", async ({ page }) => {
  await prepare(page, { enabled: false });
  await page.goto(PAGE);
  await expect(page.locator("#rf-unavailable")).toBeVisible();
  await expect(page.getByRole("button", { name: "Find Replacement" })).toBeDisabled();
});

test("form: client validation shows an accessible error summary and sends nothing", async ({ page }) => {
  const seen = await prepare(page);
  await page.goto(PAGE);
  await page.getByRole("button", { name: "Find Replacement" }).click();
  const summary = page.locator("#rf-error-summary");
  await expect(summary).toBeVisible();
  await expect(summary).toHaveAttribute("role", "alert");
  await expect(summary).toBeFocused();
  await expect(page.locator("#rf-model")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#rf-model-error")).toContainText("Enter a model number");
  expect(seen.posts).toEqual([]);
  await page.locator("#rf-model").fill("<script>");
  await page.getByRole("button", { name: "Find Replacement" }).click();
  await expect(page.locator("#rf-model-error")).toContainText("letters, numbers");
  expect(seen.posts).toEqual([]);
  await settle(seen);
});

test("form: the keyboard alone can complete and submit it", async ({ page }) => {
  const seen = await prepare(page);
  await page.goto(PAGE);
  await page.locator("#rf-cat-television").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#rf-cat-refrigerator")).toBeChecked();
  await expect(page.getByLabel("Brand")).toHaveValue("LG");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByLabel("Brand")).toHaveValue("Samsung");

  await page.locator("#rf-model").focus();
  await page.keyboard.type("qn55q80c");
  await page.keyboard.press("Tab"); // example button
  await page.keyboard.press("Tab"); // notes
  await expect(page.locator("#rf-notes")).toBeFocused();
  await page.keyboard.type("Reusing existing wall mount");
  await page.keyboard.press("Tab");
  await expect(page.locator("#rf-submit")).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.locator("#rf-report-h")).toBeVisible();
  expect(seen.posts).toEqual([{ category: "television", brand: "Samsung", model: "QN55Q80C", notes: "Reusing existing wall mount", website: "" }]);
  await expect(page.locator("#rf-report-h")).toBeFocused();
  await settle(seen);
});

// ---- loading ---------------------------------------------------------------------------------------------------------

test("loading: a staged, visible 'what ItemAssist is doing' state appears while the request is in flight", async ({ page }) => {
  const seen = await prepare(page, { reply: () => ({ status: 200, body: contracts.engineComplete(), delayMs: 4000 }) });
  await page.goto(PAGE);
  await fillAndSubmit(page);

  const loading = page.locator("#rf-loading-h");
  await expect(loading).toBeVisible();
  await expect(loading).toBeFocused();
  await expect(page.locator("#rf-results")).toHaveAttribute("aria-busy", "true");
  await expect(page.locator(".rf-stages li")).toHaveCount(5);
  for (const stage of ["Identifying original product", "Verifying specifications", "Evaluating current models", "Comparing requirements", "Selecting best replacement"]) {
    await expect(page.locator(".rf-stages")).toContainText(stage);
  }
  await expect(page.locator('.rf-stages li[aria-current="step"]')).toHaveCount(1);
  await expect(page.getByText("This may take up to about 20 seconds.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Find Replacement" })).toBeDisabled();
  await expectNoHorizontalOverflow(page);

  await expect(page.locator("#rf-report-h")).toBeVisible();
  await expect(page.locator("#rf-loading-h")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Find Replacement" })).toBeEnabled();
  await settle(seen);
});

test("loading: Cancel stops the lookup, shows nothing stale and returns focus to the form", async ({ page }) => {
  const seen = await prepare(page, { reply: () => ({ status: 200, body: contracts.engineComplete(), delayMs: 2500 }) });
  await page.goto(PAGE);
  await fillAndSubmit(page);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("#rf-loading-h")).toHaveCount(0);
  await expect(page.locator("#rf-model")).toBeFocused();
  await page.waitForTimeout(3000);
  await expect(page.locator("#rf-report-h")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Find Replacement" })).toBeEnabled();
  await settle(seen);
});

// ---- complete --------------------------------------------------------------------------------------------------------

test("complete: original, recommendation, summary, comparison, verification and alternatives render from the contract", async ({ page }, testInfo) => {
  const body = contracts.engineComplete();
  body.alternatives = [0, 1, 2].map((i) => ({ ...body.alternatives[0], model: `QN55X${i}`, displayName: `Samsung QN55X${i}` }));
  const seen = await prepare(page, { reply: () => ({ status: 200, body }) });
  await page.goto(PAGE);
  await fillAndSubmit(page, { notes: "Reusing existing wall mount" });
  await expect(page.locator("#rf-report-h")).toHaveText("Replacement report");

  // Original product: every fact carries a status in words.
  const facts = page.locator(".rf-fact");
  await expect(facts).toHaveCount(4);
  await expect(page.locator(".rf-badge").filter({ hasText: "Verified" }).first()).toBeVisible();
  await expect(page.locator(".rf-badge").filter({ hasText: "Inferred" })).toBeVisible();
  await expect(page.locator(".rf-badge").filter({ hasText: "Unknown" })).toBeVisible();
  await expect(page.locator(".rf-fact .rf-unknown")).toHaveText("Not available");

  // Primary: categorical confidence, no percentage, deterministic explanation.
  const primary = page.locator(".rf-primary");
  await expect(primary).toContainText("Recommended replacement");
  await expect(primary.getByRole("heading", { level: 3 })).toHaveText("Samsung QN55Q80D");
  await expect(primary).toContainText("Like-Kind & Quality");
  await expect(primary).toContainText("Confidence");
  await expect(primary.locator(".rf-conf strong")).toHaveText("Medium");
  await expect(primary).toContainText("Matches the original screen size and resolution.");
  expect(await primary.innerText()).not.toMatch(/\d\s?%/);

  // Match Summary sits above the comparison and derives only from contract rows.
  const order = await page.evaluate(() => {
    const summary = document.querySelector(".rf-summary");
    const compare = document.querySelector(".rf-compare");
    return summary.compareDocumentPosition(compare) & Node.DOCUMENT_POSITION_FOLLOWING;
  });
  expect(order).toBeTruthy();
  const tiles = page.locator(".rf-tile");
  await expect(tiles).toHaveCount(4);
  await expect(tiles.nth(0)).toContainText("Required");
  await expect(tiles.nth(0)).toContainText("2 / 3");
  await expect(tiles.nth(0)).toContainText("met");
  await expect(tiles.nth(1)).toContainText("2 / 2");
  await expect(tiles.nth(2)).toContainText("0 / 1");
  await expect(tiles.nth(3)).toContainText("Needs verification");
  await expect(tiles.nth(3)).toContainText("1");
  await expect(page.locator(".rf-summary")).not.toContainText("%");

  // Comparison: importance and assessment are text; stacks on narrow screens.
  const rows = page.locator(".rf-table tbody tr");
  await expect(rows).toHaveCount(6);
  await expect(page.locator(".rf-imp").filter({ hasText: "Required" }).first()).toBeVisible();
  await expect(page.locator(".rf-imp").filter({ hasText: "Important" }).first()).toBeVisible();
  await expect(page.locator(".rf-imp").filter({ hasText: "Additional" }).first()).toBeVisible();
  for (const pill of await page.locator(".rf-pill").all()) await expect(pill).not.toHaveText("");
  await expect(page.locator(".rf-pill").filter({ hasText: "Meets requirement" }).first()).toBeVisible();
  await expect(page.locator(".rf-pill").filter({ hasText: "Needs verification" })).toBeVisible();
  await expect(page.locator(".rf-pill").filter({ hasText: "Differs" })).toBeVisible();
  const layout = await page.evaluate(() => ({
    rowDisplay: getComputedStyle(document.querySelector(".rf-table tbody tr")).display,
    headPosition: getComputedStyle(document.querySelector(".rf-table thead")).position,
    wrapScrolls: document.querySelector(".rf-table-wrap").scrollWidth > document.querySelector(".rf-table-wrap").clientWidth + 1
  }));
  if (isNarrow(testInfo)) {
    expect(layout.rowDisplay).toBe("grid");
    expect(layout.headPosition).toBe("absolute");
    await expect(rows.first().locator("td").first()).toBeVisible();
    expect(await rows.first().locator("td").first().evaluate((td) => getComputedStyle(td, "::before").content)).toContain("Original");
  } else {
    expect(layout.rowDisplay).toBe("table-row");
    await expect(page.locator(".rf-table thead th")).toHaveText(["Specification", "Original", "Recommended", "Assessment"]);
  }
  expect(layout.wrapScrolls).toBe(false);

  // Before Finalizing, alternatives (capped at two), sources.
  await expect(page.getByRole("heading", { name: "Before Finalizing" })).toBeVisible();
  await expect(page.locator(".rf-need")).toContainText("Physical fit");
  await expect(page.locator(".rf-reason")).toHaveText("Fit not verified");
  await expect(page.locator(".rf-alt")).toHaveCount(2);
  await expect(page.locator(".rf-primary")).toBeVisible();
  const links = page.locator(".rf-sources a");
  await expect(links).toHaveCount(2);
  for (const link of await links.all()) {
    await expect(link).toHaveAttribute("href", /^https:\/\//);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }

  await expectNoHorizontalOverflow(page);
  await settle(seen);
});

test("complete: the primary result visually dominates the alternatives", async ({ page }, testInfo) => {
  await prepare(page);
  await page.goto(PAGE);
  await fillAndSubmit(page);
  await expect(page.locator(".rf-alt")).toHaveCount(1);
  test.skip(isNarrow(testInfo), "Heading-size comparison is meaningful at the desktop layout.");
  const sizes = await page.evaluate(() => ({
    primary: parseFloat(getComputedStyle(document.querySelector(".rf-primary-title")).fontSize),
    alternative: parseFloat(getComputedStyle(document.querySelector(".rf-alt h4")).fontSize),
    primaryBg: getComputedStyle(document.querySelector(".rf-primary")).backgroundColor,
    altBg: getComputedStyle(document.querySelector(".rf-alt")).backgroundColor
  }));
  expect(sizes.primary).toBeGreaterThan(sizes.alternative * 1.5);
  expect(sizes.primaryBg).not.toBe(sizes.altBg);
});

test("complete: API text is rendered as inert text, never as markup", async ({ page }) => {
  const attack = '<img src=x onerror="window.__xss=1">';
  const body = contracts.engineComplete();
  body.original.displayName = attack;
  body.original.facts[0].value = attack;
  body.primary.displayName = attack;
  body.primary.explanation = `<script>window.__xss=2</script>${attack}`;
  body.comparison[0].label = attack;
  body.needsVerification[0].message = attack;
  body.alternatives[0].differences = [attack];
  body.sources[0].url = "javascript:window.__xss=3";
  const seen = await prepare(page, { reply: () => ({ status: 200, body }) });
  await page.goto(PAGE);
  await fillAndSubmit(page);
  await expect(page.locator("#rf-report-h")).toBeVisible();
  await expect(page.locator(".rf-primary-title")).toHaveText(attack);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(await page.locator("#rf-results img, #rf-results script").count()).toBe(0);
  expect(await page.locator('#rf-results a[href^="javascript"]').count()).toBe(0);
  await expect(page.locator(".rf-sources a")).toHaveCount(1, { timeout: 1000 });
  await settle(seen);
});

// ---- partial / best available ------------------------------------------------------------------------------------------

test("partial: a banner is shown and the usable primary and comparison are kept", async ({ page }) => {
  const seen = await prepare(page, { reply: () => ({ status: 200, body: contracts.enginePartial() }) });
  await page.goto(PAGE);
  await fillAndSubmit(page);
  await expect(page.locator("#rf-report-h")).toHaveText("Partial replacement report");
  await expect(page.locator(".rf-partial")).toContainText("Partial Recommendation");
  await expect(page.locator(".rf-partial")).toContainText("could not be fully verified");
  await expect(page.locator(".rf-primary-title")).toHaveText("Samsung QN55Q80D");
  await expect(page.locator(".rf-table tbody tr")).toHaveCount(6);
  await expect(page.locator(".rf-summary")).toBeVisible();
  await expect(page.locator(".rf-need").filter({ hasText: "Research completeness" })).toContainText("Time limit reached");
  await expect(page.locator(".rf-need--warning")).toContainText("Research stopped at the time limit");
  await expectNoHorizontalOverflow(page);
  await settle(seen);
});

test("no result: the original is shown and the page says plainly that no replacement was found", async ({ page }) => {
  const seen = await prepare(page, { reply: () => ({ status: 200, body: contracts.engineNoResult() }) });
  await page.goto(PAGE);
  await fillAndSubmit(page);
  await expect(page.locator("#rf-report-h")).toHaveText("No replacement found");
  await expect(page.getByText("We couldn't identify a replacement yet")).toBeVisible();
  await expect(page.locator(".rf-primary")).toHaveCount(0);
  await expect(page.locator(".rf-table")).toHaveCount(0);
  await expect(page.locator(".rf-original, .rf-card").first()).toBeVisible();
  await settle(seen);
});

test("best available: it is never presented as a normal recommendation", async ({ page }) => {
  const seen = await prepare(page, { reply: () => ({ status: 200, body: contracts.engineBestAvailable() }) });
  await page.goto(PAGE);
  await fillAndSubmit(page);
  const primary = page.locator(".rf-primary");
  await expect(primary).toHaveClass(/rf-primary--best/);
  await expect(primary).toContainText("Best available option found");
  await expect(primary).toContainText("Not LKQ");
  await expect(primary).toContainText("does not fully satisfy the like-kind-and-quality requirements");
  await expect(primary).not.toContainText("Recommended replacement");
  await expect(primary).not.toContainText("Like-Kind & Quality");
  await expect(page.getByText("Recommended replacement")).toHaveCount(0);
  await expect(page.locator(".rf-need--warning")).toContainText("closest available");
  await expectNoHorizontalOverflow(page);
  await settle(seen);
});

// ---- unsupported / errors ----------------------------------------------------------------------------------------------

test("unsupported: a calm, useful state that lists what is supported", async ({ page }) => {
  const seen = await prepare(page, { reply: () => ({ status: 422, body: errorBody("UNSUPPORTED") }) });
  await page.goto(PAGE);
  await fillAndSubmit(page, { model: "QN55Q60B" });
  await expect(page.locator("#rf-unsupported-h")).toHaveText("This model isn't supported yet.");
  await expect(page.locator("#rf-unsupported-h")).toBeFocused();
  const panel = page.locator(".rf-unsupported");
  await expect(panel).toContainText("QN55Q60B");
  await expect(panel).toContainText("Replacement Finder currently supports:");
  await expect(panel.getByRole("button", { name: /Samsung televisions/ })).toBeVisible();
  await expect(panel.getByRole("button", { name: /LG refrigerators/ })).toBeVisible();
  await expect(panel).toContainText("We're expanding manufacturer and category coverage as the engine is validated.");
  await expect(panel).not.toContainText(/error|failed|sorry/i);
  await expect(page.locator('#rf-results [role="alert"]')).toHaveCount(0);
  await expect(page.locator(".rf-error")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await panel.getByRole("button", { name: /LG refrigerators/ }).click();
  await expect(page.getByLabel("Brand")).toHaveValue("LG");
  await expect(page.locator("#rf-model")).toBeFocused();
  await expect(page.locator(".rf-unsupported")).toHaveCount(0);
  await settle(seen);
});

test("errors: fixed proxy errors map to user-safe messages, with no raw server text", async ({ page }) => {
  const cases = [
    [429, "RATE_LIMITED", "You've reached the lookup limit for now."],
    [503, "SERVICE_UNAVAILABLE", "Replacement research is temporarily unavailable."],
    [503, "CAPACITY_REACHED", "has reached its research capacity for today"],
    [504, "ENGINE_TIMEOUT", "took longer than expected"],
    [502, "ENGINE_ERROR", "We couldn't complete this lookup."],
    [400, "INVALID_REQUEST", "Check the model number and notes"]
  ];
  for (const [status, code, text] of cases) {
    const seen = await prepare(page, { reply: () => ({ status, body: errorBody(code) }) });
    await page.goto(PAGE);
    await fillAndSubmit(page);
    const panel = page.locator(".rf-error");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("role", "alert");
    await expect(panel).toContainText(text);
    await expect(page.locator("#rf-error-h")).toBeFocused();
    await expect(panel).not.toContainText("server text the page must not show");
    await expect(panel).not.toContainText(code);
    expect(seen.pageErrors).toEqual([]);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});

test("errors: raw, malformed and unexpected responses show only the generic message", async ({ page }) => {
  const raw = "TypeError: boom\n    at /srv/app/engine.js:10 SERPER_KEY_abc";
  for (const reply of [{ status: 500, body: raw }, { status: 200, body: "not json" }, { status: 200, body: { ok: true, message: "Request received." } }, { status: 200, body: { status: "WEIRD" } }, { status: 200, body: { status: "ERROR", errorCode: "<img src=x onerror=alert(1)>" } }]) {
    await prepare(page, { reply: () => reply });
    await page.goto(PAGE);
    await fillAndSubmit(page);
    const panel = page.locator(".rf-error");
    await expect(panel).toContainText("We couldn't complete this lookup.");
    const text = await panel.innerText();
    for (const leak of ["TypeError", "/srv/app", "SERPER", "WEIRD", "<img"]) expect(text).not.toContain(leak);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});

test("errors: a network failure shows a connection message and the form works again afterwards", async ({ page }) => {
  let attempts = 0;
  const seen = await prepare(page, { reply: () => (++attempts === 1 ? "abort" : { status: 200, body: contracts.engineComplete() }) });
  await page.goto(PAGE);
  await fillAndSubmit(page);
  await expect(page.locator(".rf-error")).toContainText("We couldn't reach ItemAssist.");
  await page.getByRole("button", { name: "Back to the form" }).click();
  await expect(page.locator("#rf-model")).toBeFocused();
  await expect(page.getByRole("button", { name: "Find Replacement" })).toBeEnabled();
  await page.getByRole("button", { name: "Find Replacement" }).click();
  await expect(page.locator("#rf-report-h")).toBeVisible();
  expect(seen.posts).toHaveLength(2);
});

test("reset: New lookup clears the report and returns to the form", async ({ page }) => {
  const seen = await prepare(page);
  await page.goto(PAGE);
  await fillAndSubmit(page);
  await expect(page.locator("#rf-report-h")).toBeVisible();
  await page.getByRole("button", { name: "New lookup" }).click();
  await expect(page.locator("#rf-results")).toBeEmpty();
  await expect(page.locator("#rf-model")).toBeFocused();
  await settle(seen);
});

// ---- accessibility, analytics ------------------------------------------------------------------------------------------

test("accessibility: status is text first, live regions and landmarks are present, and focus is visible", async ({ page }) => {
  const seen = await prepare(page);
  await page.goto(PAGE);
  await expect(page.locator("#rf-results")).toHaveAttribute("aria-live", "polite");
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator("form fieldset legend")).toHaveText("Category");
  for (const input of await page.locator("#rf-form input[type=text]:not([tabindex='-1']), #rf-form textarea").all()) {
    const id = await input.getAttribute("id");
    await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1);
  }
  await fillAndSubmit(page);
  await expect(page.locator("#rf-report-h")).toBeVisible();
  for (const selector of [".rf-badge", ".rf-pill", ".rf-class", ".rf-imp"]) {
    for (const element of await page.locator(selector).all()) {
      expect((await element.innerText()).trim().length).toBeGreaterThan(2);
    }
  }
  await page.locator("#rf-model").focus();
  const outline = await page.locator("#rf-model").evaluate((element) => getComputedStyle(element).boxShadow + getComputedStyle(element).outlineStyle);
  expect(outline).not.toBe("noneNone");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle)).not.toBe("none");
  await settle(seen);
});

test("analytics: the page loads no analytics or tag manager, and the blocking fixture is active", async ({ page, context }) => {
  const seen = await prepare(page);
  await page.goto(PAGE);
  await fillAndSubmit(page);
  await expect(page.locator("#rf-report-h")).toBeVisible();
  expect(await page.locator('script[src*="google"], script[src*="gtag"], script[src*="googletagmanager"]').count()).toBe(0);
  expect(await page.content()).not.toMatch(/googletagmanager|google-analytics|gtag\(/);
  expect(seen.analytics).toEqual([]);
  const probe = await page.evaluate(async () => { try { await fetch("https://www.googletagmanager.com/gtm.js", { mode: "no-cors" }); return "reached"; } catch (error) { return "blocked"; } });
  expect(probe).toBe("blocked");
  expect(context).toBeTruthy();
});
