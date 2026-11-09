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

test("the comparison section leads with the verified Samsung television comparison and keeps the refrigerator second", async ({ page }) => {
  await page.goto("/");
  const section = page.locator("#comparable");
  await expect(section.locator(".rc-stack > .rc")).toHaveCount(2);
  await expect(section.locator(".rc .rc-title")).toHaveText([
    "The newer model isn\u2019t always the comparable one.",
    "Refrigerator: when the original is still sold new"
  ]);
  for (const tags of await section.locator(".rc-tags").all()) {
    await expect(tags).toContainText("prices observed November 9, 2026");
    await expect(tags).toContainText("Sale-event prices");
  }
  // The retired hypothetical figures and the older August example are gone.
  await expect(section).not.toContainText(/hypothetical|illustrative|\$249|\$1,499|August 13|RF32CG5100|RF32CG5300|receiver/i);
  await expect(section.locator(".comparable-card, .comparable-ladder")).toHaveCount(0);
  const hrefs = await section.locator(".comparable-link").evaluateAll((nodes) => nodes.map((a) => a.getAttribute("href")));
  expect(hrefs).toEqual(["/report#case-tv", "/report#case-fridge"]);
});

test("the television table names the original, its sources, three candidates and exact model codes", async ({ page }) => {
  await page.goto("/");
  const tv = page.locator("#cmp-tv");
  await expect(tv.locator(".rc-orig-model")).toHaveText("Samsung QN55Q80AAFXZA");
  await expect(tv.locator(".rc-orig-specs dt")).toHaveText(["Display", "Backlight", "Native refresh rate", "4K@120Hz HDMI input", "Variable refresh rate"]);
  // Samsung supports four of the original's specifications; the native refresh rate rests on RTINGS and says so.
  await expect(tv.locator(".rc-src--mfr")).toHaveCount(4);
  await expect(tv.locator(".rc-src--third")).toHaveCount(1);
  await expect(tv.locator(".rc-src--third")).toHaveText(/RTINGS/);
  await expect(tv.locator(".rc-orig-note")).toContainText("Samsung's sheet does not state a native rate".replace("'", "\u2019"));

  await expect(tv.locator("thead .rc-role")).toHaveText(["Lower-priced candidate", "Selected LKQ candidate", "Higher-priced candidate"]);
  await expect(tv.locator("thead .rc-model")).toHaveText(["Samsung QN55QN70H", "Samsung QN55QN80H", "Samsung QN55S90H"]);
  await expect(tv.locator("thead .rc-price")).toHaveText(["$699.99", "$899.99", "$1,199.99"]);
  await expect(tv.locator("thead .rc-meta")).toHaveText([
    /Best Buy · Nov 9, 2026 · Black Friday Deal/,
    /Best Buy · Nov 9, 2026 · Black Friday Deal/,
    /Best Buy · Nov 9, 2026 · Holiday Deal/
  ]);
  await expect(tv.locator("thead .rc-meta a")).toHaveCount(3);
  await expect(tv.locator("thead th.rc-sel")).toHaveCount(1);
  await expect(tv.locator("thead th.rc-sel .rc-model")).toHaveText("Samsung QN55QN80H");
});

