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
  expect(scripts.filter((s) => s === "sample-preview.js")).toHaveLength(1);
  await expect(page.locator("[data-turnstile-container]")).toHaveCount(1);
});

test("below the hero, one report-window sample preview carries the three researched examples, with no tab showcase", async ({ page }) => {
  await page.goto("/");
  const section = page.locator("#comparable");
  await expect(section.locator("h2")).toHaveText("Similar Isn’t the Same as Comparable");
  const preview = section.locator("article.sample-preview#sample");
  await expect(preview).toHaveCount(1);
  // The earlier report-window structure: titlebar, branded header, claim bar, overview sidebar, summary tiles, item table.
  await expect(preview.locator(".titlebar .dot")).toHaveCount(3);
  await expect(preview.locator(".report-branded-header .rbh-logo")).toHaveAttribute("alt", "Item Assist logo");
  await expect(preview.locator(".rbh-title")).toHaveText("Sample Research Report");
  await expect(preview.locator(".rbh-date")).toHaveText("Prices observed November 9, 2026");
  await expect(preview.locator(".report-claim-bar")).toContainText("Not a claim determination");
  await expect(preview.locator(".sidebar .sb-item")).toHaveText(["Summary Findings", "Itemized Research", "Supporting Evidence"]);
  await expect(preview.locator(".stats .stat")).toHaveCount(2);
  await expect(preview.locator(".tbl thead th")).toHaveText(["Submitted Item", "Selected Research Comparison", "Age Research", "Documented Market Price"]);
  await expect(preview.locator(".tbl tbody tr:not(.detail-row)")).toHaveCount(3);
  // The sidebar stays concise: no ACV box, nothing that repeats the summary figures.
  await expect(preview.locator(".sb-metric-label")).toHaveText(["Items Researched", "Prices Observed"]);
  await expect(preview.locator(".sidebar")).not.toContainText(/ACV|\$\d/);
  // The default report carries no promotional labels; the qualification lives in the expanded notes and the source note.
  const visible = (await preview.locator(".report-claim-bar, .stats, .tbl tbody tr:not(.detail-row)").allTextContents()).join(" ");
  expect(visible).not.toMatch(/Black Friday|Holiday Deal|Sale[- ]event|list price|Average Market Price/i);
  // The tabbed showcase, the miniature report and the older compact card are gone.
  await expect(page.locator('[role="tablist"], [role="tab"], .showcase, .mini-report, .sc-toggle, .hero-finding, #research-showcase, #sample-report')).toHaveCount(0);
  // The retired fictional report does not come back.
  const text = (await preview.textContent()).replace(/\s+/g, " ");
  expect(text).not.toMatch(/fictional|IA-DEMO|\b22\b|95%|High Confidence|Average Documented Age|17,022|34,152|Published|KitchenAid|OLED65|\$2,699|receiver/i);
  expect(text).not.toMatch(/comparable value|\bwas \$|\bsave \$|\bsavings?\b|most supportable|universal/i);
});

