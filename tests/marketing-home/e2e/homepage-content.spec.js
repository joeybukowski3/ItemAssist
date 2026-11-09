const { test, expect, stubSite, horizontalOverflow } = require("./helpers.js");

const isMobile = (testInfo) => testInfo.project.use.viewport.width <= 900;

test.beforeEach(async ({ page }) => {
  await stubSite(page);
});

test("the hero leads with the positioning, a short value proposition, credibility points and the working inquiry form", async ({ page }) => {
  await page.goto("/");
  const hero = page.locator(".home-hero");
  const text = hero.locator(".home-hero-text");
  await expect(text.locator(".home-hero-kicker")).toHaveText(/Market Pricing, Product Identification & LKQ Research Experts/);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveText("Spend Less Time Researching Contents. More Time Managing Claims.");
  await expect(text.locator(".home-hero-sub")).toHaveCount(1);
  await expect(text.locator(".home-hero-sub")).toHaveText(
    "Professionally reviewed product identification, comparable replacement research, and documented retail pricing for independent adjusters, public adjusters, and claims professionals."
  );
  await expect(text.locator(".hero-points strong")).toHaveText(["Human-reviewed research.", "Documented retail sources.", "Clear replacement reasoning."]);
  await expect(text.locator(".hero-sample .hero-sample-link").nth(0)).toHaveAttribute("href", "#sample");
  await expect(text.locator(".hero-sample .hero-sample-link").nth(1)).toHaveAttribute("href", "/assets/ItemAssist-Sample-Research-Report.pdf");
  // No pricing offer or badge, and no second set of CTAs competing with the form.
  await expect(text.locator(".btn-primary, .home-hero-price, .intro-offer-badge")).toHaveCount(0);
  await expect(text).not.toContainText("$");

  // The existing form lives inside the hero, after the headline in document order.
  await expect(hero.locator("#contact #consultation #consultation-form")).toHaveCount(1);
  await expect(page.locator("form")).toHaveCount(1);
  const before = await page.evaluate(() => {
    const h1 = document.querySelector("h1");
    const form = document.getElementById("consultation-form");
    return Boolean(h1.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(before).toBe(true);
});

test("the inquiry form is reachable without scrolling through the page, and the hero columns are balanced", async ({ page }, testInfo) => {
  await page.goto("/");
  // Measure the settled layout, not a frame of the entrance animation.
  await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; }" });
  const { width, height } = testInfo.project.use.viewport;
  await expect(page.locator("#consult-name")).toBeInViewport();
  const boxes = await page.evaluate(() => {
    const rect = (el) => el.getBoundingClientRect();
    const text = rect(document.querySelector(".home-hero-text"));
    const form = rect(document.querySelector(".hero-consult"));
    const showcase = rect(document.getElementById("comparable"));
    return { text: { top: text.top, bottom: text.bottom, left: text.left, right: text.right }, form: { top: form.top, bottom: form.bottom, left: form.left, right: form.right, height: form.height }, showcaseTop: showcase.top };
  });
  if (width >= 1024) {
    await expect(page.locator("#consultation-form .form-submit")).toBeInViewport();
    // Side by side, and neither column is disproportionately taller than the other.
    expect(boxes.text.right).toBeLessThan(boxes.form.left);
    const textHeight = boxes.text.bottom - boxes.text.top;
    expect(textHeight).toBeGreaterThan(boxes.form.height * 0.45);
    // The form starts within the first screen and the next section follows without a large empty gap.
    expect(boxes.form.top).toBeLessThan(height * 0.2);
    expect(boxes.showcaseTop - boxes.form.bottom).toBeLessThan(120);
  } else {
    // Stacked: headline and value proposition first, then the form, then the next section.
    expect(boxes.text.bottom).toBeLessThanOrEqual(boxes.form.top + 1);
    expect(boxes.showcaseTop).toBeGreaterThanOrEqual(boxes.form.bottom - 1);
    expect(boxes.form.top).toBeLessThan(height * 0.9);
  }
});

test("on narrow screens one proof line and a single sample-report link sit between the description and the form, without crowding it", async ({ page, request }, testInfo) => {
  await page.goto("/");
  await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; }" });
  const { width } = testInfo.project.use.viewport;
  const proof = page.locator(".hero-mobile-proof");
  await expect(proof).toHaveCount(1);
  const link = proof.locator("a");
  await expect(link).toHaveText(/View Sample Report/);
  await expect(link).toHaveAttribute("href", "/report");
  if (width > 860) {
    // Desktop keeps the full credibility block instead.
    await expect(proof).toBeHidden();
    await expect(page.locator(".hero-points")).toBeVisible();
    return;
  }
  await expect(proof).toBeVisible();
  await expect(proof).toContainText("Human-reviewed research · Documented pricing · LKQ comparisons");
  // The full three-item block and the two-link row stay hidden.
  await expect(page.locator(".hero-points")).toBeHidden();
  await expect(page.locator(".hero-sample")).toBeHidden();
  // Order: description, proof line, form.
  const order = await page.evaluate(() => {
    const top = (selector) => document.querySelector(selector).getBoundingClientRect().top;
    return { sub: top(".home-hero-sub"), proof: top(".hero-mobile-proof"), form: top(".hero-consult") };
  });
  expect(order.sub).toBeLessThan(order.proof);
  expect(order.proof).toBeLessThan(order.form);
  // The proof line is compact, and the first required field stays within the first screen.
  const proofBox = await proof.boundingBox();
  expect(proofBox.height).toBeLessThan(80);
  expect(proofBox.width).toBeLessThanOrEqual(width);
  await expect(page.locator("#consult-name")).toBeInViewport();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  // The link target exists.
  expect((await request.get("/report")).status()).toBe(200);
  await Promise.all([page.waitForURL(/\/report/), link.click()]);
  await expect(page.locator("h1")).toBeVisible();
});

test("legacy deep links still land on the form, which now sits in the hero", async ({ page }) => {
  for (const hash of ["#consultation", "#contact", "#submit-assignment"]) {
    await page.goto("/index.html" + hash);
    await expect(page.locator("#consultation-form")).toBeInViewport();
  }
  await expect(page.locator(".home-hero #consultation")).toHaveCount(1);
  await expect(page.locator("#consultation #submit-assignment")).toHaveCount(1);
  await expect(page.locator("#contact")).toHaveCount(1);
  // One form, one initialization: each script is loaded once.
  const scripts = await page.locator("script[src]").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("src")));
  expect(new Set(scripts).size).toBe(scripts.length);
  expect(scripts.filter((s) => s === "consultation.js")).toHaveLength(1);
  expect(scripts.filter((s) => s === "showcase.js")).toHaveLength(1);
  await expect(page.locator("[data-turnstile-container]")).toHaveCount(1);
});

