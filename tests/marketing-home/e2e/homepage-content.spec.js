const { test, expect, stubSite, horizontalOverflow } = require("./helpers.js");

const isMobile = (testInfo) => testInfo.project.use.viewport.width <= 900;

test.beforeEach(async ({ page }) => {
  await stubSite(page);
});

test("hero carries the new positioning, CTAs and trust markers, and no pricing offer", async ({ page }) => {
  await page.goto("/");
  const text = page.locator(".home-hero-text");

  await expect(text.locator(".home-hero-kicker")).toHaveText(/contents research support for insurance professionals/i);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveText("Spend Less Time Researching Contents. More Time Managing Claims.");
  await expect(text.locator(".home-hero-sub").nth(0)).toHaveText(
    "Item Assist provides professionally reviewed product identification, comparable replacement research, and documented retail pricing for independent adjusters, public adjusters, and claims professionals."
  );
  await expect(text.locator(".home-hero-sub").nth(1)).toHaveText(
    "From difficult individual items to extensive contents inventories, we help turn time-consuming research into consistent, organized and defensible replacement comparisons."
  );

  await expect(text.locator(".btn-primary")).toHaveText("Request a Free Consultation");
  await expect(text.locator(".btn-primary")).toHaveAttribute("href", "#consultation");
  await expect(text.locator(".btn-secondary")).toHaveText("View a Sample Report");
  await expect(text.locator(".btn-secondary")).toHaveAttribute("href", "/report");

  const markers = text.locator(".home-hero-trust-num");
  await expect(markers).toHaveText(["Human-reviewed research", "Documented retail sources", "Clear replacement reasoning"]);

  await expect(text.locator(".home-hero-price, .intro-offer-badge")).toHaveCount(0);
  await expect(text).not.toContainText("$");
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

test("the similar-versus-comparable section shows three labelled examples without invented figures", async ({ page }) => {
  await page.goto("/");
  const section = page.locator("#comparable");
  await expect(section.locator(".comparable-card")).toHaveCount(3);
  await expect(section.locator(".comparable-card h3")).toHaveText(["Refrigerators", "Televisions", "Home electronics: AV receivers"]);
  await expect(section.locator(".comparable-tag")).toHaveCount(3);
  for (const tag of await section.locator(".comparable-tag").allTextContents()) expect(tag).toMatch(/illustrative example/i);

  const fridge = section.locator(".comparable-card").nth(0);
  await expect(fridge.locator(".comparable-price")).toHaveText(["$1,699.99", "$1,799.99", "$2,299.99"]);
  await expect(fridge.locator(".comparable-tag")).toContainText("August 13, 2026");
  await expect(fridge.locator(".comparable-link")).toHaveAttribute("href", "/what-does-lkq-mean-contents-claims");

  for (const index of [1, 2]) {
    const card = section.locator(".comparable-card").nth(index);
    await expect(card.locator(".comparable-tag")).toContainText("no prices shown");
    await expect(card).not.toContainText("$");
  }
  await expect(section.locator(".comparable-card").nth(2).locator(".comparable-link")).toHaveAttribute("href", "/discontinued-av-receiver-replacement-research");
  await expect(section).not.toContainText(/%|\bsav(e|ed|ings?)\b/i);
  await expect(section.locator(".comparable-note")).toContainText("not determinations about any actual claim");
});

test("the section after it names both ways a poor comparison goes wrong", async ({ page }) => {
  await page.goto("/");
  const section = page.locator(".pricing-risk-section");
  await expect(section.locator(".outcome-card h3")).toHaveText(["A Figure Higher Than the Original Warrants", "A Lower-Priced Item That Isn’t Truly Comparable"]);
  await expect(section).toContainText("unnecessarily high");
  await expect(section).toContainText("inadequately comparable");
});

test("deliverables list the seven parts of a completed assignment and point to the sample", async ({ page }) => {
  await page.goto("/");
  const section = page.locator("#deliverables");
  await expect(section.locator(".deliverable-card:not(.deliverable-card--cta) h3")).toHaveText([
    "Original item identification and available age evidence",
    "Important original specifications",
    "Current comparable replacement model",
    "Dated retail price and supporting source",
    "Explanation of material matches and differences",
    "Confidence qualifications and unresolved information",
    "Consolidated PDF report, with Excel when appropriate"
  ]);
  await expect(section.locator(".deliverable-sample")).toHaveCount(7);
  await expect(section.locator(".deliverable-card--cta a")).toHaveAttribute("href", "/report");
  await expect(section).toContainText("labels the result as an estimate");
  await expect(page.locator("#sample-report")).toBeAttached();
  await expect(page.locator(".deliverables-panel")).toHaveCount(0);
});

test("service offerings replace the purchase emphasis, keep introductory rates as reference, and state that terms are confirmed first", async ({ page }) => {
  await page.goto("/");
  const section = page.locator("#pricing");
  await expect(section.locator(".offer-card h3")).toHaveText([
    "Free Initial Consultation",
    "Contents Research & Pricing",
    "Individual Item Research",
    "Ongoing Research Support"
  ]);
  await expect(section.locator(".offer-card").nth(0)).toContainText("Discuss your scope, research needs, and pricing. No commitment.");
  await expect(section.locator(".offer-card").nth(1)).toContainText("Quoted based on item count, complexity, and deliverable requirements.");
  await expect(section.locator(".offer-card").nth(2)).toContainText("available for difficult or disputed product comparisons.");
  await expect(section.locator(".offer-card").nth(3)).toContainText("Available for recurring professional assignments.");
  await expect(section.locator(".pricing-expectations")).toContainText("Scope, turnaround, and price are confirmed before work begins.");
  await expect(section.locator(".pricing-reference")).toContainText("$25");
  await expect(section.locator(".pricing-reference")).toContainText("$75");
  await expect(section.locator(".pricing-reference")).toContainText("not quotes");
  await expect(section.locator(".consultation-pricing-card, .launch-pricing-card")).toHaveCount(0);
  await expect(section.locator(".scope-boundary")).toContainText("All coverage, depreciation, settlement, and claim-handling decisions remain with the client.");
});

test("the credibility section states the experience and the service boundary, and claims nothing unverified", async ({ page }) => {
  await page.goto("/");
  const section = page.locator("#experience");
  await expect(section).toContainText("more than 12 years of experience with property claims, product research, pricing evaluation, and contents replacement comparisons");
  await expect(section).toContainText("specialized, independent research service");
  await expect(section).toContainText("Coverage, depreciation, settlement, and claim-handling decisions remain with the client.");

  // Outside the clearly fictional sample report, the page makes no credential, endorsement or outcome claims.
  const bodyText = await page.evaluate(() => {
    const clone = document.querySelector("main").cloneNode(true);
    clone.querySelector("#sample-report")?.remove();
    return clone.textContent;
  });
  for (const pattern of [/\blicen[sc]ed\b/i, /\bcertified\b/i, /\baccredited\b/i, /\bcertifications?\b/i, /\bcredentialed\b/i, /\bendorsed?\b/i, /\bguarantee[sd]?\b/i, /\bour team\b/i, /\bcarrier partner/i, /\bsavings?\b/i]) {
    expect(bodyText, String(pattern)).not.toMatch(pattern);
  }
});

test("the detailed assignment form is still on the page as the secondary action", async ({ page }) => {
  await page.goto("/");
  const card = page.locator("#submit-assignment");
  await expect(card.locator("#contact-form")).toBeAttached();
  for (const selector of ["#contact-name", "#email", "#assignment-notes", "#attachments", "#output-format", "#turnaround"]) {
    await expect(card.locator(selector)).toBeAttached();
  }
  await expect(page.locator(".assignment-lead h2")).toHaveText("Ready to Submit an Assignment?");
  // Consultation comes first.
  const order = await page.evaluate(() => document.getElementById("consultation").compareDocumentPosition(document.getElementById("submit-assignment")));
  expect(order & 4, "DOCUMENT_POSITION_FOLLOWING").toBeTruthy();
});

test("the nav and hero consultation CTAs go to the form", async ({ page }, testInfo) => {
  for (const trigger of ["hero", "nav"]) {
    await page.goto("/");
    if (trigger === "hero") {
      await page.locator(".home-hero-text .btn-primary").click();
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
  await expect(page.locator("#pricing")).toBeAttached();
  await expect(page.locator("#contact")).toBeAttached();
  await expect(page.locator(".nav-cta")).toHaveText(["Request a Free Consultation", "Request a Free Consultation"]);
  await expect(page.locator('.nav-links a[href="https://itemassist.com/#contact"]')).toHaveText("Contact");
});

test("layout holds: no horizontal overflow, form and offers visible", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  await expect(page.locator(".home-hero-text .btn-primary")).toBeVisible();
  await page.locator("#consultation").scrollIntoViewIfNeeded();
  for (const field of ["#consult-name", "#consult-email", "#consult-reason", "#consult-count", "#consult-description"]) {
    await expect(page.locator(field)).toBeVisible();
  }
  await page.locator("#pricing .offer-grid").scrollIntoViewIfNeeded();
  await expect(page.locator(".offer-card")).toHaveCount(4);
  for (const card of await page.locator(".comparable-card, .deliverable-card, .offer-card").all()) {
    const box = await card.boundingBox();
    expect(box.x, testInfo.project.name).toBeGreaterThanOrEqual(-0.5);
    expect(box.x + box.width, testInfo.project.name).toBeLessThanOrEqual(testInfo.project.use.viewport.width + 0.5);
  }
  expect(errors).toEqual([]);
});