test("every specification cell carries a text label, and the television verdicts match the documented specifications", async ({ page }) => {
  await page.goto("/");
  const rows = page.locator("#tv-comparison tbody tr");
  const labelled = ["Display technology", "Backlight", "Native refresh rate", "4K@120Hz HDMI input", "Variable refresh rate", "Conclusion"];
  const expected = {
    "Display technology": ["Meets", "Meets", "Upgrade"],
    Backlight: ["Meets", "Meets", "Upgrade"],
    "Native refresh rate": ["Shortfall", "Meets", "Upgrade"],
    "4K@120Hz HDMI input": ["Shortfall", "Meets", "Upgrade"],
    "Variable refresh rate": ["Shortfall", "Meets", "Meets"],
    Conclusion: ["Shortfall", "Meets", "Upgrade"]
  };
  for (const name of labelled) {
    const row = rows.filter({ has: page.locator("th", { hasText: new RegExp("^" + name) }) });
    await expect(row, name).toHaveCount(1);
    const flags = await row.locator(".rc-flag").allTextContents();
    expect(flags.map((f) => f.replace(/[^A-Za-z]/g, "")), name).toEqual(expected[name]);
  }
  // The selected candidate never falls short, and the lower-priced one falls short exactly three times on specifications.
  const lowerShortfalls = await page.locator("#tv-comparison tbody tr:not(.rc-conclusion) td:nth-child(2) .rc-bad").count();
  expect(lowerShortfalls).toBe(3);
  await expect(page.locator("#tv-comparison td.rc-sel .rc-bad")).toHaveCount(0);

  const cell = (row, col) => page.locator("#tv-comparison tbody tr").nth(row).locator("td").nth(col);
  await expect(cell(2, 0)).toContainText("60Hz");
  await expect(cell(2, 1)).toContainText("144Hz");
  await expect(cell(2, 2)).toContainText("165Hz");
  await expect(cell(3, 0)).toContainText("Maximum 4K@60Hz");
  await expect(cell(4, 0)).toContainText("Not supported");
  // Same-day Samsung.com prices and Samsung's published list prices are shown separately from the observed Best Buy price.
  await expect(cell(5, 0)).toHaveText("$699.99");
  await expect(cell(5, 1)).toHaveText("$899.99");
  await expect(cell(5, 2)).toHaveText("$1,199.99");
  await expect(cell(6, 0)).toHaveText("$899.99");
  await expect(cell(6, 1)).toHaveText("$1,299.99");
  await expect(cell(6, 2)).toHaveText("$1,999.99");
});

test("the television reasoning is specific, avoids over-claiming and keeps sale-event disclosure visible", async ({ page }) => {
  await page.goto("/");
  const tv = page.locator("#cmp-tv");
  await expect(tv.locator(".rc-points li").nth(0)).toContainText("Why not the QN70H.");
  await expect(tv.locator(".rc-points li").nth(0)).toContainText("60Hz, no VRR and a 4K@60Hz maximum");
  await expect(tv.locator(".rc-points li").nth(1)).toContainText("not because it is the middle price");
  await expect(tv.locator(".rc-points li").nth(2)).toContainText("not presented as the lowest-priced suitable Samsung");
  await expect(tv.locator(".rc-points li").nth(2)).toContainText("QN80F");
  await expect(tv.locator(".rc-points li").nth(2)).toContainText("unresolved");
  await expect(tv.locator(".rc-disclosure")).toContainText("Black Friday and Holiday Deal promotions");
  await expect(tv.locator(".rc-disclosure")).toContainText("not regular prices");
  await expect(tv.locator(".rc-disclosure")).toContainText("native refresh rate, a third-party measurement by RTINGS");
  await expect(tv.locator(".rc-disclosure")).toContainText("not a claim determination");
  await expect(tv.locator(".rc-disclosure")).toBeVisible();
  // Crossed-out retailer prices are never presented as regular prices, and no savings claims appear.
  await expect(page.locator("#comparable")).not.toContainText(/comparable value|\bwas \$|\bsave \$|\bsavings?\b|most supportable|universal/i);
});

test("the refrigerator table compares the original model with the two look-alikes and keeps dated Best Buy prices", async ({ page }) => {
  await page.goto("/");
  const fridge = page.locator("#cmp-fridge");
  await expect(fridge.locator(".rc-orig-model")).toHaveText("Samsung RF28R7201SR");
  await expect(fridge.locator("thead .rc-model")).toHaveText(["Samsung RF32CG5B30SR", "Samsung RF28R7201SR", "Samsung RF29BB8600QL"]);
  await expect(fridge.locator("thead .rc-price")).toHaveText(["$1,799.99", "$1,899.99", "$2,199.99"]);
  await expect(fridge.locator("thead .rc-role")).toHaveText(["Lower-priced candidate", "Selected: the original model", "Higher-priced candidate"]);
  await expect(fridge.locator("thead .rc-meta")).toHaveText([/Nov 9, 2026 · Sale price/, /Nov 9, 2026 · Black Friday Deal/, /Nov 9, 2026 · Black Friday Deal/]);
  await expect(fridge.locator("tbody tr").nth(0)).toContainText("3-door (Bespoke AI)");
  await expect(fridge.locator("tbody tr").nth(1)).toContainText("None. A full-width drawer instead");
  await expect(fridge.locator("tbody tr").nth(1)).toContainText("3.1 cu ft (smaller), 5 temperature zones");
  await expect(fridge.locator("tbody tr").nth(2)).toContainText("None listed. Internal water dispenser or built-in pitcher");
  await expect(fridge.locator("tbody tr.rc-conclusion td.rc-sel")).toContainText("Same model, still available new");
  await expect(fridge.locator(".rc-lede")).toContainText("removes the substitution question");
  await expect(fridge.locator(".rc-disclosure")).toContainText("not regular prices");
});