test("below the hero, a sample report preview sits beside a two-tab research showcase that defaults to televisions", async ({ page }) => {
  await page.goto("/");
  const section = page.locator("#comparable");
  await expect(section.locator("h2")).toHaveText("Similar Isn\u2019t the Same as Comparable");
  await expect(section.locator(".mini-report")).toHaveCount(1);
  await expect(section.locator(".showcase")).toHaveCount(1);
  const tabs = section.locator('[role="tab"]');
  await expect(section.locator('[role="tablist"]')).toHaveAttribute("aria-label", "Research examples");
  await expect(tabs).toHaveText(["Televisions", "Refrigerators"]);
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "false");
  for (const tab of await tabs.all()) {
    const panel = page.locator("#" + (await tab.getAttribute("aria-controls")));
    await expect(panel).toHaveAttribute("role", "tabpanel");
    await expect(panel).toHaveAttribute("aria-labelledby", await tab.getAttribute("id"));
  }
  await expect(page.locator("#sc-panel-tv")).toBeVisible();
  await expect(page.locator("#sc-panel-fridge")).toBeHidden();
  // The retired hypothetical figures, the older August example and the old compact finding card are gone.
  await expect(section).not.toContainText(/hypothetical|\$249|\$1,499|August 13|RF32CG5100|RF32CG5300|receiver/i);
  await expect(page.locator(".hero-finding, .comparable-card, .comparable-ladder, #sample-report")).toHaveCount(0);
});

test("the sample report preview is a miniature report built from the three researched cases", async ({ page }) => {
  await page.goto("/");
  const report = page.locator(".mini-report");
  await expect(report.locator("img")).toHaveAttribute("alt", "Item Assist");
  await expect(report.locator(".mr-head h3")).toHaveText("Sample Research Report");
  await expect(report.locator(".mr-date")).toHaveText("Prices observed November 9, 2026");
  await expect(report.locator(".mr-bar")).toContainText("not a claim determination");
  await expect(report.locator(".mr-item")).toHaveCount(3);
  const text = (await report.textContent()).replace(/\s+/g, " ");
  for (const needle of [
    "Samsung QN55Q80AAFXZA", "Samsung QN55QN80H", "$899.99", "Black Friday Deal", "Samsung list $1,299.99", "native refresh per RTINGS (third-party)",
    "Samsung RF28R7201SR", "identical model", "$1,899.99", "Illustrative ACV $1,023.07", "assumed 6.0-year age, 13-year life, no condition adjustment",
    "GE GFD65ESSNWW", "GE GFD65ESSVWW", "$899.00", "Dec 2019 to Aug 2023", "3.2 to 6.9 years", "$419 to $678", "No serial number was available, so no unit date is stated",
    "Item Assist does not determine depreciation, final ACV, coverage or settlement"
  ]) {
    expect(text, needle).toContain(needle);
  }
  await expect(report.locator(".mr-chip")).toHaveText(["Documented", "Third-party", "Observed price", "Assumed"]);
  await expect(report.locator('a[href="/report"]')).toHaveText("Read the full sample report");
  await expect(report.locator('a[href="/assets/ItemAssist-Sample-Research-Report.pdf"]')).toHaveText("Download the 2-page PDF");
  // None of the retired fictional report survives.
  expect(text).not.toMatch(/fictional|IA-DEMO|22 |95%|High Confidence|Average Documented Age|17,022|34,152|Published/i);
  await expect(page.locator(".report-published-date")).toHaveCount(0);
});

