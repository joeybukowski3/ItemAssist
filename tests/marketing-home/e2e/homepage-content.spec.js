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

test("the similar-versus-comparable section shows exactly two examples, refrigerators and televisions", async ({ page }) => {
  await page.goto("/");
  const section = page.locator("#comparable");
  await expect(section.locator(".comparable-card")).toHaveCount(2);
  await expect(section.locator(".comparable-card h3")).toHaveText(["Refrigerators", "Televisions"]);
  await expect(section.locator(".comparable-tag")).toHaveCount(2);
  for (const tag of await section.locator(".comparable-tag").allTextContents()) expect(tag).toMatch(/illustrative example/i);
  // The AV receiver comparison is gone from this section.
  await expect(section).not.toContainText(/receiver/i);
  await expect(section.locator('a[href="/discontinued-av-receiver-replacement-research"]')).toHaveCount(0);
  for (const card of await section.locator(".comparable-card").all()) {
    await expect(card.locator(".comparable-ladder > li")).toHaveCount(3);
    await expect(card.locator(".comparable-ladder-mid")).toHaveCount(1);
    await expect(card.locator(".comparable-alt")).toHaveCount(2);
    await expect(card.locator(".comparable-differences")).toContainText("What separates them");
    await expect(card.locator(".comparable-evidence")).toHaveCount(1);
    await expect(card.locator(".comparable-disclosure")).toHaveCount(1);
  }
  await expect(section).not.toContainText(/%|\bsav(e|ed|ings?)\b/i);
  await expect(section.locator(".comparable-note")).toContainText("not determinations about any actual claim");
});

test("the refrigerator example keeps its dated retail evidence and names the original it assumes", async ({ page }) => {
  await page.goto("/");
  const fridge = page.locator("#comparable .comparable-card").nth(0);
  await expect(fridge.locator(".comparable-tag")).toContainText("retail prices referenced August 13, 2026");
  await expect(fridge.locator(".comparable-role")).toHaveText(["Lower-priced alternative", "Selected comparison example", "Higher-priced alternative"]);
  await expect(fridge.locator(".comparable-model")).toHaveText(["Samsung RF32CG5100SR/AA", "Samsung RF32CG5300SR", "Samsung Bespoke RF29BB8600QL"]);
  await expect(fridge.locator(".comparable-price")).toHaveText(["$1,699.99", "$1,799.99", "$2,299.99"]);
  await expect(fridge.locator(".comparable-spec")).toHaveText([
    "3-door, dual ice, smart · Best Buy",
    "Adds a beverage center · Lowe’s",
    "4-door, FlexZone, Bespoke tier · Lowe’s"
  ]);
  await expect(fridge.locator(".comparable-ladder-mid .comparable-model")).toHaveText("Samsung RF32CG5300SR");
  await expect(fridge.locator(".comparable-ladder-mid .comparable-price")).toHaveText("$1,799.99");
  await expect(fridge.locator(".comparable-disclosure")).toContainText("Documented prices from the retailers shown, referenced August 13, 2026");
  await expect(fridge.locator(".comparable-link")).toHaveAttribute("href", "/what-does-lkq-mean-contents-claims");
  // It is not presented as universally correct: the original it assumes is stated, and the pick is tied to it.
  await expect(fridge.locator(".comparable-lede")).toContainText("assumes an original French-door refrigerator with dual ice and a beverage center");
  await expect(fridge.locator(".comparable-evidence")).toContainText("supportable only against the original item described above");
  await expect(fridge).not.toContainText(/universal|always the right|best choice/i);
});

