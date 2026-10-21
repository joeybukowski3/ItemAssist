// ItemAssist Research inside the existing two-panel workspace. Every reply is a mocked /api/itemassist-research response: no proxy,
// engine or provider is contacted. Uses the analytics-blocking `test` from the replacement-finder helpers.
const { test, expect, contracts, prepare, isNarrowViewport, expectNoHorizontalOverflow, PAGE } = require("../../replacement-finder/e2e/helpers.js");
const { researchResponse, researchGuidance, researchError } = require("../fixtures/research.js");

const settle = (seen) => { expect(seen.consoleErrors).toEqual([]); expect(seen.pageErrors).toEqual([]); expect(seen.analytics).toEqual([]); };
const research = (reply) => ({ research: { reply } });
const ok = (body = researchResponse(), status = 200) => ({ status, body });

async function send(page, text) {
  const input = page.getByLabel("Message ItemAssist");
  await input.fill(text);
  await input.press("Enter");
}
const log = (page) => page.locator("#rf-log");
async function ready(page) { await page.goto(PAGE); await expect(page.locator('[data-action="research-new"]')).toBeVisible(); }

// ---- off by default: the classic workspace is unchanged ---------------------------------------------------------------------

test("with research disabled the workspace is the classic lookup: classic greeting, no research controls, v1 route for typed models", async ({ page }) => {
  const seen = await prepare(page, { reply: () => ({ status: 200, body: contracts.engineComplete() }) });
  await page.goto(PAGE);
  await expect(log(page)).toContainText("Tell me what item you're researching. You can start with a brand and model number.");
  await expect(page.locator('[data-action="research-new"]')).toHaveCount(0);
  await expect(page.locator('[data-action="find"]')).toHaveText("Find Replacement");
  await send(page, "Samsung QN55Q80C");
  await expect(page.locator("#rf-product-name")).toBeVisible();
  expect(seen.posts).toHaveLength(1);
  expect(seen.researchPosts).toHaveLength(0);
  settle(seen);
});

test("?research=0 forces the classic lookup even when research is enabled", async ({ page }) => {
  const seen = await prepare(page, research(() => ok()));
  await page.goto(`${PAGE}?research=0`);
  await expect(page.locator('[data-action="find"]')).toHaveText("Find Replacement");
  await expect(page.locator('[data-action="research-new"]')).toHaveCount(0);
  settle(seen);
});

// ---- enabled: research is the default, in the same two panels ----------------------------------------------------------------

test("when enabled, research is the default: research greeting and chips in the same assistant, one composer, one product pane", async ({ page }) => {
  const seen = await prepare(page, research(() => ok()));
  await ready(page);
  await expect(log(page)).toContainText("Describe the item you're replacing");
  await expect(page.getByLabel("Message ItemAssist")).toHaveAttribute("placeholder", /Describe the item/);
  await expect(page.locator('[data-action="find"]')).toHaveText("Classic lookup");
  await expect(page.locator("#rf-composer")).toHaveCount(1);
  await expect(page.locator("textarea")).toHaveCount(1);
  await expect(page.locator("#rf-product-root")).toHaveCount(1);
  await expect(page.locator("#rf-assistant, #rf-product")).toHaveCount(2);
  settle(seen);
});