test("the television tab summarizes the original, three candidates, the key differences and dated prices", async ({ page }) => {
  await page.goto("/");
  const tv = page.locator("#sc-panel-tv");
  await expect(tv.locator(".sc-orig")).toContainText("Samsung QN55Q80AAFXZA");
  await expect(tv.locator(".sc-orig")).toContainText("120Hz native panel per RTINGS");
  await expect(tv.locator(".sc-role")).toHaveText(["Lower-priced", "Selected LKQ", "Higher-priced"]);
  await expect(tv.locator(".sc-model")).toHaveText(["Samsung QN55QN70H", "Samsung QN55QN80H", "Samsung QN55S90H"]);
  await expect(tv.locator(".sc-price")).toHaveText(["$699.99", "$899.99", "$1,199.99"]);
  await expect(tv.locator(".sc-verdict .rc-flag")).toHaveText([/Shortfall/, /Meets/, /Upgrade/]);
  await expect(tv.locator(".sc-cand.is-selected .sc-model")).toHaveText("Samsung QN55QN80H");
  await expect(tv.locator(".sc-note")).toContainText("native refresh rate, 4K@120Hz input and VRR");
  await expect(tv.locator(".sc-note")).toContainText("Nov 9, 2026");
  await expect(tv.locator(".sc-note")).toContainText("Black Friday and Holiday Deal promotions");
  await expect(tv.locator(".sc-note")).toContainText("Samsung list prices $899.99, $1,299.99 and $1,999.99");
  // Not over-claimed: the QN80H is not called the cheapest suitable Samsung, and the QN80F stays unresolved.
  await expect(tv.locator(".sc-note")).toContainText("not presented as the lowest-priced suitable Samsung");
  await expect(tv.locator(".sc-note")).toContainText("QN80F");
  await expect(tv.locator(".sc-note")).toContainText("unresolved");
  await expect(tv.locator('a[href="/report#case-tv"]')).toHaveText(/See the complete case/);
  await expect(page.locator("#comparable")).not.toContainText(/comparable value|\bwas \$|\bsave \$|\bsavings?\b|most supportable|universal/i);
});

test("tabs switch by click and keyboard, show one case at a time, and keep roving focus", async ({ page }) => {
  await page.goto("/");
  const tvTab = page.locator("#sc-tab-tv");
  const fridgeTab = page.locator("#sc-tab-fridge");
  await expect(tvTab).toHaveAttribute("tabindex", "0");
  await expect(fridgeTab).toHaveAttribute("tabindex", "-1");

  await fridgeTab.click();
  await expect(fridgeTab).toHaveAttribute("aria-selected", "true");
  await expect(tvTab).toHaveAttribute("aria-selected", "false");
  await expect(page.locator("#sc-panel-fridge")).toBeVisible();
  await expect(page.locator("#sc-panel-tv")).toBeHidden();
  await expect(fridgeTab).toHaveAttribute("tabindex", "0");
  await expect(tvTab).toHaveAttribute("tabindex", "-1");

  await tvTab.click();
  await tvTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(fridgeTab).toBeFocused();
  await expect(fridgeTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(tvTab).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(fridgeTab).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tvTab).toBeFocused();
  await expect(page.locator("#sc-panel-tv")).toBeVisible();
  await page.keyboard.press("End");
  await expect(fridgeTab).toBeFocused();
  await expect(page.locator("#sc-panel-fridge")).toBeVisible();

  // Tab from the tab list reaches the active panel, and the panel is a focusable, labelled region.
  await page.keyboard.press("Tab");
  await expect(page.locator("#sc-panel-fridge")).toBeFocused();
});

