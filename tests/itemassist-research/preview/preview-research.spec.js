// P1: the hosted ItemAssist Preview, reviewed with browser-level mocks. Zero backend, Redis or provider calls:
//  - every /api/itemassist-research and /api/replacement-finder call is answered by a mock in the browser;
//  - any other /api call is refused and fails the test (the `unmocked` list);
//  - the deployed Preview keeps research DISABLED. The research UI is switched on only by the mocked status response.
// The Deployment Protection bypass secret (VERCEL_AUTOMATION_BYPASS_SECRET) is read here only, sent only to the Preview origin, and never
// logged, put in a URL, or recorded (traces are off in the config).
const { test: base, expect, contracts, prepare, isNarrowViewport, expectNoHorizontalOverflow } = require("../../replacement-finder/e2e/helpers.js");
const { researchResponse, researchError } = require("../fixtures/research.js");
const { resolvePreviewTarget } = require("./preview-target.js");

const target = resolvePreviewTarget();
const PAGE = "/replacement-finder";
const BYPASS = "VERCEL_AUTOMATION_BYPASS_SECRET";

const test = base.extend({
  // Gets this browser context past Vercel Deployment Protection: one request to the Preview origin sets the bypass cookie.
  protectionBypass: [async ({ context }, use) => {
    if (!target.local) {
      const secret = process.env[BYPASS];
      if (secret) {
        const response = await context.request.get(PAGE, { headers: { "x-vercel-protection-bypass": secret, "x-vercel-set-bypass-cookie": "true" } });
        if (!response.ok()) throw new Error(`Deployment Protection bypass failed (HTTP ${response.status()}). Check that ${BYPASS} is this project's automation bypass secret.`);
      } else {
        const probe = await context.request.get(PAGE);
        if (!probe.ok()) throw new Error(`The Preview answered HTTP ${probe.status()}. If it is protected by Vercel Deployment Protection, set ${BYPASS}.`);
      }
    }
    await use();
  }, { auto: true }]
});

const ok = (body = researchResponse()) => ({ status: 200, body });
const log = (page) => page.locator("#rf-log");
const ready = async (page) => { await page.goto(PAGE); await expect(page.locator('[data-action="research-new"]')).toBeVisible(); };

async function send(page, text) {
  const input = page.getByLabel("Message ItemAssist");
  await input.fill(text);
  await input.press("Enter");
}

/**
 * The mocked workspace. A catch-all refuses every /api call first; `prepare` then registers the research and classic mocks, which take
 * precedence (the last registered route wins). Vercel's preview toolbar hosts are answered with empty files so they cannot add noise.
 */