test("the report rows carry the real TV, refrigerator and dryer findings, prices, dates and limits", async ({ page }) => {
  await page.goto("/");
  const rows = page.locator("#sample .tbl tbody tr:not(.detail-row)");
  await expect(rows.nth(0)).toContainText("QN55Q80AAFXZA");
  await expect(rows.nth(0)).toContainText("QN55QN80H");
  await expect(rows.nth(0)).toContainText("$899.99");
  await expect(rows.nth(0)).toContainText("Best Buy");
  await expect(rows.nth(0)).toContainText("Nov 9, 2026");
  await expect(rows.nth(1)).toContainText("RF28R7201SR (identical)");
  await expect(rows.nth(1)).toContainText("$1,899.99");
  await expect(rows.nth(1)).toContainText("Still sold new");
  await expect(rows.nth(2)).toContainText("GFD65ESSNWW");
  await expect(rows.nth(2)).toContainText("GFD65ESSVWW (successor)");
  await expect(rows.nth(2)).toContainText("$899.00");
  await expect(rows.nth(2)).toContainText("GE.com, Home Depot");
  await expect(page.locator("#sample .rcv-val")).toHaveText(["$899.99", "$1,899.99", "$899.00"]);

  // Aggregate summary: recomputed here from the row prices and the stated ACV inputs.
  const money = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const whole = (n) => "$" + Math.round(n).toLocaleString("en-US");
  const prices = (await page.locator("#sample .rcv-val").allTextContents()).map((t) => Number(t.replace(/[$,]/g, "")));
  const total = Math.round(prices.reduce((a, b) => a + b, 0) * 100) / 100;
  expect(total).toBe(3698.98);
  const observed = Date.UTC(2026, 10, 9);
  const ageAt = (year, month, endOfMonth) => (observed - (endOfMonth ? Date.UTC(year, month, 0) : Date.UTC(year, month - 1, 1))) / 86400000 / 365.25;
  const acv = (rcv, age) => rcv * (1 - age / 13);
  const fridgeAcv = Math.round((prices[1] - Math.round(prices[1] * (6 / 13) * 100) / 100) * 100) / 100;
  expect(fridgeAcv).toBe(1023.07);
  const dryerLow = acv(prices[2], ageAt(2019, 12, false));
  const dryerHigh = acv(prices[2], ageAt(2023, 8, true));
  const tiles = page.locator("#sample .stat");
  await expect(tiles.nth(0).locator(".stat-label")).toHaveText("Total Documented Replacement Value");
  await expect(tiles.nth(0).locator(".stat-val")).toHaveText(money(total));
  await expect(tiles.nth(0).locator(".stat-note")).toContainText("3 researched items");
  await expect(tiles.nth(1).locator(".stat-label")).toHaveText("Illustrative Partial ACV");
  await expect(tiles.nth(1).locator(".stat-val")).toHaveText(`${whole(fridgeAcv + dryerLow)} – ${whole(fridgeAcv + dryerHigh)}`);
  await expect(tiles.nth(1).locator(".stat-note")).toContainText("2 of 3 items");
  for (const needle of ["assumed refrigerator age", "illustrative straight-line depreciation", "no television ACV"]) await expect(tiles.nth(1).locator(".stat-note")).toContainText(needle);
  // The basis states every covered item, the method and the missing input.
  const basis = (await page.locator("#sample .acv-basis").textContent()).replace(/\s+/g, " ");
  for (const needle of ["Refrigerator $1,023.07 at an assumed 6.0-year age", `dryer ${whole(dryerLow)} – ${whole(dryerHigh)}`, "3.2 – 6.9 years", "13-year life (NAHB, 2007)", "no condition adjustment",
    "no supported television useful life exists", "not a verified claim valuation"]) {
    expect(basis, needle).toContain(needle);
  }

  // Reported and researched age are separate, labelled fields with a status the evidence supports.
  const ages = page.locator("#sample .tbl tbody tr:not(.detail-row) .age-pair");
  await expect(ages).toHaveCount(3);
  const pair = async (i) => ages.nth(i).evaluate((el) => Array.from(el.querySelectorAll(".age-item")).map((item) => Array.from(item.children).map((c) => c.textContent.replace(/\s+/g, " ").trim()).join(" ")));
  expect(await pair(0)).toEqual(["Reported 2021", "Researched 2021 model year"]);
  expect(await pair(1)).toEqual(["Reported Not provided", "Researched Not established"]);
  expect(await pair(2)).toEqual(["Reported 2025", "Researched Dec 2019 – Aug 2023 model production window"]);
  await expect(page.locator("#sample .tbl tbody tr:not(.detail-row) td[data-label='Age Research'] .badge")).toHaveText(["Model Year Confirmed", "Age Evidence Needed", "Reported Age Requires Review"]);
  await expect(page.locator("#sample .badge")).toHaveCount(3);
  await expect(page.locator("#sample")).not.toContainText(/Age Verified|Discrepancy|Verification Needed|false|misstat|inaccura/i);
  await expect(page.locator("#sample .age-item--res")).toHaveCount(3);

  // The documented detail behind each row (present in the page; shown on request).
  // Rows read as "label value"; the notes read as written.
  const detail = (id) =>
    page.locator(id).evaluate((el) =>
      Array.from(el.querySelectorAll(".match-row, .detail-note"))
        .map((node) => (node.matches(".match-row") ? Array.from(node.children).map((c) => c.textContent.trim()).join(" ") : node.textContent))
        .join(" ")
        .replace(/\s+/g, " ")
    );
  const tv = await detail("#sp-detail-tv");
  for (const needle of ["120Hz (RTINGS, third-party)", "One HDMI port", "144Hz", "All 4 ports", "FreeSync Premium Pro", "Documented Market Price $899.99", "Best Buy, Nov 9, 2026",
    "Price note Promotional price (Black Friday Deal). Samsung’s $1,299.99 list price is not used.",
    "Reported age 2021 (sample submission)", "Researched age 2021 model year", "Model year confirmed. The individual unit’s manufacture date has not been established.",
    "Samsung Q80A specification sheet (2021 edition)", "A model year is not a unit’s manufacture date", "ACV Not calculated: no supported television useful life",
    "The QN55QN70H ($699.99) falls short on native refresh rate, 4K@120Hz input and VRR", "The QN55S90H ($1,199.99) is OLED, a different product tier",
    "not presented as the lowest-priced suitable Samsung", "a 2025 QN80F at $827.95, seller not named, is unresolved"]) {
    expect(tv, needle).toContain(needle);
  }
  const fridge = await detail("#sp-detail-fridge");
  for (const needle of ["3.8 cu ft, 4 zones", "External water and ice", "28 cu ft", "RF32CG5B30SR ($1,799.99) has no FlexZone drawer", "RF29BB8600QL ($2,199.99) has no external dispenser",
    "Illustrative ACV $1,023.07", "$1,899.99 × (1 − 6.0 ÷ 13)", "an assumed age, a 13-year life (NAHB, 2007) and no condition adjustment",
    "Reported age Not provided", "Researched age Not established", "Status Age evidence needed. The original model was identified and researched, but no serial number or other sufficient unit-specific evidence was available to determine its manufacture date.", "Serial / date code Not provided. No serial analysis is shown or implied.",
    "Age used in the ACV 6.0 years, assumed for illustration only. It is not a research finding.", "Documented Market Price $1,899.99"]) {
    expect(fridge, needle).toContain(needle);
  }
  const dryer = await detail("#sp-detail-dryer");
  const age2025 = (await page.locator("#sp-detail-dryer .age-panel .mv").last().textContent()).replace(/\s+/g, " ");
  for (const needle of ["Reported age 2025 (sample submission)", "Researched age Dec 2019 – Aug 2023, the model’s production window", "Status Reported age requires review. GE’s production window closed before 2025, but 2025 could be a purchase or installation date rather than a manufacture date. No conclusion is drawn about the accuracy of the report.",
    "GE Owner Center: GFD65ESSNWW built December 2019 – August 2023", "2025 is the letter A", "Manufacturer evidence establishes the model’s production period", "other appropriate documentation such as a dated purchase or delivery record", "Serial number Not provided", "13 years (NAHB, 2007)",
    "101 of 108 identical", "None found", "$419 – $678", "Documented Market Price $899.00",
    "Price note Promotional price at both retailers. GE’s $1,249.00 list price is not used.", "not a single value; a nameplate serial would name one month"]) {
    expect(dryer, needle).toContain(needle);
  }
  // Treating the reported 2025 as a build year changes the illustrative ACV; the figures follow from the same inputs.
  const rOld = ageAt(2025, 1, false);
  const rYoung = ageAt(2025, 12, true);
  expect(age2025).toContain(`${rYoung.toFixed(1)} – ${rOld.toFixed(1)} years`);
  expect(age2025).toContain(`${whole(acv(prices[2], rOld))} – ${whole(acv(prices[2], rYoung))}`);
  expect(age2025).toContain("GE’s window supports $419 – $678");
  expect(age2025).toContain("Both are illustrative: $899.00, 13-year straight line, no condition adjustment.");
  await expect(page.locator("#sample .home-hero-report-note")).toContainText("Item Assist does not determine depreciation, final ACV, coverage or settlement.");
  await expect(page.locator("#sample .home-hero-report-note")).toContainText("not regular prices");
  await expect(page.locator("#sample .home-hero-report-note")).toContainText("Reported ages are sample submissions");
  await expect(page.locator("#sample .home-hero-report-note")).toContainText("have not been re-verified since");
});