test("a typed description is researched: the conversation answers on the left and Product Intelligence fills on the right", async ({ page }) => {
  const seen = await prepare(page, research(() => ok()));
  await ready(page);
  await send(page, "LG C3 OLED TV");
  await expect(page.locator("#rf-product-name")).toHaveText("LG C3 series 4K OLED smart TV");

  // The request: the cleaned query, the shared honeypot, and an anonymous visitor ID header; nothing else.
  expect(seen.researchPosts).toHaveLength(1);
  expect(seen.researchPosts[0].body).toEqual({ query: "LG C3 OLED TV", website: "" });
  expect(seen.researchPosts[0].headers["x-visitor-id"]).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  expect(seen.posts).toHaveLength(0);

  // Left: the conversation. It says what it found, what it is unsure of, what to answer next and what is left today.
  await expect(log(page)).toContainText("This looks like LG C3 series 4K OLED smart TV.");
  await expect(log(page)).toContainText("Closest successor to consider: LG C-series OLED, next generation");
  await expect(log(page)).toContainText("Not sure about: Screen size was not given");
  await expect(log(page)).toContainText("Which screen size do you have?");
  await expect(log(page)).toContainText("4 of 5 free research requests left today.");

  // Right: structured research with the tabs of the existing Product Intelligence design.
  const product = page.locator("#rf-product-root");
  await expect(product.locator(".rf-rs-banner .rf-partial-title")).toHaveText("AI Research Summary");
  await expect(product.locator(".rf-rs-banner")).toContainText("preliminary and not independently verified");
  await expect(product.locator(".rf-rs-banner")).not.toContainText("Unverified AI estimate");
  await expect(product.locator("#rf-rpanel-overview")).toContainText("Closest successor to consider");
  await expect(product.locator("#rf-rpanel-overview")).toContainText("Concern: Fewer HDMI 2.1 ports in some sizes");
  await expect(product.locator("#rf-rpanel-overview")).toContainText("Biggest difference: Brighter panel, newer processor");

  if (!isNarrowViewport(page)) {
    await expect(product.locator("#rf-rpanel-replacements")).toBeHidden();
    await page.locator("#rf-rtab-replacements").click();
    await expect(product.locator("#rf-rpanel-replacements")).toBeVisible();
    for (const name of ["Samsung S90 series QD-OLED", "Sony Bravia 8 OLED"]) await expect(product.locator("#rf-rpanel-replacements")).toContainText(name);
    await expect(product.locator("#rf-rpanel-replacements")).toContainText("How it differs: Different smart platform.");
    await page.locator("#rf-rtab-requirements").click();
    await expect(product.locator("#rf-rpanel-requirements li")).toHaveCount(5);
    await page.locator("#rf-rtab-original").click();
    await expect(product.locator("#rf-rpanel-original")).toContainText("OLED panel");
  } else {
    // The single page: every section is on the page and the tab row is not needed.
    await expect(product.locator(".rf-tabbar")).toBeHidden();
    for (const name of ["overview", "original", "requirements", "replacements"]) await expect(product.locator(`#rf-rpanel-${name}`)).toBeVisible();
  }

  // Nothing the research does not know is claimed: no price, stock, LKQ or verification of any candidate.
  const text = await page.locator("#rf-shell").innerText();
  expect(/\$\d|in stock|\bLKQ\b|like[- ]kind|certified|guaranteed|Quick AI Estimate/i.test(text)).toBe(false);
  await expectNoHorizontalOverflow(page);
  settle(seen);
});

test("the two-panel layout is preserved beside each other on a wide screen (left about 38%, right about 62%)", async ({ page }) => {
  test.skip(isNarrowViewport(page), "the single-page layout is covered separately");
  const seen = await prepare(page, research(() => ok()));
  await ready(page);
  await send(page, "LG C3 OLED TV");
  await expect(page.locator("#rf-product-name")).toBeVisible();
  const [left, right] = await Promise.all([page.locator("#rf-assistant").boundingBox(), page.locator("#rf-product").boundingBox()]);
  expect(left.x).toBeLessThan(right.x);
  expect(Math.abs(left.y - right.y)).toBeLessThan(80);
  const ratio = left.width / (left.width + right.width);
  expect(ratio).toBeGreaterThan(0.33);
  expect(ratio).toBeLessThan(0.43);
  settle(seen);
});

// ---- clarification vs. a new request, and answers with no AI call ---------------------------------------------------------------

test("answering the question refines the same research and keeps the conversation; the right panel refreshes", async ({ page }) => {
  let calls = 0;
  const seen = await prepare(page, research(() => {
    calls += 1;
    return ok(calls === 1 ? researchResponse() : researchResponse({
      original: { identity: "LG C3 65-inch OLED evo TV", confidence: "HIGH", characteristics: ["65-inch OLED", "4K", "120 Hz"], uncertainty: null },
      clarify: [], quota: { limit: 5, remaining: 3, charged: true }
    }));
  }));
  await ready(page);
  await send(page, "LG C3 OLED TV");
  await expect(page.locator("#rf-product-name")).toHaveText("LG C3 series 4K OLED smart TV");
  await send(page, "65 inch");
  await expect(page.locator("#rf-product-name")).toHaveText("LG C3 65-inch OLED evo TV");
  expect(seen.researchPosts.map((post) => post.body.query)).toEqual(["LG C3 OLED TV", "LG C3 OLED TV, 65 inch"]);
  // The conversation is intact: both of the user's messages and the first answer are still there.
  await expect(log(page).locator(".rf-msg--user")).toHaveCount(2);
  await expect(log(page)).toContainText("3 of 5 free research requests left today.");
  settle(seen);
  if (isNarrowViewport(page)) await page.locator("#rf-convo-toggle").click();
  await expect(log(page)).toContainText("LG C3 OLED TV");
});

