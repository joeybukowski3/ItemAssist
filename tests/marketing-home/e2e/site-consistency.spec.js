const { test, expect, stubSite, horizontalOverflow } = require("./helpers.js");

const PAGES = [
  "/index.html",
  "/services",
  "/about",
  "/report",
  "/privacy",
  "/404",
  "/what-does-lkq-mean-contents-claims",
  "/discontinued-av-receiver-replacement-research",
  "/request-age-verification"
];

const textOf = (page) => page.evaluate(() => document.body.innerText);

test.beforeEach(async ({ page }) => {
  await stubSite(page);
});

test("every page's nav offers the free consultation, in the header and in the mobile menu", async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(path);
    const ctas = page.locator(".nav-cta");
    await expect(ctas, path).toHaveCount(2);
    await expect(ctas, path).toHaveText(["Request a Free Consultation", "Request a Free Consultation"]);
    // The homepage links to its own section; every other page links to it on the homepage.
    const expected = path === "/index.html" ? "#consultation" : "/#consultation";
    for (const href of await ctas.evaluateAll((els) => els.map((el) => el.getAttribute("href")))) expect(href, path).toBe(expected);
    await expect(page.locator("nav").getByText("Submit a Research Request"), `${path} nav`).toHaveCount(0);
  }
});

test("no page shows the retired price badges, 'starting at' price blocks or the old Item Consultation name", async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(path);
    const body = await textOf(page);
    expect(body, `${path} New Client Rate`).not.toMatch(/new client rate/i);
    expect(body, `${path} starting at`).not.toMatch(/starting at \$|starting price/i);
    expect(body, `${path} old name`).not.toMatch(/item consultation/i);
    await expect(page.locator(".intro-offer-badge"), path).toHaveCount(0);
  }
});

test("introductory rates appear only as a quiet reference note, never in a heading, card, button or meta tag", async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(path);
    const flagged = await page.evaluate(() => {
      const hits = [];
      const walker = document.createTreeWalker(document.querySelector("main") || document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!/\$(25|75)\b/.test(node.textContent)) continue;
        const holder = node.parentElement.closest("p, li, h1, h2, h3, h4, a, button, span, div");
        hits.push({ tag: holder.tagName, cls: holder.className, inReference: Boolean(node.parentElement.closest(".pricing-reference, .trust-note")) });
      }
      return hits;
    });
    for (const hit of flagged) {
      expect(hit.inReference, `${path}: $25/$75 outside a reference note (${hit.tag}.${hit.cls})`).toBe(true);
      expect(["H1", "H2", "H3", "H4", "A", "BUTTON"], `${path} ${hit.tag}`).not.toContain(hit.tag);
    }
    for (const selector of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]', "title"]) {
      if ((await page.locator(selector).count()) === 0) continue; // not every page sets every social tag
      const value = await page.locator(selector).first().evaluate((el) => el.getAttribute("content") || el.textContent);
      expect(value, `${path} ${selector}`).not.toMatch(/\$\d/);
    }
  }
});

test("the four offerings are described the same way on the homepage and the services page", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator(".offer-kind")).toHaveText([
    "Conversation · no research deliverable",
    "Scoped & quoted",
    "Paid research · with findings",
    "Recurring work"
  ]);

  await page.goto("/services");
  const cards = page.locator("#svc-pricing-tiers .card");
  await expect(cards.locator(".card-title")).toHaveText(["Free Initial Consultation", "Individual Item Research", "Contents Research", "Ongoing Research Support"]);
  await expect(cards.nth(0)).toContainText("not item-specific research");
  await expect(cards.nth(0)).toContainText("no research deliverable or findings");
  await expect(cards.nth(1)).toContainText("Paid research on one specific item");
  await expect(cards.nth(1)).toContainText("actual product research and findings");
  await expect(cards.nth(2)).toContainText("Scoped and quoted");
  await expect(cards.nth(3)).toContainText("recurring professional assignments");
  await expect(page.locator("#svc-pricing-tiers")).toContainText("Scope, turnaround, and price are confirmed before work begins.");
  await expect(page.locator(".trust-note", { hasText: "introductory starting rates" })).toContainText("not quotes");
});