async function mockedWorkspace(page, research) {
  const unmocked = [];
  await page.route("**/api/**", (route) => { unmocked.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`); return route.abort(); });
  await page.route(/^https:\/\/(?:vercel\.live|[^/]*vercel-scripts\.com)\//, (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  const seen = await prepare(page, { research, reply: () => ({ status: 200, body: contracts.engineComplete() }) });
  seen.unmocked = unmocked;
  return seen;
}

const settle = (seen) => {
  expect(seen.unmocked, "no API call outside the mocks").toEqual([]);
  expect(seen.consoleErrors).toEqual([]);
  expect(seen.pageErrors).toEqual([]);
  expect(seen.analytics).toEqual([]);
};

// ---- the deployed Preview itself ------------------------------------------------------------------------------------------------------

test("the deployed Preview is untouched: its own status says research is OFF, the research assets are served, and it loads as the classic workspace", async ({ page }) => {
  test.skip(target.local, "needs the hosted Preview (the local static server has no API)");
  const unmocked = [];
  const classicSeen = { consoleErrors: [], pageErrors: [] };
  page.on("console", (message) => { if (message.type() === "error" && !/\/api\//.test(message.location().url)) classicSeen.consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => classicSeen.pageErrors.push(error.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await page.route(/^https:\/\/(?:vercel\.live|[^/]*vercel-scripts\.com)\//, (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  // Only the two status checks (GET, environment only: no Redis, engine or provider) reach the deployment; anything else is refused.
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && (path === "/api/itemassist-research" || path === "/api/replacement-finder")) return route.continue();
    unmocked.push(`${request.method()} ${path}`);
    return route.abort();
  });

  const response = await page.goto(PAGE);
  expect(response.status()).toBe(200);
  expect(response.headers()["x-robots-tag"]).toMatch(/noindex/);
  await expect(log(page)).toContainText("Tell me what item you're researching. You can start with a brand and model number.");
  await expect(page.locator('[data-action="research-new"]')).toHaveCount(0);
  await expect(page.locator('[data-action="find"]')).toHaveText("Find Replacement");
  expect(await page.evaluate(() => [typeof window.RFResearch, typeof window.RFResearchView])).toEqual(["object", "object"]);

  const status = await page.request.get("/api/itemassist-research", { headers: { Accept: "application/json" } });
  expect(status.status()).toBe(200);
  expect(await status.json()).toEqual({ enabled: false, dailyLimit: 5 });
  expect(status.headers()["cache-control"]).toMatch(/no-store/);
  expect(unmocked).toEqual([]);
  expect(classicSeen.consoleErrors).toEqual([]);
  expect(classicSeen.pageErrors).toEqual([]);
});

test("?research=0 keeps the classic workspace even when the (mocked) status says research is enabled", async ({ page }) => {
  const seen = await mockedWorkspace(page, { reply: () => ok() });
  await page.goto(`${PAGE}?research=0`);
  await expect(page.locator('[data-action="find"]')).toHaveText("Find Replacement");
  await expect(page.locator('[data-action="research-new"]')).toHaveCount(0);
  settle(seen);
});

// ---- research, enabled only by the mocked status response -------------------------------------------------------------------------------

test("first research result: the conversation answers on the left, Product Intelligence fills on the right, every candidate is provisional", async ({ page }) => {
  const seen = await mockedWorkspace(page, { reply: () => ok() });
  await ready(page);
  await expect(log(page)).toContainText("Describe the item you're replacing");
  await send(page, "LG C3 OLED TV");
  await expect(page.locator("#rf-product-name")).toHaveText("LG C3 series 4K OLED smart TV");

  expect(seen.researchPosts).toHaveLength(1);
  expect(seen.researchPosts[0].body).toEqual({ query: "LG C3 OLED TV", website: "" });
  expect(seen.researchPosts[0].headers["x-visitor-id"]).toMatch(/^[A-Za-z0-9_-]{16,64}$/);

  // Left: the conversation, with the clarifying question and what is left today.
  await expect(log(page)).toContainText("This looks like LG C3 series 4K OLED smart TV.");
  await expect(log(page)).toContainText("Closest successor to consider: LG C-series OLED, next generation");
  await expect(log(page)).toContainText("Which screen size do you have?");
  await expect(log(page)).toContainText("4 of 5 free research requests left today.");

  // Right: the banner, the successor candidate and the alternatives.
  const product = page.locator("#rf-product-root");
  await expect(product.locator(".rf-rs-banner .rf-partial-title")).toHaveText("AI Research Summary");
  await expect(product.locator(".rf-rs-banner")).toContainText("preliminary and not independently verified");
  const overview = product.locator("#rf-rpanel-overview");
  await expect(overview.locator(".rf-lead-name")).toHaveText("LG C-series OLED, next generation");
  await expect(overview).toContainText("Biggest difference: Brighter panel, newer processor");
  await expect(overview).toContainText("Concern: Fewer HDMI 2.1 ports in some sizes");
  await expect(overview.locator(".rf-rs-alts li")).toHaveCount(2);
  await expect(overview).toContainText("Samsung S90 series QD-OLED");
  await expect(overview).toContainText("Sony Bravia 8 OLED");
  await expect(overview).toContainText("Which screen size do you have?"); // the open question is also listed under "Still to confirm"

  if (!isNarrowViewport(page)) {
    await page.locator("#rf-rtab-replacements").click();
    await expect(product.locator("#rf-rpanel-replacements .rf-rs-card")).toHaveCount(3);
  }
  await expect(product.locator("#rf-rpanel-replacements .rf-rs-card")).toHaveCount(3);
  await expect(product.locator("#rf-rpanel-replacements .rf-pill", { hasText: "Unverified suggestion" })).toHaveCount(3);
  await expect(product.locator("#rf-rpanel-replacements")).toContainText("How it differs: Different smart platform.");

  const text = (await page.evaluate(() => document.getElementById("rf-shell").textContent)).replace(/\bnot confirmed equivalents\b/gi, "");
  expect(/\$\s?\d|\bin stock\b|\bLKQ\b|like[- ]kind|certified|guaranteed|confirmed (?:match|equivalent)|Unverified AI estimate|Quick AI Estimate/i.test(text)).toBe(false);
  settle(seen);
});

test("clarification: answering the question refines the same research, the right pane refreshes, the conversation is kept", async ({ page }) => {
  let calls = 0;
  const seen = await mockedWorkspace(page, {
    reply: () => {
      calls += 1;
      return ok(calls === 1 ? researchResponse() : researchResponse({
        original: { identity: "LG C3 65-inch OLED evo TV", confidence: "HIGH", characteristics: ["65-inch OLED", "4K", "120 Hz"], uncertainty: null },
        clarify: [], quota: { limit: 5, remaining: 3, charged: true }
      }));
    }
  });
  await ready(page);
  await send(page, "LG C3 OLED TV");
  await expect(page.locator("#rf-product-name")).toHaveText("LG C3 series 4K OLED smart TV");
  await expect(log(page)).toContainText("Which screen size do you have?");
  await send(page, "65 inch");
  await expect(page.locator("#rf-product-name")).toHaveText("LG C3 65-inch OLED evo TV");
  expect(seen.researchPosts.map((post) => post.body.query)).toEqual(["LG C3 OLED TV", "LG C3 OLED TV, 65 inch"]);
  await expect(log(page).locator(".rf-msg--user")).toHaveCount(2);
  await expect(log(page)).toContainText("3 of 5 free research requests left today.");
  await expect(page.locator("#rf-composer")).toHaveCount(1);
  settle(seen);
});

// ---- layout at each width -------------------------------------------------------------------------------------------------------------

test("layout: two panes beside each other on wide screens, one continuous page on mobile; one composer, no sideways overflow", async ({ page }) => {
  const seen = await mockedWorkspace(page, { reply: () => ok() });
  await ready(page);
  await send(page, "LG C3 OLED TV");
  await expect(page.locator("#rf-product-name")).toBeVisible();
  await expect(page.locator("#rf-composer")).toHaveCount(1);
  await expect(page.locator("#rf-assistant")).toHaveCount(1);
  await expect(page.locator("#rf-product")).toHaveCount(1);
  await expect(page.locator("textarea")).toHaveCount(1);
  const viewport = page.viewportSize();
  const inView = (locator) => locator.evaluate((node) => { const box = node.getBoundingClientRect(); return box.top >= 0 && box.bottom <= window.innerHeight + 1 && box.left >= 0 && box.right <= window.innerWidth + 1; });

  if (!isNarrowViewport(page)) {
    const [left, right] = await Promise.all([page.locator("#rf-assistant").boundingBox(), page.locator("#rf-product").boundingBox()]);
    expect(left.x).toBeLessThan(right.x);
    expect(Math.abs(left.y - right.y)).toBeLessThan(80);
    const ratio = left.width / (left.width + right.width);
    expect(ratio).toBeGreaterThan(0.33);
    expect(ratio).toBeLessThan(0.43);
    // The newest reply and the composer are on screen, and the page was not scrolled past the result.
    await expect(log(page).locator(".rf-msg--summary").last()).toBeInViewport({ ratio: 1 });
    expect(await inView(page.locator("#rf-composer"))).toBe(true);
    expect(await inView(page.locator("#rf-product-name"))).toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(5);
    await send(page, "why is the successor conditional?");
    await expect(log(page).locator(".rf-msg").last()).toContainText("Direct successor line");
    await expect(log(page).locator(".rf-msg").last()).toBeInViewport({ ratio: 1 });
    expect(await inView(page.locator("#rf-composer"))).toBe(true);
    await page.locator("#rf-rtab-requirements").click();
    await expect(page.locator("#rf-rpanel-requirements li")).toHaveCount(5);
    await expect(page.locator("#rf-rpanel-overview")).toBeHidden();
  } else {
    // One page: the sections are stacked, the tab row is not needed, and the composer is pinned to the bottom of the screen.
    await expect(page.locator("#rf-product-root .rf-tabbar")).toBeHidden();
    for (const name of ["overview", "original", "requirements", "replacements"]) await expect(page.locator(`#rf-rpanel-${name}`)).toBeVisible();
    const composer = await page.locator("#rf-composer").boundingBox();
    expect(composer.y + composer.height).toBeGreaterThan(viewport.height - 4);
    expect(composer.y + composer.height).toBeLessThanOrEqual(viewport.height + 1);
    await expect(page.getByLabel("Message ItemAssist")).toBeEnabled();
  }
  await expectNoHorizontalOverflow(page);
  settle(seen);
});