test("a different model starts new research instead of refining", async ({ page }) => {
  const seen = await prepare(page, research(() => ok()));
  await ready(page);
  await send(page, "LG C3 OLED TV");
  await expect(page.locator("#rf-product-name")).toBeVisible();
  await send(page, "Samsung QN55Q80C");
  await expect.poll(() => seen.researchPosts.length).toBe(2);
  expect(seen.researchPosts[1].body.query).toBe("Samsung QN55Q80C");
  settle(seen);
});

test("a question about the results is answered in the conversation with no new research request", async ({ page }) => {
  const seen = await prepare(page, research(() => ok()));
  await ready(page);
  await send(page, "LG C3 OLED TV");
  await expect(page.locator("#rf-product-name")).toBeVisible();
  await send(page, "why is the successor conditional?");
  await expect(log(page)).toContainText("Direct successor line with the same panel type.");
  await send(page, "where can I buy it?");
  await expect(log(page)).toContainText("doesn't check prices, stock or where to buy");
  expect(seen.researchPosts).toHaveLength(1);
  settle(seen);
});

test("an unclear longer message asks whether it is more detail or a different item, and sends nothing until answered", async ({ page }) => {
  const seen = await prepare(page, research(() => ok(researchResponse({ clarify: [] }))));
  await ready(page);
  await send(page, "LG C3 OLED TV");
  await expect(page.locator("#rf-product-name")).toBeVisible();
  await send(page, "I measured the opening and it is about 56 inches wide with a shelf above it");
  await expect(log(page)).toContainText("more detail about this item, or a different item");
  expect(seen.researchPosts).toHaveLength(1);
  await page.getByRole("button", { name: "More detail on this item" }).click();
  await expect.poll(() => seen.researchPosts.length).toBe(2);
  expect(seen.researchPosts[1].body.query).toBe("LG C3 OLED TV, I measured the opening and it is about 56 inches wide with a shelf above it");
  settle(seen);
});

test('"New research" clears the report and starts fresh without erasing the conversation', async ({ page }) => {
  const seen = await prepare(page, research(() => ok()));
  await ready(page);
  await send(page, "LG C3 OLED TV");
  await expect(page.locator("#rf-product-name")).toBeVisible();
  await page.locator('[data-action="research-new"]').click();
  await expect(log(page)).toContainText("Starting fresh. What item should I research?");
  await expect(page.locator("#rf-product-name")).toHaveCount(0);
  await send(page, "Samsung QN55Q80C");
  await expect.poll(() => seen.researchPosts.length).toBe(2);
  expect(seen.researchPosts[1].body.query).toBe("Samsung QN55Q80C");
  settle(seen);
});

// ---- failures ---------------------------------------------------------------------------------------------------------------------

test("a provider failure shows general guidance, clearly not researched", async ({ page }) => {
  const seen = await prepare(page, research(() => ok(researchGuidance())));
  await ready(page);
  await send(page, "some old TV");
  await expect(page.locator("#rf-product-root .rf-rs-banner")).toContainText("Research unavailable");
  await expect(page.locator("#rf-product-name")).toHaveText("Product not identified");
  await expect(log(page)).toContainText("Nothing there is researched");
  await expect(page.locator("#rf-rpanel-requirements li")).not.toHaveCount(0);
  settle(seen);
});

test("quota exhaustion is a plain message with no classic shortcut; an outage offers the classic lookup, which still works", async ({ page }) => {
  const seen = await prepare(page, { ...research(() => ({ status: 429, body: researchError("QUOTA_EXCEEDED", { limit: 5, remaining: 0, charged: false }) })), reply: () => ({ status: 200, body: contracts.engineComplete() }) });
  await ready(page);
  await send(page, "LG C3 OLED TV");
  await expect(log(page)).toContainText("You've used today's free ItemAssist Research requests.");
  await expect(page.getByRole("button", { name: "Use classic lookup" })).toHaveCount(0);
  await expect(log(page)).not.toContainText("server text the page must not show");
  settle(seen);
});