test("every internal link and anchor on every page resolves", async ({ page, request, baseURL }) => {
  const checked = new Map();
  const htmlOf = async (path) => {
    if (!checked.has(path)) {
      const response = await request.get(baseURL + path);
      checked.set(path, { status: response.status(), html: response.status() === 200 ? await response.text() : "" });
    }
    return checked.get(path);
  };

  for (const path of PAGES) {
    await page.goto(path);
    const hrefs = await page.locator("a[href]").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
    for (const raw of new Set(hrefs)) {
      if (!raw || raw.startsWith("mailto:") || raw.startsWith("tel:") || raw === "#") continue;
      let target;
      if (raw.startsWith("#")) target = { path: path === "/404" ? "/404" : path, hash: raw.slice(1) };
      else if (raw.startsWith("/") || raw.startsWith("https://itemassist.com")) {
        const url = new URL(raw, "https://itemassist.com");
        target = { path: url.pathname === "/" ? "/index.html" : url.pathname, hash: url.hash.slice(1) };
      } else continue; // other external sites are not fetched
      const { status, html } = await htmlOf(target.path);
      expect(status, `${path} -> ${raw}`).toBe(200);
      if (target.hash && /\.html$|^\/[a-z0-9-]+$/.test(target.path)) {
        expect(html, `${path} -> ${raw}: no element with id="${target.hash}"`).toContain(`id="${target.hash}"`);
      }
    }
  }
});

test("service pages point to the unified homepage form, and the old assignment anchor still resolves to it", async ({ page }) => {
  for (const path of ["/services", "/report", "/what-does-lkq-mean-contents-claims"]) {
    await page.goto(path);
    const link = page.locator('.cta-assignment-link a[href="/?consult=research_request#consultation"]').first();
    await expect(link, path).toHaveText("Send a research request");
    await expect(page.getByText("Go to the assignment form"), path).toHaveCount(0);
  }
  // The static test server cannot serve "/?query", so follow the link's target through the explicit .html route.
  await page.goto("/index.html?consult=research_request#consultation");
  await expect(page.locator("#consultation-form")).toBeVisible();
  await expect(page.locator("#consult-reason")).toHaveValue("research_request");

  // Documented fallback: bookmarks and the services card that still use #submit-assignment land on the same form.
  await page.goto("/services");
  await page.locator('#svc-pricing-tiers a[href="/#submit-assignment"]').click();
  await expect(page).toHaveURL(/\/#submit-assignment$/);
  await expect(page.locator("#submit-assignment")).toBeAttached();
  await expect(page.locator("#consultation-form")).toBeVisible();
  await expect(page.locator("#consult-reason")).toHaveValue("research_request");
  await page.goto("/index.html#contact");
  await expect(page.locator("#contact #consultation-form")).toBeAttached();
});

test("the About page keeps its own working assignment form and links to the consultation", async ({ page }) => {
  const calls = await stubSite(page);
  await page.goto("/about");
  await expect(page.locator(".about-v2-actions .btn-primary").first()).toHaveText("Request a Free Consultation");
  await expect(page.locator('.cta-assignment-link a[href="#contact"]')).toBeVisible();
  await expect(page.locator(".cta-consult-link a")).toHaveAttribute("href", "/#consultation");
  await expect(page.locator("#contact #contact-form")).toBeAttached();

  await page.locator("#contact-name").fill("Alex Adjuster");
  await page.locator("#email").fill("alex@example.com");
  await page.locator("#assignment-notes").fill("Twenty items.");
  await expect.poll(() => page.locator("#form-status").textContent(), { timeout: 5000 }).not.toMatch(/could not load/);
  await page.locator("#contact-form .form-submit").click();
  await expect(page.locator("#form-status")).toContainText("Contents list received");
  expect(calls.contact).toHaveLength(1);
  expect(calls.consultation).toHaveLength(0);
});

test("the About page states the experience without credentials, a team or a stale item limit", async ({ page }) => {
  await page.goto("/about");
  await expect(page.locator("main")).toContainText("more than 12 years of experience with property claims, product research, pricing evaluation, and contents replacement comparisons");
  const body = await textOf(page);
  for (const pattern of [/\bexperts?\b/i, /up to 10/i, /\blicen[sc]ed\b/i, /\bcertified\b/i, /\baccredited\b/i, /\bcertifications?\b(?! of the original)/i, /\bendorsed?\b/i, /\bguarantee/i, /\bour team\b/i, /\bspecialist-led\b/i]) {
    expect(body, String(pattern)).not.toMatch(pattern);
  }
  await expect(page.locator(".about-founder-copy")).toContainText("research judgment remains human-led");
});

test("no public page claims credentials, endorsement, a team or guaranteed results", async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(path);
    const body = await page.evaluate(() => {
      const clone = document.body.cloneNode(true);
      clone.querySelectorAll("script, style, #sample-report, .hero-report-preview, .avr-form-shell, option").forEach((el) => el.remove());
      return clone.textContent;
    });
    for (const pattern of [/\blicen[sc]ed (adjuster|appraiser|professional)/i, /\bcertified (adjuster|appraiser|professional|researcher)/i, /\baccredited\b/i, /\bendorsed by\b/i, /\bguarantee[sd]?\b/i, /\bour (team|experts|specialists)\b/i, /\bcarrier partner/i]) {
      expect(body, `${path} ${pattern}`).not.toMatch(pattern);
    }
  }
});

