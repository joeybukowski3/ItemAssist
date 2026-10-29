// The repository's analytics-blocking fixture: every test imports `test` from here, so no browser context can send
// Google Analytics or Tag Manager traffic. Do not replace this with the plain @playwright/test `test`.
const { test, expect, isAnalyticsRequestUrl } = require("../../request-intake/e2e/fixtures.js");
const contracts = require("../fixtures/contracts.js");

const PAGE = "/replacement-finder.html";
const API = "**/api/replacement-finder";

const errorBody = (errorCode, status = errorCode === "UNSUPPORTED" ? "UNSUPPORTED" : "ERROR") => ({
  contractVersion: "1", status, errorCode, message: "server text the page must not show", requestId: "proxy-req-1"
});

/**
 * Mocks the same-origin proxy. `reply` receives the parsed POST body and returns { status, body, delayMs } (or "abort").
 * Fonts are stubbed so an offline run has no failed requests, and every request/console problem is collected.
 */
async function prepare(page, { enabled = true, reply = () => ({ status: 200, body: contracts.engineComplete() }), research = null } = {}) {
  const seen = { posts: [], researchPosts: [], consoleErrors: [], pageErrors: [], analytics: [], failedApi: 0 };

  // A mocked non-2xx API reply makes the browser log "Failed to load resource" for that URL. That is expected; the same message for any other URL is a real problem.
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (message.location().url.endsWith("/api/replacement-finder") || message.location().url.endsWith("/api/itemassist-research")) return;
    seen.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => seen.pageErrors.push(error.message));
  page.context().on("request", (request) => { if (isAnalyticsRequestUrl(request.url())) seen.analytics.push(request.url()); });

  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
  // ItemAssist Research route. By default it reports itself disabled, so the page is the classic lookup; `research: { reply }` enables it.
  // `reply` receives the parsed POST body and returns { status, body, delayMs } (or "abort").
  await page.route("**/api/itemassist-research", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: Boolean(research), dailyLimit: 5 }) });
      return;
    }
    const body = request.postDataJSON();
    seen.researchPosts.push({ body, headers: request.headers() });
    const response = research ? await research.reply(body) : { status: 503, body: { status: "ERROR", errorCode: "API_DISABLED" } };
    if (response === "abort") { seen.failedApi += 1; await route.abort(); return; }
    if (response.delayMs) await new Promise((resolve) => setTimeout(resolve, response.delayMs));
    await route.fulfill({ status: response.status, contentType: "application/json", body: typeof response.body === "string" ? response.body : JSON.stringify(response.body) });
  });
  await page.route(API, async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled }) });
      return;
    }
    const body = request.postDataJSON();
    seen.posts.push(body);
    const response = await reply(body);
    if (response === "abort") { seen.failedApi += 1; await route.abort(); return; }
    if (response.delayMs) await new Promise((resolve) => setTimeout(resolve, response.delayMs));
    await route.fulfill({
      status: response.status, contentType: "application/json",
      body: typeof response.body === "string" ? response.body : JSON.stringify(response.body)
    });
  });
  return seen;
}

/** Opens the structured "Find a replacement" prompt from the quick action. */
async function openPrompt(page) {
  await page.locator('[data-action="find"]').click();
  await page.locator("#rf-model").waitFor();
}

/** The old form flow, through the workspace: open the prompt, fill it, submit. */
async function fillAndSubmit(page, { model = "QN55Q80C", notes = "" } = {}) {
  if (!(await page.locator("#rf-ask").count())) await openPrompt(page);
  await page.locator("#rf-model").fill(model);
  if (notes) await page.locator("#rf-notes").fill(notes);
  await page.locator("#rf-submit").click();
}

/** Runs a full lookup against a mocked contract and waits for the report. */
async function runLookup(page, options = {}) {
  await fillAndSubmit(page, options);
  await page.locator("#rf-product-name").waitFor();
}

// Keep in step with NARROW_QUERY in replacement-finder.js: at or below this width the workspace is one continuous page.
const NARROW_MAX = 960;
const isNarrowViewport = (page) => page.viewportSize().width <= NARROW_MAX;

const PANEL_IDS = { Overview: "overview", Specifications: "specs", Replacement: "replacement", Pricing: "pricing", Evidence: "evidence" };
const panelLocator = (page, name) => page.locator(`#rf-panel-${PANEL_IDS[name]}`);

/** The tab control for a section. Beside the assistant it is a tab; on the single page it is a jump link (same element, no role). */
const tabControl = (page, name) => page.locator(`#rf-tab-${PANEL_IDS[name]}`);

/** Selects a section: switches tab beside the assistant, jumps to it on the single page. Returns that section's panel. */
async function openTab(page, name) {
  await tabControl(page, name).click();
  return panelLocator(page, name);
}

/**
 * True when a jump has landed on `locator`: its top is at or below the sticky bar and in the upper half of the screen.
 * The last section may be shorter than the screen, in which case the page simply ends before it reaches the top.
 */
async function isLanded(page, locator) {
  return locator.evaluate((node) => {
    const bar = document.querySelector(".rf-bar").getBoundingClientRect().bottom;
    const top = node.getBoundingClientRect().top;
    const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    return top >= bar - 1 && (top < window.innerHeight * 0.5 || (atEnd && top < window.innerHeight));
  });
}

async function expectNoHorizontalOverflow(page) {
  const { scrollWidth, clientWidth, offenders } = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    // body has overflow-x hidden in styles.css, so also check that no rendered element pokes past the viewport.
    const wide = [...document.querySelectorAll("body *")]
      .filter((element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.right > width + 1 && !element.closest(".rf-visually-hidden, .form-honeypot, .rf-sprite, .skip-link, thead, .rf-tablist, .rf-quick"); })
      .map((element) => `${element.tagName.toLowerCase()}.${element.className}`);
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth: width, offenders: wide.slice(0, 5) };
  });
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  expect(offenders).toEqual([]);
}

module.exports = {
  test, expect, contracts, errorBody, prepare, openPrompt, fillAndSubmit, runLookup, openTab, tabControl, panelLocator, isLanded,
  isNarrowViewport, NARROW_MAX, expectNoHorizontalOverflow, PAGE
};