test("the television example is labelled hypothetical, invents nothing, and does not call the midrange tier correct", async ({ page }) => {
  await page.goto("/");
  const tv = page.locator("#comparable .comparable-card").nth(1);
  await expect(tv.locator(".comparable-tag")).toContainText("hypothetical prices, not verified");
  await expect(tv.locator(".comparable-role")).toHaveText(["Lower alternative", "Selected midrange comparison example", "Higher alternative"]);
  await expect(tv.locator(".comparable-model")).toHaveText(["55-inch entry LED/LCD", "55-inch QLED / Mini-LED", "55-inch premium OLED"]);
  const prices = await tv.locator(".comparable-price").evaluateAll((nodes) => nodes.map((n) => n.firstChild.textContent.trim()));
  expect(prices).toEqual(["$249", "$699", "$1,499"]);
  await expect(tv.locator(".comparable-price-flag")).toHaveText(["illustrative", "illustrative", "illustrative"]);
  await expect(tv.locator(".comparable-ladder-mid .comparable-model")).toHaveText("55-inch QLED / Mini-LED");
  await expect(tv.locator(".comparable-disclosure")).toContainText("Hypothetical educational figures, not observed retailer prices");
  await expect(tv.locator(".comparable-disclosure")).toContainText("name no product, SKU, seller, date, or link");
  await expect(tv.locator(".comparable-differences")).toContainText("panel technology, brightness, processing, refresh rate, original tier");
  await expect(tv.locator(".comparable-evidence")).toContainText("not presumed correct");
  await expect(tv.locator(".comparable-evidence")).toContainText("original TV’s specifications and product tier");
  // No retailer, SKU, date or link on the television card, and it never claims "most supportable".
  await expect(tv).not.toContainText(/most supportable|best buy|lowe’s|amazon|walmart|costco|home depot|20\d\d/i);
  await expect(tv.locator("a")).toHaveCount(0);
  await expect(page.locator("#comparable .comparable-note")).toContainText("television figures are hypothetical");
  await expect(page.locator("#comparable .comparable-note")).toContainText("not verified retail observations");
});

test("the selected comparison dominates: larger and higher in the hierarchy than the lower and higher alternatives", async ({ page }) => {
  await page.goto("/");
  for (const index of [0, 1]) {
    const card = page.locator("#comparable .comparable-card").nth(index);
    const metrics = await card.evaluate((el) => {
      const px = (node, prop) => parseFloat(getComputedStyle(node)[prop]);
      const box = (node) => node.getBoundingClientRect();
      const focus = el.querySelector(".comparable-ladder-mid");
      const alts = Array.from(el.querySelectorAll(".comparable-alt"));
      return {
        focusPrice: px(focus.querySelector(".comparable-price"), "fontSize"),
        altPrices: alts.map((alt) => px(alt.querySelector(".comparable-price"), "fontSize")),
        focusHeight: box(focus).height,
        altHeights: alts.map((alt) => box(alt).height),
        order: [box(alts[0]).top, box(focus).top, box(alts[1]).top],
        focusBorder: px(focus, "borderTopWidth")
      };
    });
    for (const altPrice of metrics.altPrices) expect(metrics.focusPrice, "central price is at least twice the alternatives'").toBeGreaterThanOrEqual(altPrice * 2);
    // On narrow screens the alternatives wrap, so only require the selected block to be the tallest.
    for (const altHeight of metrics.altHeights) expect(metrics.focusHeight).toBeGreaterThan(altHeight);
    // Lower alternative above, selected comparison in the middle, higher alternative below.
    expect(metrics.order[0]).toBeLessThan(metrics.order[1]);
    expect(metrics.order[1]).toBeLessThan(metrics.order[2]);
    expect(metrics.focusBorder).toBeGreaterThanOrEqual(2);
  }
});

test("the section after it names both ways a poor comparison goes wrong", async ({ page }) => {
  await page.goto("/");
  const section = page.locator(".pricing-risk-section");
  await expect(section.locator(".outcome-card h3")).toHaveText(["A Figure Higher Than the Original Warrants", "A Lower-Priced Item That Isn’t Truly Comparable"]);
  await expect(section).toContainText("unnecessarily high");
  await expect(section).toContainText("inadequately comparable");
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
    "Practical contents research support for insurance professionals who need consistent replacement comparisons, reliable pricing documentation, and more time to focus on the rest of the claim."
  );
});