test("the refrigerator tab summarizes the original model, both look-alikes and the substitution point", async ({ page }) => {
  await page.goto("/");
  await page.locator("#sc-tab-fridge").click();
  const fridge = page.locator("#sc-panel-fridge");
  await expect(fridge.locator(".sc-orig")).toContainText("Samsung RF28R7201SR");
  await expect(fridge.locator(".sc-role")).toHaveText(["Lower-priced", "Selected: original model", "Higher-priced"]);
  await expect(fridge.locator(".sc-model")).toHaveText(["Samsung RF32CG5B30SR", "Samsung RF28R7201SR", "Samsung RF29BB8600QL"]);
  await expect(fridge.locator(".sc-price")).toHaveText(["$1,799.99", "$1,899.99", "$2,199.99"]);
  await expect(fridge.locator(".sc-verdict")).toHaveText([/Shortfall\s+3-door; no FlexZone drawer/, /Meets\s+Same model, still sold new/, /Shortfall\s+No external dispenser; smaller FlexZone/]);
  await expect(fridge.locator(".sc-note")).toContainText("configuration, FlexZone functionality and dispenser placement");
  await expect(fridge.locator(".sc-note")).toContainText("Nov 9, 2026");
  await expect(fridge.locator(".sc-note")).toContainText("two Black Friday Deals and one marked-down price");
  await expect(fridge.locator(".sc-note")).toContainText("removes the substitution question");
  await expect(fridge.locator('a[href="/report#case-fridge"]')).toHaveText(/See the complete case/);
});

test("the full comparison tables stay collapsed, open one at a time on request, and keep their documented content", async ({ page }) => {
  await page.goto("/");
  const toggleTv = page.locator('.sc-toggle[aria-controls="sc-more-tv"]');
  await expect(toggleTv).toHaveText("Show full specification comparison");
  await expect(toggleTv).toHaveAttribute("aria-expanded", "false");
  // No full technical table is on screen by default, and never both at once.
  await expect(page.locator("#tv-comparison")).toBeHidden();
  await expect(page.locator("#fridge-comparison")).toBeHidden();

  await toggleTv.click();
  await expect(toggleTv).toHaveAttribute("aria-expanded", "true");
  await expect(toggleTv).toHaveText("Hide full specification comparison");
  await expect(page.locator("#tv-comparison")).toBeVisible();
  await expect(page.locator("#fridge-comparison")).toBeHidden();

  const tv = page.locator("#sc-panel-tv");
  await expect(tv.locator(".rc-orig-model")).toHaveText("Samsung QN55Q80AAFXZA");
  await expect(tv.locator(".rc-src--mfr")).toHaveCount(4);
  await expect(tv.locator(".rc-src--third")).toHaveText(/RTINGS/);
  await expect(tv.locator("thead .rc-model")).toHaveText(["Samsung QN55QN70H", "Samsung QN55QN80H", "Samsung QN55S90H"]);
  await expect(tv.locator("thead .rc-price")).toHaveText(["$699.99", "$899.99", "$1,199.99"]);
  await expect(tv.locator("thead .rc-meta")).toHaveText([/Nov 9, 2026 · Black Friday Deal/, /Nov 9, 2026 · Black Friday Deal/, /Nov 9, 2026 · Holiday Deal/]);
  const rows = page.locator("#tv-comparison tbody tr");
  const expected = {
    "Display technology": ["Meets", "Meets", "Upgrade"],
    Backlight: ["Meets", "Meets", "Upgrade"],
    "Native refresh rate": ["Shortfall", "Meets", "Upgrade"],
    "4K@120Hz HDMI input": ["Shortfall", "Meets", "Upgrade"],
    "Variable refresh rate": ["Shortfall", "Meets", "Meets"],
    Conclusion: ["Shortfall", "Meets", "Upgrade"]
  };
  for (const [name, flags] of Object.entries(expected)) {
    const row = rows.filter({ has: page.locator("th", { hasText: new RegExp("^" + name) }) });
    await expect(row, name).toHaveCount(1);
    expect((await row.locator(".rc-flag").allTextContents()).map((f) => f.replace(/[^A-Za-z]/g, "")), name).toEqual(flags);
  }
  await expect(page.locator("#tv-comparison td.rc-sel .rc-bad")).toHaveCount(0);
  const cell = (row, col) => rows.nth(row).locator("td").nth(col);
  await expect(cell(5, 1)).toHaveText("$899.99");
  await expect(cell(6, 0)).toHaveText("$899.99");
  await expect(cell(6, 1)).toHaveText("$1,299.99");
  await expect(cell(6, 2)).toHaveText("$1,999.99");
  await expect(tv.locator(".rc-disclosure")).toContainText("not regular prices");
  await expect(tv.locator(".rc-disclosure")).toContainText("native refresh rate, a third-party measurement by RTINGS");

  // Opening the second case is independent of the first, and only its own table shows.
  await page.locator("#sc-tab-fridge").click();
  await page.locator('.sc-toggle[aria-controls="sc-more-fridge"]').click();
  await expect(page.locator("#fridge-comparison")).toBeVisible();
  await expect(page.locator("#tv-comparison")).toBeHidden();
  const fridge = page.locator("#sc-panel-fridge");
  await expect(fridge.locator("thead .rc-model")).toHaveText(["Samsung RF32CG5B30SR", "Samsung RF28R7201SR", "Samsung RF29BB8600QL"]);
  await expect(fridge.locator("thead .rc-meta")).toHaveText([/Nov 9, 2026 · Sale price/, /Nov 9, 2026 · Black Friday Deal/, /Nov 9, 2026 · Black Friday Deal/]);
  await expect(fridge.locator("tbody tr.rc-conclusion td.rc-sel")).toContainText("Same model, still available new");

  // Collapsing works by keyboard.
  const toggleFridge = page.locator('.sc-toggle[aria-controls="sc-more-fridge"]');
  await toggleFridge.focus();
  await page.keyboard.press("Enter");
  await expect(toggleFridge).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#fridge-comparison")).toBeHidden();
});