test("the age-verification request page uses the new service name and no fixed price", async ({ page }) => {
  await page.goto("/request-age-verification");
  const body = await textOf(page);
  expect(body).toContain("Individual Item Research");
  expect(body).not.toMatch(/item consultation|\$25/i);
  await expect(page.locator(".avr-pricing-detail-section")).toContainText("scope and price confirmed before paid work begins");
});

test("links from other pages preselect the request type on the homepage form", async ({ page }) => {
  await page.goto("/index.html?consult=research_request");
  await expect(page.locator("#consult-reason")).toHaveValue("research_request");
  await page.goto("/index.html?consult=consultation");
  await expect(page.locator("#consult-reason")).toHaveValue("consultation");
  await page.goto("/index.html?consult=<script>");
  await expect(page.locator("#consult-reason")).toHaveValue("");
  await page.goto("/index.html?consult=");
  await expect(page.locator("#consult-reason")).toHaveValue("");
  await page.goto("/services");
  await expect(page.locator('a[href="/?consult=research_request#consultation"]').first()).toBeAttached();
  await expect(page.locator('a[href="/?consult=consultation#consultation"]').first()).toBeAttached();
  await expect(page.locator('a[href*="individual_item"], a[href*="ongoing_support"]')).toHaveCount(0);
});

test("the privacy policy discloses consultation details, campaign tags and spam verification, without security or retention promises", async ({ page }) => {
  await page.goto("/privacy");
  const main = page.locator("main");
  await expect(main.locator("h2")).toContainText(["Consultation and Research Requests", "Campaign Source Tags", "Spam and Abuse Protection", "Website Analytics"]);
  const analytics = main.locator("div", { has: page.getByRole("heading", { name: "Website Analytics" }) }).last();
  await expect(analytics).toContainText("Google Analytics");
  await expect(analytics).toContainText("website traffic, how visitors interact with pages and links, and how our marketing links perform");
  await expect(analytics).toContainText("may include the pages you view");
  await expect(analytics).toContainText("your IP address");
  await expect(analytics).toContainText("cookies or similar identifiers");
  await expect(analytics).toContainText("collected and processed by Google, a third party");
  await expect(analytics.locator('a[href="https://policies.google.com/privacy"]')).toHaveCount(1);
  await expect(main).toContainText("measure website traffic");
  // The consultation disclosures from the earlier round are untouched.
  await expect(main).toContainText("Separately, this website uses Google Analytics");
  await expect(main).toContainText("name, email address, request type (free consultation, research request, or exploring options), and a short description");
  await expect(main).toContainText("optional company name, phone number, and approximate item count");
  await expect(main.locator("h2")).toContainText(["Consultation and Research Requests"]);
  await expect(main).toContainText("we arrange how to send item lists or files after we follow up");
  await expect(main).toContainText("utm_source, utm_medium, utm_campaign, or ref");
  await expect(main).toContainText("Cloudflare Turnstile");
  await expect(main).toContainText("IP address");
  await expect(main).toContainText("does not save the inquiry in a separate database");
  await expect(main).toContainText("Updated November 3, 2026");
  const body = await textOf(page);
  for (const pattern of [/\bencrypt/i, /\bsecure(ly|d)?\b/i, /\bSOC ?2\b/i, /\bHIPAA\b/i, /\bGDPR\b/i, /\bCCPA\b/i, /deleted? (after|within)/i, /\bretain(ed)? for \d/i, /\bnever\b/i, /\bguarantee/i, /anonym/i, /pseudonym/i, /de-?identif/i, /\bconsent/i, /do not track/i, /\bopt[- ]?(in|out)\b/i, /not (shared|sold) with google/i]) {
    expect(body, String(pattern)).not.toMatch(pattern);
  }
});

test("every page fits the viewport with no horizontal scroll", async ({ page }, testInfo) => {
  for (const path of PAGES) {
    await page.goto(path);
    expect(await horizontalOverflow(page), `${path} @ ${testInfo.project.name}`).toBeLessThanOrEqual(0);
  }
});