test("the preview links to the full report cases, the sources and the PDF, and every report anchor exists", async ({ page, request }) => {
  await page.goto("/");
  const preview = page.locator("#sample");
  await expect(preview.locator('a[href="/report"]')).toHaveText("Read the full sample report");
  await expect(preview.locator('a[href="/assets/ItemAssist-Sample-Research-Report.pdf"]')).toHaveText("Download the 2-page PDF");
  const anchors = ["/report#case-tv", "/report#case-fridge", "/report#case-dryer", "/report#sources"];
  for (const href of anchors) await expect(preview.locator(`a[href="${href}"]`), href).toHaveCount(1);
  await expect(preview.locator('.sb-item[href="#sp-summary"], .sb-item[href="#sp-items"]')).toHaveCount(2);
  await expect(page.locator("#sp-summary")).toHaveCount(1);
  await expect(page.locator("#sp-items")).toHaveCount(1);
  const report = await (await request.get("/report")).text();
  for (const id of ["case-tv", "case-fridge", "case-dryer", "sources"]) expect(report, id).toContain(`id="${id}"`);
  // The hero's own link still lands on the preview.
  await expect(page.locator('.home-hero-text a[href="#sample"]')).toHaveCount(1);
});

test("specification rows stay collapsed, open independently by click and keyboard, and keep their state labelled", async ({ page }) => {
  await page.goto("/");
  const ids = ["sp-detail-tv", "sp-detail-fridge", "sp-detail-dryer"];
  const buttons = page.locator("#sample .item-link-btn");
  await expect(buttons).toHaveCount(3);
  for (const [i, id] of ids.entries()) {
    await expect(page.locator("#" + id), id + " collapsed").toBeHidden();
    await expect(buttons.nth(i)).toHaveAttribute("aria-controls", id);
    await expect(buttons.nth(i)).toHaveAttribute("aria-expanded", "false");
    await expect(buttons.nth(i)).toContainText("View Specs");
  }
  await buttons.nth(0).click();
  await expect(buttons.nth(0)).toHaveAttribute("aria-expanded", "true");
  await expect(buttons.nth(0)).toContainText("Hide Specs");
  await expect(page.locator("#sp-detail-tv")).toBeVisible();
  await expect(page.locator("#sp-detail-fridge")).toBeHidden();
  await expect(page.locator("#sp-detail-tv .match-grid .match-panel")).toHaveCount(2);
  await expect(page.locator("#sp-detail-tv .age-panel .match-panel-hdr")).toHaveText("Age Research");

  // Keyboard: focus the second button and press Enter, then Space on the third.
  await buttons.nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#sp-detail-fridge")).toBeVisible();
  await buttons.nth(2).focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#sp-detail-dryer")).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  await buttons.nth(0).click();
  await expect(page.locator("#sp-detail-tv")).toBeHidden();
  await expect(buttons.nth(0)).toHaveAttribute("aria-expanded", "false");
  await expect(buttons.nth(0)).toContainText("View Specs");
});