test("an expanded comparison highlights the selected candidate and stays labelled at every width", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.locator('.sc-toggle[aria-controls="sc-more-tv"]').click();
  const metrics = await page.locator("#tv-comparison").evaluate((table) => {
    const px = (node, prop) => parseFloat(getComputedStyle(node)[prop]);
    const sel = table.querySelector("thead th.rc-sel");
    const other = table.querySelector("thead th.rc-col:not(.rc-sel)");
    const selCell = table.querySelector("tbody td.rc-sel");
    const heads = Array.from(table.querySelectorAll("thead th.rc-col")).map((el) => el.getBoundingClientRect());
    const cells = Array.from(table.querySelectorAll("tbody tr:first-child td")).map((el) => el.getBoundingClientRect());
    return {
      selBorder: Math.max(px(sel, "borderTopWidth"), px(sel, "borderLeftWidth")),
      otherBorder: Math.max(px(other, "borderTopWidth"), px(other, "borderLeftWidth")),
      selCellBorder: px(selCell, "borderLeftWidth"),
      selBackground: getComputedStyle(sel).backgroundColor,
      otherBackground: getComputedStyle(other).backgroundColor,
      headY: heads.map((r) => Math.round(r.top)),
      cellY: cells.map((r) => Math.round(r.top)),
      cellX: cells.map((r) => Math.round(r.left)),
      labelContent: getComputedStyle(selCell, "::before").content
    };
  });
  expect(metrics.selBorder).toBeGreaterThanOrEqual(2);
  expect(metrics.selBorder).toBeGreaterThan(metrics.otherBorder);
  expect(metrics.selCellBorder).toBeGreaterThanOrEqual(2);
  expect(metrics.selBackground).not.toBe(metrics.otherBackground);
  if (testInfo.project.use.viewport.width <= 820) {
    expect(metrics.headY[0]).toBeLessThan(metrics.headY[1]);
    expect(metrics.headY[1]).toBeLessThan(metrics.headY[2]);
    expect(new Set(metrics.cellX).size).toBe(1);
    expect(metrics.labelContent).toMatch(/Display technology \(original: QLED, quantum dot\)/);
  } else {
    expect(new Set(metrics.headY).size).toBe(1);
    expect(new Set(metrics.cellY).size).toBe(1);
    expect(new Set(metrics.cellX).size).toBe(3);
  }
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  await page.locator("#sc-tab-fridge").click();
  await page.locator('.sc-toggle[aria-controls="sc-more-fridge"]').click();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test("a financial-impact illustration replaces the two-card pricing explanation, and is plainly hypothetical", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "A Poor Comparison Can Miss in Either Direction" })).toHaveCount(0);
  await expect(page.locator(".pricing-risk-section, .outcome-card")).toHaveCount(0);
  const section = page.locator("#impact");
  await expect(section.locator("h2")).toHaveText("Small Pricing Differences Can Add Up Across an Entire Claim");
  await expect(section.locator(".rc-tag")).toHaveText("Hypothetical example");
  await expect(section.locator(".impact-visual")).toHaveAttribute("aria-label", /50 items times a \$100 pricing difference per item equals a \$5,000 cumulative difference/);
  await expect(section.locator(".impact-eq b")).toHaveText(["50", "$100", "$5,000"]);
  await expect(section.locator(".impact-grid i")).toHaveCount(50);
  await expect(section).toContainText("Differences can run in either direction");
  await expect(section).toContainText("overstatements and understatements can partly offset one another");
  await expect(section).toContainText("Hypothetical arithmetic for illustration only. It is not an observed error rate and not a result for any client.");
  await expect(section).not.toContainText(/\bsaved?\b|\bsavings?\b|\bclients? (have|has)\b|industry (error|average)|studies show/i);
  // Minimal copy: a short explanation, not another set of long cards.
  const words = (await section.locator(".impact-copy").textContent()).split(/\s+/).filter(Boolean).length;
  expect(words).toBeLessThan(90);
});