// ---- classic fallback --------------------------------------------------------------------------------------------------------------------

test("classic fallback: the Classic lookup chip opens the structured form and its report replaces the research view", async ({ page }) => {
  const seen = await mockedWorkspace(page, { reply: () => ok() });
  await ready(page);
  await send(page, "LG C3 OLED TV");
  await expect(page.locator("#rf-product-root .rf-report--research")).toHaveCount(1);
  await page.locator('[data-action="find"]').click();
  await page.locator("#rf-model").fill("QN55Q80C");
  await page.locator("#rf-submit").click();
  await expect(page.locator("#rf-product-root .rf-report--research")).toHaveCount(0);
  await expect(page.locator("#rf-product-name")).toBeVisible();
  expect(seen.posts).toHaveLength(1);
  expect(seen.posts[0]).toMatchObject({ category: "television", brand: "Samsung", model: "QN55Q80C" });
  expect(seen.researchPosts).toHaveLength(1);
  settle(seen);
});

test("classic fallback after a research failure: the message is fixed copy and 'Use classic lookup' opens the form", async ({ page }) => {
  const seen = await mockedWorkspace(page, { reply: () => ({ status: 503, body: researchError("SERVICE_UNAVAILABLE") }) });
  await ready(page);
  await send(page, "LG C3 OLED TV");
  await expect(log(page).locator(".rf-msg--error")).toContainText("temporarily unavailable");
  await expect(log(page)).not.toContainText("server text the page must not show");
  await page.getByRole("button", { name: "Use classic lookup" }).click();
  await expect(page.locator("#rf-model")).toBeVisible();
  expect(seen.researchPosts).toHaveLength(1);
  expect(seen.posts).toHaveLength(0);
  settle(seen);
});