test("the selected candidate is visibly emphasized, and the table is a labelled comparison at every width", async ({ page }, testInfo) => {
  await page.goto("/");
  const metrics = await page.locator("#tv-comparison").evaluate((table) => {
    const px = (node, prop) => parseFloat(getComputedStyle(node)[prop]);
    const sel = table.querySelector("thead th.rc-sel");
    const other = table.querySelector("thead th.rc-col:not(.rc-sel)");
    const selCell = table.querySelector("tbody td.rc-sel");
    const otherCell = table.querySelector("tbody td:not(.rc-sel)");
    const heads = Array.from(table.querySelectorAll("thead th.rc-col")).map((el) => el.getBoundingClientRect());
    const cells = Array.from(table.querySelectorAll("tbody tr:first-child td")).map((el) => el.getBoundingClientRect());
    return {
      selBorder: Math.max(px(sel, "borderTopWidth"), px(sel, "borderLeftWidth")),
      otherBorder: Math.max(px(other, "borderTopWidth"), px(other, "borderLeftWidth")),
      selCellBorder: px(selCell, "borderLeftWidth"),
      otherCellBorder: px(otherCell, "borderLeftWidth"),
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
    // Stacked: each candidate is its own block, in price order, and every value is labelled with its specification.
    expect(metrics.headY[0]).toBeLessThan(metrics.headY[1]);
    expect(metrics.headY[1]).toBeLessThan(metrics.headY[2]);
    expect(new Set(metrics.cellX).size).toBe(1);
    expect(metrics.labelContent).toMatch(/Display technology \(original: QLED, quantum dot\)/);
    const order = await page.locator("#tv-comparison").evaluate((table) => {
      const top = (el) => el.getBoundingClientRect().top;
      const heads = Array.from(table.querySelectorAll("thead th.rc-col"));
      const cells = Array.from(table.querySelectorAll("tbody td.rc-cell"));
      return cells.map((cell) => {
        const col = Array.from(cell.parentElement.children).indexOf(cell) - 1;
        const next = heads[col + 1];
        return top(cell) > top(heads[col]) && (!next || top(cell) < top(next));
      });
    });
    expect(order.every(Boolean), "each cell sits inside its own candidate block").toBe(true);
  } else {
    // Side by side: the three candidates share one header row and each specification row.
    expect(new Set(metrics.headY).size).toBe(1);
    expect(new Set(metrics.cellY).size).toBe(1);
    expect(new Set(metrics.cellX).size).toBe(3);
  }
});

test("the hero shows the real sample finding instead of the retired fictional report", async ({ page }) => {
  await page.goto("/");
  const hero = page.locator("#sample-report");
  await expect(hero).toBeVisible();
  await expect(hero.locator(".hero-finding-kicker")).toContainText("prices observed November 9, 2026");
  await expect(hero.locator(".hero-finding-model")).toHaveText(["Samsung QN55QN70H", "Samsung QN55QN80H · selected", "Samsung QN55S90H"]);
  await expect(hero.locator(".hero-finding-price")).toHaveText(["$699.99", "$899.99", "$1,199.99"]);
  await expect(hero.locator(".rc-flag")).toHaveText([/Shortfall/, /Meets/, /Upgrade/]);
  await expect(hero.locator('a[href="#comparable"]')).toBeVisible();
  await expect(hero.locator('a[href="/report"]')).toBeVisible();
  await expect(hero.locator('a[href="/assets/ItemAssist-Sample-Research-Report.pdf"]')).toHaveAttribute("download", "");
  await expect(hero).not.toContainText(/fictional|IA-DEMO|demonstration|22 |95%|High Confidence/i);
  for (const selector of [".window", ".titlebar", ".sb-metrics", ".tbl", ".sample-report-toggle", ".report-published-date"]) {
    await expect(page.locator(selector), selector).toHaveCount(0);
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

test("the homepage sections run in the approved order, with How It Works leading straight into the inquiry form", async ({ page }) => {
  await page.goto("/");
  const order = await page.evaluate(() =>
    Array.from(document.querySelectorAll("main > section"))
      .map((section) => section.querySelector("h2")?.textContent.trim())
      .filter(Boolean)
  );
  const wanted = [
    "Similar Isn\u2019t the Same as Comparable",
    "A Poor Comparison Can Miss in Either Direction",
    "What Item Assist Provides",
    "Built From Hands-On Claims Experience",
    "How It Works",
    "Request Research or a Free Consultation"
  ];
  // The sample-report hero and anything above it come first; from the comparison examples on, the order is exact.
  const start = order.indexOf(wanted[0]);
  expect(start, "comparison section present").toBeGreaterThan(-1);
  expect(order.slice(start)).toEqual(wanted);

  // The credibility section appears once, and nothing sits between How It Works and the form.
  await expect(page.locator("#experience")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Built From Hands-On Claims Experience" })).toHaveCount(1);
  const adjacency = await page.evaluate(() => {
    const children = Array.from(document.querySelector("main").children);
    const index = (id) => children.indexOf(document.getElementById(id));
    return { experience: index("experience"), how: index("how"), contact: index("contact") };
  });
  expect(adjacency.how).toBe(adjacency.experience + 1);
  expect(adjacency.contact).toBe(adjacency.how + 1);
});

test("section spacing is even: no large gap or overlap between the sections from the benefits to the form", async ({ page }) => {
  await page.goto("/");
  const gaps = await page.evaluate(() => {
    const ids = ["provides", "experience", "how", "contact"];
    const rects = ids.map((id) => document.getElementById(id).getBoundingClientRect());
    return rects.slice(1).map((rect, i) => ({ from: ids[i], to: ids[i + 1], gap: rect.top - rects[i].bottom }));
  });
  for (const { from, to, gap } of gaps) {
    expect(gap, from + " to " + to + " does not overlap").toBeGreaterThanOrEqual(0);
    expect(gap, from + " to " + to + " is not an oversized gap").toBeLessThanOrEqual(140);
  }
});

test("the credibility section states the experience and the service boundary, and claims nothing unverified", async ({ page }) => {
  await page.goto("/");
  const section = page.locator("#experience");
  await expect(section).toContainText("more than 12 years of experience with property claims, product research, pricing evaluation, and contents replacement comparisons");
  await expect(section).toContainText("specialized, independent research service");
  await expect(section).toContainText("Coverage, depreciation, settlement, and claim-handling decisions remain with the client.");

  // Outside the hero finding card, the page makes no credential, endorsement or outcome claims.
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

test("layout holds: no horizontal overflow, the form follows the process section, nothing spills", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  await expect(page.locator(".home-hero-text .btn-primary")).toBeVisible();
  await page.locator("#consultation").scrollIntoViewIfNeeded();
  for (const field of ["#consult-name", "#consult-email", "#consult-reason", "#consult-count", "#consult-description"]) {
    await expect(page.locator(field)).toBeVisible();
  }
  for (const card of await page.locator(".rc, .provides-card").all()) {
    const box = await card.boundingBox();
    expect(box.x, testInfo.project.name).toBeGreaterThanOrEqual(-0.5);
    expect(box.x + box.width, testInfo.project.name).toBeLessThanOrEqual(testInfo.project.use.viewport.width + 0.5);
  }
  expect(errors).toEqual([]);
});