test("title, description and social descriptions describe the service and carry no price", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Contents Research Support for Insurance Professionals | Item Assist");
  const meta = (selector) => page.locator(selector).getAttribute("content");

  const description = await meta('meta[name="description"]');
  expect(description).toMatch(/adjusters and claims professionals/);
  expect(description.length).toBeLessThanOrEqual(160);
  for (const selector of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) {
    const value = await meta(selector);
    expect(value, selector).toMatch(/professionally reviewed product identification/i);
    expect(value, selector).not.toMatch(/\$|starting at/i);
  }
  expect(await meta('meta[property="og:title"]')).toBe("Contents Research Support for Insurance Professionals | Item Assist");
  expect(await meta('meta[name="twitter:title"]')).toBe("Contents Research Support for Insurance Professionals | Item Assist");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://itemassist.com/");
});

test("one benefits section replaces the deliverables grid and the category grid", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "What a Completed Assignment May Include" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "What We Research" })).toHaveCount(0);
  for (const selector of ["#deliverables", ".deliverables-section", ".deliverable-card", ".deliverable-grid", ".research-scope-section", ".research-scope-grid"]) {
    await expect(page.locator(selector), selector).toHaveCount(0);
  }
  await expect(page.locator("main h2", { hasText: "What Item Assist Provides" })).toHaveCount(1);

  const section = page.locator("#provides");
  await expect(section.locator("h2")).toHaveText("What Item Assist Provides");
  await expect(section.locator(".trust-header p")).toHaveText(
    "Consistent replacement comparisons and reliable pricing documentation, so you have more time for the rest of the claim."
  );
});

test("the six service-benefit cards carry the specified headings and copy in a compact grid", async ({ page }) => {
  await page.goto("/");
  const cards = page.locator("#provides .provides-card");
  await expect(cards).toHaveCount(6);
  await expect(cards.locator("h3")).toHaveText([
    "Less Time on Manual Research",
    "Original Item Identification",
    "Supportable Replacement Comparisons",
    "Documented Retail Pricing",
    "Consistent Comparison Reasoning",
    "Organized Research Reports"
  ]);
  await expect(cards.locator("p")).toHaveText([
    "Delegate time-consuming identification and pricing research across individual items or larger contents lists.",
    "Research the brand, model, available age evidence, and specifications that influence replacement value.",
    "Evaluate current models based on relevant product features, performance class, and original market tier.",
    "Capture relevant retailer prices, supporting sources, and research dates where available.",
    "Document material matches, differences, assumptions, and evidence gaps using a structured approach.",
    "Receive clear findings in a consolidated report, with spreadsheet output when appropriate."
  ]);
  // No decorative icons, and compact: each card is short.
  await expect(page.locator("#provides svg, #provides .ia-icon")).toHaveCount(0);
  for (const card of await cards.all()) expect((await card.boundingBox()).height).toBeLessThan(170);
});

test("the supporting range note is compact and names no category catalog or universal coverage", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#provides .provides-range-note")).toContainText("From difficult individual items to extensive contents inventories");
  await expect(page.locator("#provides .provides-range-note")).toContainText("Unusual or specialty items can be discussed during scope review.");
  await expect(page.locator("#provides li")).toHaveCount(6);
  await expect(page.locator("#provides")).not.toContainText(/\bevery\b|any (type|kind)|all (types|kinds)/i);
  await expect(page.locator("#provides .btn-primary")).toHaveCount(0);
});

test("the Ways to Work With Item Assist section is gone, with no service or pricing cards left on the homepage", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Ways to Work With Item Assist" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Why Item Age Matters" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Clear Service Boundaries" })).toHaveCount(0);
  for (const selector of ["#pricing", ".pricing-section", ".offer-grid", ".offer-card", ".offer-kind", ".pricing-expectations", ".pricing-reference", ".age-value-callout", ".scope-boundary", ".btn-tier"]) {
    await expect(page.locator(selector), selector).toHaveCount(0);
  }
  // No introductory-rate note, and no service or pricing cards, remain anywhere on the homepage.
  await expect(page.locator("main")).not.toContainText(/\$25|\$75|introductory starting rates/);
  await expect(page.locator("main")).not.toContainText(/Free Initial Consultation|Ongoing Research Support/);

  await expect(page.locator("#contact #consultation-form")).toHaveCount(1);
});