test("the report window keeps its layout: sidebar beside the table on wide screens, stacked on narrow ones, columns steady when a row opens", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; }" });
  const width = testInfo.project.use.viewport.width;
  const measure = () => page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
    const sidebar = rect("#sample .sidebar");
    const main = rect("#sample .main");
    const window_ = rect("#sample .window");
    const heads = Array.from(document.querySelectorAll("#sample .tbl thead th")).map((th) => Math.round(th.getBoundingClientRect().width));
    return { sidebar: { right: sidebar.right, bottom: sidebar.bottom }, main: { left: main.left, top: main.top }, window: { left: window_.left, right: window_.right }, heads };
  });
  const before = await measure();
  if (width > 820) {
    expect(before.sidebar.right).toBeLessThanOrEqual(before.main.left + 1);
  } else {
    expect(before.main.top).toBeGreaterThanOrEqual(before.sidebar.bottom - 1);
  }
  expect(before.window.left).toBeGreaterThanOrEqual(0);
  expect(before.window.right).toBeLessThanOrEqual(width + 0.5);
  await page.locator("#sample .item-link-btn").nth(0).click();
  const after = await measure();
  if (width > 640) expect(after.heads).toEqual(before.heads);
  // On narrow screens the table stacks into labelled blocks.
  if (width <= 640) {
    await expect(page.locator("#sample .tbl thead")).toBeHidden();
    const display = await page.locator("#sample .tbl tbody tr").first().evaluate((tr) => getComputedStyle(tr).display);
    expect(display).toBe("block");
  }
  for (const button of await page.locator("#sample .item-link-btn").all()) {
    if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  }
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  for (const panel of await page.locator("#sample .match-panel").all()) {
    const box = await panel.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(-0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
  }
});