test("an engine error offers the classic lookup, and using it runs the classic report in the same panes", async ({ page }) => {
  const seen = await prepare(page, research(() => ({ status: 502, body: researchError("ENGINE_ERROR") })));
  await ready(page);
  await send(page, "LG C3 OLED TV");
  await expect(log(page)).toContainText("I couldn't complete that research.");
  await expect(log(page)).not.toContainText("server text the page must not show");
  await page.getByRole("button", { name: "Use classic lookup" }).click();
  await page.locator("#rf-model").fill("QN55Q80C");
  await page.locator("#rf-submit").click();
  await expect(page.locator("#rf-product-name")).toBeVisible();
  expect(seen.posts).toHaveLength(1);
  await expect(page.locator("#rf-product-root .rf-report--research")).toHaveCount(0);
  settle(seen);
});

test("after a research result, the Classic lookup chip still opens the structured form and replaces the research report", async ({ page }) => {
  const seen = await prepare(page, research(() => ok()));
  await ready(page);
  await send(page, "LG C3 OLED TV");
  await expect(page.locator("#rf-product-root .rf-report--research")).toHaveCount(1);
  await page.locator('[data-action="find"]').click();
  await page.locator("#rf-model").fill("QN55Q80C");
  await page.locator("#rf-submit").click();
  await expect(page.locator("#rf-product-root .rf-report--research")).toHaveCount(0);
  await expect(page.locator("#rf-product-name")).toBeVisible();
  expect(seen.posts).toHaveLength(1);
  settle(seen);
});

test("a network failure is a calm message and the previous report stays visible", async ({ page }) => {
  let calls = 0;
  const seen = await prepare(page, research(() => { calls += 1; return calls === 1 ? ok() : "abort"; }));
  await ready(page);
  await send(page, "LG C3 OLED TV");
  await expect(page.locator("#rf-product-name")).toHaveText("LG C3 series 4K OLED smart TV");
  await send(page, "65 inch");
  await expect(log(page)).toContainText("I couldn't reach ItemAssist Research.");
  await expect(page.locator("#rf-product-name")).toHaveText("LG C3 series 4K OLED smart TV");
  expect(seen.consoleErrors.filter((message) => !/ERR_FAILED|Failed to load resource/.test(message))).toEqual([]);
  expect(seen.pageErrors).toEqual([]);
});

test("the composer is limited to the 160-character research query", async ({ page }) => {
  const seen = await prepare(page, research(() => ok()));
  await ready(page);
  await expect(page.getByLabel("Message ItemAssist")).toHaveAttribute("maxlength", "160");
  settle(seen);
});

// ---- review additions ---------------------------------------------------------------------------------------------------------------

const samsung = () => researchResponse({
  original: { identity: "Samsung Q80C 55-inch QLED TV", confidence: "HIGH", characteristics: ["QLED panel", "4K", "120 Hz"], uncertainty: null },
  successor: { name: "Samsung Q80D QLED", why: "Next generation of the same line.", differences: "Newer processor", concern: null, confidence: "HIGH", standing: "RECOMMENDED", verified: false },
  clarify: [], quota: { limit: 5, remaining: 3, charged: true }
});
const byQuery = (body) => ok(/^Samsung/.test(body.query) ? samsung() : researchResponse());
const userMessages = (page) => log(page).locator(".rf-msg--user");

test("a different product named while a question is open starts new research; the right pane updates and the conversation is kept", async ({ page }) => {
  const seen = await prepare(page, research(byQuery));
  await ready(page);
  await send(page, "LG C3 OLED TV");
  await expect(page.locator("#rf-product-name")).toHaveText("LG C3 series 4K OLED smart TV");
  await expect(log(page)).toContainText("Which screen size do you have?"); // the question is open
  await send(page, "Samsung QN55Q80C");
  await expect(page.locator("#rf-product-name")).toHaveText("Samsung Q80C 55-inch QLED TV");
  expect(seen.researchPosts.map((post) => post.body.query)).toEqual(["LG C3 OLED TV", "Samsung QN55Q80C"]);
  // Both of the user's messages and the first answer are still in the conversation (folded on the single page, one tap to show).
  await expect(userMessages(page)).toHaveCount(2);
  if (isNarrowViewport(page)) await page.locator("#rf-convo-toggle").click();
  await expect(log(page)).toContainText("This looks like LG C3 series 4K OLED smart TV.");
  await expect(log(page)).toContainText("This looks like Samsung Q80C 55-inch QLED TV.");
  await expect(page.locator("#rf-composer")).toHaveCount(1);
  settle(seen);
});