test("the homepage sections run in the new order, and the form is part of the hero rather than a late section", async ({ page }) => {
  await page.goto("/");
  const order = await page.evaluate(() =>
    Array.from(document.querySelectorAll("main > section"))
      .map((section) => section.querySelector("h2")?.textContent.trim())
      .filter(Boolean)
  );
  expect(order).toEqual([
    "Request Research or a Free Consultation",
    "Similar Isn\u2019t the Same as Comparable",
    "Small Pricing Differences Can Add Up Across an Entire Claim",
    "What Item Assist Provides",
    "Built From Hands-On Claims Experience",
    "How It Works"
  ]);
  await expect(page.locator("#experience")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Built From Hands-On Claims Experience" })).toHaveCount(1);
  await expect(page.locator("main > section.cta-section")).toHaveCount(0);
  // The page ends with the process and a closing pointer back to the form.
  const last = await page.evaluate(() => document.querySelector("main").lastElementChild.id);
  expect(last).toBe("how");
  await expect(page.locator("#how .closing-cta a")).toHaveAttribute("href", "#consultation");
});

test("section spacing is even: no large gap or overlap between the sections below the hero", async ({ page }) => {
  await page.goto("/");
  const gaps = await page.evaluate(() => {
    const ids = ["top", "comparable", "impact", "provides", "experience", "how"];
    const rects = ids.map((id) => document.getElementById(id).getBoundingClientRect());
    return rects.slice(1).map((rect, i) => ({ from: ids[i], to: ids[i + 1], gap: rect.top - rects[i].bottom }));
  });
  for (const { from, to, gap } of gaps) {
    expect(gap, from + " to " + to + " does not overlap").toBeGreaterThanOrEqual(0);
    expect(gap, from + " to " + to + " is not an oversized gap").toBeLessThanOrEqual(140);
  }
});

test("the page is much shorter than before and has no large unused blank areas", async ({ page }, testInfo) => {
  await page.goto("/");
  const { height, width } = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, width: window.innerWidth }));
  // The previous homepage ran well past 7,000px at desktop width.
  if (width >= 1024) expect(height).toBeLessThan(4600);
  const blank = await page.evaluate(() => {
    const secs = Array.from(document.querySelectorAll("main > section"));
    return secs.map((s) => ({ id: s.id, h: s.getBoundingClientRect().height, visible: s.innerText.trim().length }));
  });
  for (const s of blank) expect(s.visible, s.id).toBeGreaterThan(40);
});

test("the credibility section states the experience and the service boundary, and claims nothing unverified", async ({ page }) => {
  await page.goto("/");
  const section = page.locator("#experience");
  await expect(section).toContainText("more than 12 years of experience with property claims, product research, pricing evaluation, and contents replacement comparisons");
  await expect(section).toContainText("Coverage, depreciation, settlement, and claim-handling decisions remain with the client.");
  await expect(section.locator(".credibility-areas li")).toHaveText(["Property claims", "Product research", "Pricing evaluation", "Replacement comparisons"]);
  // No founder biography, headshot or individual credentials.
  await expect(section.locator("img")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(/\bfounder\b/i);

  const bodyText = await page.evaluate(() => document.querySelector("main").textContent);
  for (const pattern of [/\blicen[sc]ed\b/i, /\bcertified\b/i, /\baccredited\b/i, /\bcertifications?\b/i, /\bcredentialed\b/i, /\bendorsed?\b/i, /\bguarantee[sd]?\b/i, /\bour team\b/i, /\bcarrier partner/i, /\bsavings?\b/i]) {
    expect(bodyText, String(pattern)).not.toMatch(pattern);
  }
});

test("the homepage has one inquiry form, and the separate assignment form and its intro are gone", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("form")).toHaveCount(1);
  await expect(page.locator("#consultation-form")).toHaveCount(1);
  for (const selector of ["#contact-form", "#attachments", "#assignment-notes", "#client-reference", ".assignment-lead", "input[type=file]"]) {
    await expect(page.locator(selector), selector).toHaveCount(0);
  }
  await expect(page.getByText("Ready to Submit an Assignment?")).toHaveCount(0);
  await expect(page.getByText("Submit Contents List")).toHaveCount(0);
});

test("the unified form shows the specified heading, intro, fields, request types, button and commitment", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#consultation-heading")).toHaveText("Request Research or a Free Consultation");
  await expect(page.locator(".hero-consult-intro")).toHaveText(
    "Tell us a little about what you need. Whether you’re exploring our services or ready to submit a research assignment, we’ll review your request and follow up about next steps."
  );
  const form = page.locator("#consultation-form");
  for (const id of ["name", "email", "reason", "description"]) {
    await expect(form.locator("#consult-" + id)).toHaveAttribute("required", "");
    await expect(form.locator("#consult-" + id)).toHaveAttribute("aria-required", "true");
  }
  for (const id of ["company", "phone", "count"]) {
    await expect(form.locator("#consult-" + id)).not.toHaveAttribute("required", "");
  }
  await expect(form.getByLabel("Request type")).toBeVisible();
  const options = await form.locator("#consult-reason option").evaluateAll((nodes) => nodes.map((n) => [n.value, n.textContent.trim()]));
  expect(options).toEqual([
    ["", "Choose one…"],
    ["consultation", "Free consultation"],
    ["research_request", "Research request / assignment"],
    ["exploring", "Exploring options"]
  ]);
  await expect(form.locator(".form-submit")).toHaveText("Send My Request →");
  await expect(form.locator(".form-commitment")).toHaveText("No commitment required. Scope, turnaround, and pricing are confirmed before paid work begins.");
  // Nothing beyond the inquiry is asked for at this stage.
  await expect(form.locator("input[type=file], input[name*=claim], input[name*=policy], input[name*=payment], input[name*=card]")).toHaveCount(0);
});