test("without JavaScript every specification row stays open and no toggle is offered", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await stubSite(page);
  await page.goto("/");
  for (const id of ["sp-detail-tv", "sp-detail-fridge", "sp-detail-dryer"]) await expect(page.locator("#" + id)).toBeVisible();
  await expect(page.locator("#sample .item-link-btn").first()).toBeHidden();
  await context.close();
});

test("hero copy starts at the top of the form card, left aligned, with no vertical centering", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; }" });
  const width = testInfo.project.use.viewport.width;
  const m = await page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
    const text = rect(".home-hero-text");
    const kicker = rect(".home-hero-text .home-hero-kicker");
    const card = rect(".hero-consult");
    const links = rect(".home-hero-text .hero-sample");
    return {
      textTop: text.top, textLeft: text.left, kickerTop: kicker.top, cardTop: card.top, cardHeight: card.height, textBottom: text.bottom, linksBottom: links.bottom,
      align: getComputedStyle(document.querySelector(".home-hero-text")).alignSelf,
      textAlign: getComputedStyle(document.querySelector(".home-hero-text")).textAlign
    };
  });
  expect(m.textAlign).not.toBe("center");
  if (width >= 1024) {
    expect(m.align).toBe("start");
    // The kicker begins level with the top of the form card, not partway down it.
    expect(Math.abs(m.textTop - m.cardTop)).toBeLessThanOrEqual(8);
    expect(m.kickerTop - m.cardTop).toBeLessThanOrEqual(24);
    // The copy sits in the upper part of the form's height, ending well above the card's bottom.
    expect(m.linksBottom - m.cardTop).toBeLessThan(m.cardHeight * 0.85);
  }
});

test("the experience markers sit in their own gutter and never overlap the item text", async ({ page }) => {
  await page.goto("/");
  const items = await page.locator("#experience .credibility-areas li").evaluateAll((nodes) =>
    nodes.map((li) => {
      const before = getComputedStyle(li, "::before");
      const style = getComputedStyle(li);
      const range = document.createRange();
      range.selectNodeContents(li);
      const text = range.getBoundingClientRect();
      const box = li.getBoundingClientRect();
      const markerRight = box.left + parseFloat(before.left) + parseFloat(before.width);
      return { markerRight, textLeft: text.left, padLeft: parseFloat(style.paddingLeft), markerLeft: parseFloat(before.left), height: box.height, markerTop: parseFloat(before.top), liTop: 0 };
    })
  );
  expect(items).toHaveLength(4);
  for (const item of items) {
    expect(item.textLeft - item.markerRight, "gap between the marker and the text").toBeGreaterThanOrEqual(8);
    expect(item.markerLeft).toBeGreaterThanOrEqual(10);
    expect(item.height).toBeGreaterThanOrEqual(40);
  }
  // The four items form a tidy two-by-two block inside the card.
  const boxes = await page.locator("#experience .credibility-areas li").evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect()));
  const card = await page.locator("#experience .credibility-card").boundingBox();
  for (const box of boxes) {
    expect(box.left).toBeGreaterThanOrEqual(card.x);
    expect(box.right).toBeLessThanOrEqual(card.x + card.width + 0.5);
  }
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
  if (width >= 1024) expect(height).toBeLessThan(4800);
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
  for (const card of await page.locator(".sample-preview, .impact-card, .provides-card, .hero-consult").all()) {
    const box = await card.boundingBox();
    expect(box.x, testInfo.project.name).toBeGreaterThanOrEqual(-0.5);
    expect(box.x + box.width, testInfo.project.name).toBeLessThanOrEqual(testInfo.project.use.viewport.width + 0.5);
  }
  expect(errors).toEqual([]);
});