test("a different kind of product is also a new request, not an answer to the open question", async ({ page }) => {
  const seen = await prepare(page, research(() => ok()));
  await ready(page);
  await send(page, "LG C3 OLED TV");
  await expect(page.locator("#rf-product-name")).toBeVisible();
  await send(page, "GE refrigerator GFE28");
  await expect.poll(() => seen.researchPosts.length).toBe(2);
  expect(seen.researchPosts[1].body.query).toBe("GE refrigerator GFE28");
  settle(seen);
});

test("a message naming only another brand is ambiguous: it asks, and each choice does what it says", async ({ page }) => {
  const seen = await prepare(page, research(byQuery));
  await ready(page);
  await send(page, "LG C3 OLED TV");
  await expect(page.locator("#rf-product-name")).toBeVisible();
  await send(page, "I'd like a Samsung");
  await expect(log(page)).toContainText("more detail about this item, or a different item");
  expect(seen.researchPosts).toHaveLength(1);
  await page.getByRole("button", { name: "More detail on this item" }).click();
  await expect.poll(() => seen.researchPosts.length).toBe(2);
  expect(seen.researchPosts[1].body.query).toBe("LG C3 OLED TV, I'd like a Samsung");
  await send(page, "Samsung TV");
  await page.getByRole("button", { name: "A different item" }).click();
  await expect.poll(() => seen.researchPosts.length).toBe(3);
  expect(seen.researchPosts[2].body.query).toBe("Samsung TV");
  settle(seen);
});

// ---- research is on only when the status endpoint says so -----------------------------------------------------------------------

test("research stays off unless the status endpoint answers exactly enabled:true (anything else leaves the classic lookup)", async ({ page }) => {
  const seen = await prepare(page, {});
  const variants = [
    { status: 200, body: JSON.stringify({ enabled: false, dailyLimit: 5 }) },
    { status: 200, body: JSON.stringify({ enabled: "true" }) },
    { status: 200, body: JSON.stringify({ enabled: 1 }) },
    { status: 200, body: JSON.stringify({}) },
    { status: 200, body: "<html>not json</html>" },
    { status: 500, body: "Internal Server Error" },
    { status: 404, body: "Not found" },
    "abort"
  ];
  for (const variant of variants) {
    await page.unroute("**/api/itemassist-research");
    let asked = false;
    await page.route("**/api/itemassist-research", async (route) => {
      asked = true;
      if (variant === "abort") return route.abort();
      return route.fulfill({ status: variant.status, contentType: "application/json", body: variant.body });
    });
    await page.goto(PAGE);
    await expect.poll(() => asked).toBe(true);
    await page.waitForTimeout(150);
    await expect(page.locator('[data-action="research-new"]'), JSON.stringify(variant)).toHaveCount(0);
    await expect(page.locator('[data-action="find"]')).toHaveText("Find Replacement");
    await expect(log(page)).toContainText("Tell me what item you're researching.");
  }
  expect(seen.researchPosts).toHaveLength(0);
  expect(seen.pageErrors).toEqual([]);
});

// ---- outage, quota, timeout and malformed responses --------------------------------------------------------------------------------