test("the nav and closing consultation CTAs go to the form", async ({ page }, testInfo) => {
  for (const trigger of ["nav", "closing"]) {
    await page.goto("/");
    if (trigger === "closing") {
      await page.locator("#how .closing-cta a").scrollIntoViewIfNeeded();
      await page.locator("#how .closing-cta a").click();
    } else if (isMobile(testInfo)) {
      await page.locator(".nav-toggle").click();
      await page.locator(".nav-mobile-cta .nav-cta").click();
    } else {
      await page.locator(".nav-actions .nav-cta").click();
    }
    await expect(page).toHaveURL(/#consultation$/);
    await expect(page.locator("#consultation-form")).toBeInViewport();
    await expect(page.locator("#consultation-heading")).toBeFocused();
  }
});

test("existing nav anchors and the sample-report link still resolve", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#how")).toBeAttached();
  await expect(page.locator("#contact")).toBeAttached();
  await expect(page.locator(".nav-cta")).toHaveText(["Request a Free Consultation", "Request a Free Consultation"]);
  await expect(page.locator('.nav-links a[href="https://itemassist.com/#contact"]')).toHaveText("Contact");
  // "Pricing" no longer has a homepage section; it leads to the pricing tiers on the Services page.
  await expect(page.locator('.nav-links a[href="https://itemassist.com/services#svc-pricing-tiers"]')).toHaveText("Pricing");
  await expect(page.locator('a[href$="/#pricing"]')).toHaveCount(0);
});

test("how it works keeps four short, connected, numbered steps", async ({ page }, testInfo) => {
  await page.goto("/");
  const section = page.locator("#how");
  await expect(section.locator(".how-card h3")).toHaveText([
    "Tell Us What You Need",
    "We Review the Scope",
    "Research & Comparison",
    "Receive Your Findings"
  ]);
  await expect(section.locator(".how-card p")).toHaveText([
    "Send a short description of your items or research needs. No claim details are required to get started.",
    "We confirm the assignment, turnaround, and pricing before any paid research begins.",
    "We identify products, evaluate replacements, and document specifications and pricing evidence.",
    "Organized research and comparison notes, ready for your claims workflow."
  ]);
  await expect(section.locator(".how-num")).toHaveText(["1", "2", "3", "4"]);
  await expect(section.locator(".how-line")).toHaveCount(3);
  await expect(section.locator(".how-card svg, .how-card .ia-icon")).toHaveCount(0);
  await expect(section).toContainText("Scope, timing, and price are confirmed with you before work begins.");
  await expect(section.locator(".turnaround-note")).toContainText("24\u201348 business hours");
  for (const text of await section.locator(".how-card p").allTextContents()) expect(text.length).toBeLessThan(120);

  const boxes = await section.locator(".how-step").evaluateAll((nodes) => nodes.map((n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y }; }));
  const width = testInfo.project.use.viewport.width;
  if (width <= 900) {
    for (let i = 1; i < boxes.length; i += 1) expect(boxes[i].y).toBeGreaterThan(boxes[i - 1].y);
    expect(new Set(boxes.map((b) => Math.round(b.x))).size).toBe(1);
  } else {
    for (let i = 1; i < boxes.length; i += 1) {
      expect(Math.abs(boxes[i].y - boxes[0].y)).toBeLessThan(2);
      expect(boxes[i].x).toBeGreaterThan(boxes[i - 1].x);
    }
  }
});

test("layout holds: no horizontal overflow, the form is usable in place, nothing spills", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  for (const field of ["#consult-name", "#consult-email", "#consult-reason", "#consult-count", "#consult-description"]) {
    await expect(page.locator(field)).toBeVisible();
  }
  for (const card of await page.locator(".mini-report, .showcase, .impact-card, .provides-card, .hero-consult").all()) {
    const box = await card.boundingBox();
    expect(box.x, testInfo.project.name).toBeGreaterThanOrEqual(-0.5);
    expect(box.x + box.width, testInfo.project.name).toBeLessThanOrEqual(testInfo.project.use.viewport.width + 0.5);
  }
  expect(errors).toEqual([]);
});