test("the six service-benefit cards carry the specified headings and copy, with one line icon each", async ({ page }) => {
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
  for (const card of await cards.all()) {
    await expect(card.locator('.ia-icon svg[aria-hidden="true"]')).toHaveCount(1);
  }
});

test("the supporting range section is compact, names no category catalog, and keeps a visible sample-report CTA", async ({ page }) => {
  await page.goto("/");
  const range = page.locator("#provides .provides-range");
  await expect(range.locator("h3")).toHaveText("From Difficult Individual Items to Extensive Contents Inventories");
  await expect(range.locator("p")).toHaveText(
    "Item Assist supports electronics, appliances, furniture, tools, equipment, and other standard household contents when sufficient product information is available. Unusual or specialty items can be discussed during scope review."
  );
  const cta = range.locator("a");
  await expect(cta).toHaveText("View a Sample Research Report");
  await expect(cta).toHaveAttribute("href", "/report");
  await expect(cta).toHaveClass(/btn-primary/);
  await expect(cta).toBeVisible();
  // Only the six benefit cards: no eight-card category grid and no promise to cover every property type.
  await expect(page.locator("#provides li")).toHaveCount(6);
  await expect(page.locator("#provides")).not.toContainText(/\bevery\b|any (type|kind)|all (types|kinds)/i);
  await expect(page.locator("#sample-report")).toBeAttached();
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
  await expect(page.locator(".consult-card .cta-info > p").first()).toHaveText(
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
    "Send a short description of your items or research needs. Detailed claim information isn’t required to get started.",
    "We discuss the assignment, available information, turnaround, and pricing before any paid research begins.",
    "We identify products, evaluate replacement candidates, and document relevant specifications and pricing evidence.",
    "Receive organized research and supporting comparison notes for review and use in your claims workflow."
  ]);
  await expect(section.locator(".how-num")).toHaveText(["1", "2", "3", "4"]);
  await expect(section.locator(".how-card .ia-icon svg")).toHaveCount(4);
  await expect(section.locator(".how-line")).toHaveCount(3);
  await expect(section).toContainText("Scope, timing, and price are confirmed with you before work begins.");
  await expect(section.locator(".turnaround-note")).toContainText("24–48 business hours");
  // Short enough to scan: no step runs past a couple of sentences.
  for (const text of await section.locator(".how-card p").allTextContents()) expect(text.length).toBeLessThan(160);

  const boxes = await section.locator(".how-step").evaluateAll((nodes) =>
    nodes.map((n) => {
      const r = n.getBoundingClientRect();
      return { x: r.x, y: r.y };
    })
  );
  const width = testInfo.project.use.viewport.width;
  if (width <= 900) {
    // Stacked: one column, each step below the previous one.
    for (let i = 1; i < boxes.length; i += 1) expect(boxes[i].y).toBeGreaterThan(boxes[i - 1].y);
    expect(new Set(boxes.map((b) => Math.round(b.x))).size).toBe(1);
  } else {
    // Side by side on one row, in order.
    for (let i = 1; i < boxes.length; i += 1) {
      expect(Math.abs(boxes[i].y - boxes[0].y)).toBeLessThan(2);
      expect(boxes[i].x).toBeGreaterThan(boxes[i - 1].x);
    }
  }
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
  for (const card of await page.locator(".comparable-card, .provides-card, .offer-card").all()) {
    const box = await card.boundingBox();
    expect(box.x, testInfo.project.name).toBeGreaterThanOrEqual(-0.5);
    expect(box.x + box.width, testInfo.project.name).toBeLessThanOrEqual(testInfo.project.use.viewport.width + 0.5);
  }
  expect(errors).toEqual([]);
});