test("every failure state is a short, safe message from fixed copy, with the classic lookup only where it is a sensible alternative", async ({ page }) => {
  let scenario;
  const seen = await prepare(page, research(() => scenario));
  const html = { status: 502, body: "<html><body>Bad gateway at 10.0.0.5, stack trace secret</body></html>" };
  const cases = [
    [{ status: 429, body: researchError("RATE_LIMITED") }, /requests quickly/, false],
    [{ status: 429, body: researchError("QUOTA_EXCEEDED", { limit: 5, remaining: 0, charged: false }) }, /used today's free ItemAssist Research requests/, false],
    [{ status: 503, body: researchError("SERVICE_UNAVAILABLE") }, /temporarily unavailable/, true],
    [{ status: 503, body: researchError("CAPACITY_REACHED") }, /daily capacity/, true],
    [{ status: 503, body: researchError("API_DISABLED") }, /isn't available right now/, true],
    [{ status: 504, body: researchError("ENGINE_TIMEOUT") }, /took too long/, true],
    [{ status: 400, body: researchError("INVALID_REQUEST") }, /couldn't use that description/, false],
    [html, /couldn't complete that research/, true],
    [{ status: 200, body: "not json at all" }, /couldn't complete that research/, true],
    [{ status: 200, body: {} }, /couldn't complete that research/, true],
    [{ status: 200, body: { ...researchResponse(), contractVersion: "1" } }, /couldn't complete that research/, true],
    [{ status: 200, body: { ...researchResponse(), original: null } }, /couldn't complete that research/, true],
    [{ status: 200, body: { ...researchResponse(), status: "COMPLETE" } }, /couldn't complete that research/, true]
  ];
  for (const [reply, message, classic] of cases) {
    scenario = reply;
    await ready(page);
    await send(page, "LG C3 OLED TV");
    await expect(log(page).locator(".rf-msg--error")).toContainText(message);
    await expect(page.getByRole("button", { name: "Use classic lookup" })).toHaveCount(classic ? 1 : 0);
    await expect(page.locator("#rf-product-root .rf-report--research")).toHaveCount(0);
    expect(await page.locator("#rf-shell").innerText()).not.toMatch(/stack trace|10\.0\.0\.5|server text the page must not show/);
  }
  expect(seen.pageErrors).toEqual([]);
  expect(seen.analytics).toEqual([]);
});

test("a request that never answers times out with a calm message and offers the classic lookup", async ({ page }) => {
  const seen = await prepare(page, research(() => new Promise(() => {})));
  await page.clock.install();
  await ready(page);
  await send(page, "LG C3 OLED TV");
  await expect(log(page)).toContainText("Researching LG C3 OLED TV");
  await page.clock.fastForward(16000);
  await expect(log(page).locator(".rf-msg--error")).toContainText("That took too long to finish.");
  await expect(page.getByRole("button", { name: "Use classic lookup" })).toBeVisible();
  await expect(log(page).locator(".rf-msg--loading")).toHaveCount(0);
  await expect(page.getByLabel("Message ItemAssist")).toBeEnabled();
  expect(seen.pageErrors).toEqual([]);
});

// ---- candidates stay provisional ----------------------------------------------------------------------------------------------------

test("every candidate is labelled an unverified suggestion, and nothing reads as a confirmed match, price or availability", async ({ page }) => {
  const seen = await prepare(page, research(() => ok()));
  await ready(page);
  await send(page, "LG C3 OLED TV");
  await expect(page.locator("#rf-product-name")).toBeVisible();
  const product = page.locator("#rf-product-root");
  await expect(product.locator("#rf-rpanel-replacements .rf-rs-card")).toHaveCount(3); // the successor and two alternatives
  await expect(product.locator("#rf-rpanel-replacements .rf-pill", { hasText: "Unverified suggestion" })).toHaveCount(3);
  await expect(product.locator("#rf-rpanel-overview .rf-lead .rf-pill", { hasText: "Unverified suggestion" })).toHaveCount(1);
  await expect(product.locator("#rf-rpanel-replacements")).toContainText("research candidates, not confirmed equivalents");
  await expect(product.locator("#rf-rpanel-replacements")).toContainText("doesn't verify availability or price");
  await expect(log(page)).toContainText("hasn't been verified");
  // Every character on the page, including hidden panels. Only affirmative claims count: the page's own "not confirmed equivalents" is a disclaimer.
  const everything = (await page.evaluate(() => document.getElementById("rf-shell").textContent)).replace(/\bnot confirmed equivalents\b/gi, "");
  expect(/\$\s?\d|\bin stock\b|\bLKQ\b|like[- ]kind|certified|guaranteed|confirmed (?:match|equivalent)|verified (?:match|equivalent|lkq)|Unverified AI estimate/i.test(everything)).toBe(false);
  settle(seen);
});

// ---- 1024px: the narrowest two-pane layout ---------------------------------------------------------------------------------------------

test("at 1024px after research: new messages stay visible, the result is not scrolled away, the composer works, and nothing overflows sideways", async ({ page }) => {
  test.skip(page.viewportSize().width !== 1024, "this checks the 1024px layout specifically");
  const seen = await prepare(page, research(byQuery));
  await ready(page);
  await send(page, "LG C3 OLED TV");
  await expect(page.locator("#rf-product-name")).toBeVisible();

  const inView = async (locator) => locator.evaluate((node) => { const box = node.getBoundingClientRect(); return box.top >= 0 && box.bottom <= window.innerHeight + 1 && box.left >= 0 && box.right <= window.innerWidth + 1; });
  // The product pane is at the top of the page, with its identity in view (the page was not scrolled past it).
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(5);
  expect(await inView(page.locator("#rf-product-name"))).toBe(true);
  // The conversation scrolls inside its own pane: the newest reply is fully visible, directly above the composer.
  const summary = log(page).locator(".rf-msg--summary").last();
  await expect(summary).toBeInViewport({ ratio: 1 });
  const logBox = await log(page).boundingBox();
  const summaryBox = await summary.boundingBox();
  expect(summaryBox.y + summaryBox.height).toBeLessThanOrEqual(logBox.y + logBox.height + 1);
  // The composer is on screen and usable: type a follow-up, send it, and the new messages are still in view.
  const composer = page.locator("#rf-composer");
  expect(await inView(composer)).toBe(true);
  await send(page, "why is the successor conditional?");
  const last = log(page).locator(".rf-msg").last();
  await expect(last).toContainText("Direct successor line");
  await expect(last).toBeInViewport({ ratio: 1 });
  await expect(page.getByLabel("Message ItemAssist")).toBeEnabled();
  await expect(page.getByLabel("Message ItemAssist")).toHaveValue("");
  expect(await inView(composer)).toBe(true);
  // A different product: the right pane refreshes in place and the conversation scroller still shows the newest reply.
  await send(page, "Samsung QN55Q80C");
  await expect(page.locator("#rf-product-name")).toHaveText("Samsung Q80C 55-inch QLED TV");
  await expect(log(page).locator(".rf-msg--summary").last()).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(5);
  // Tabs work and one panel shows at a time.
  await page.locator("#rf-rtab-replacements").click();
  await expect(page.locator("#rf-rpanel-replacements")).toBeVisible();
  await expect(page.locator("#rf-rpanel-overview")).toBeHidden();
  await expectNoHorizontalOverflow(page);
  await expect(page.locator("#rf-composer")).toHaveCount(1);
  await expect(page.locator("#rf-assistant")).toHaveCount(1);
  await expect(page.locator("#rf-product")).toHaveCount(1);
  settle(seen);
});

// ---- demo data label ---------------------------------------------------------------------------------------------------------

const demoMeta = (extra = {}) => ({ requestId: "proxy-req-1", elapsedMs: 5, cached: false, answerSource: "AI_ESTIMATE", fixture: true, ...extra });

test("an answer the server marked as demo data shows a fixed 'Demo research data' label in the existing product pane; the layout is unchanged", async ({ page }) => {
  const seen = await prepare(page, research(() => ok(researchResponse({ meta: demoMeta({ label: "Totally real data", fixtureLabel: "x" }) }))));
  await ready(page);
  await send(page, "LG C3 OLED TV");
  const label = page.locator("#rf-product-root .rf-rs-demo");
  await expect(label).toHaveCount(1);
  await expect(label).toHaveText("Demo research data");
  await expect(label).toBeVisible();
  // Same structure as any other answer: one label, the status row still holds the AI-estimate pill, one composer, two panes, no overflow.
  await expect(page.locator("#rf-product-root .rf-status-row")).toContainText("AI estimate, not verified");
  await expect(page.locator("#rf-product-root")).not.toContainText("Totally real data");
  await expect(page.locator("#rf-composer")).toHaveCount(1);
  await expect(page.locator("#rf-assistant, #rf-product")).toHaveCount(2);
  await expectNoHorizontalOverflow(page);
  settle(seen);
});

test("a normal answer shows no demo label, and only the literal boolean true can produce one", async ({ page }) => {
  for (const meta of [{ cached: false }, { fixture: false }, { fixture: "true" }, { fixture: 1 }, { fixture: {} }]) {
    const seen = await prepare(page, research(() => ok(researchResponse({ meta: { requestId: "proxy-req-1", elapsedMs: 5, cached: false, answerSource: "AI_ESTIMATE", ...meta } }))));
    await ready(page);
    await send(page, "LG C3 OLED TV");
    await expect(page.locator("#rf-product-name")).toHaveText("LG C3 series 4K OLED smart TV");
    await expect(page.locator(".rf-rs-demo")).toHaveCount(0);
    await expect(page.locator("#rf-product-root")).not.toContainText("Demo research data");
    settle(seen);
  }
});
