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
async function prepare(page, { enabled = true, reply = () => ({ status: 200, body: contracts.engineComplete() }) } = {}) {
  const seen = { posts: [], consoleErrors: [], pageErrors: [], analytics: [], failedApi: 0 };

  // A mocked non-2xx API reply makes the browser log "Failed to load resource" for that URL. That is expected; the same message for any other URL is a real problem.
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (message.location().url.endsWith("/api/replacement-finder")) return;
    seen.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => seen.pageErrors.push(error.message));
  page.context().on("request", (request) => { if (isAnalyticsRequestUrl(request.url())) seen.analytics.push(request.url()); });

  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
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

async function fillAndSubmit(page, { model = "QN55Q80C", notes = "" } = {}) {
  await page.locator("#rf-model").fill(model);
  if (notes) await page.locator("#rf-notes").fill(notes);
  await page.locator("#rf-submit").click();
}

async function expectNoHorizontalOverflow(page) {
  const { scrollWidth, clientWidth, offenders } = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    // body has overflow-x hidden in styles.css, so also check that no rendered element pokes past the viewport.
    const wide = [...document.querySelectorAll("body *")]
      .filter((element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.right > width + 1 && !element.closest(".rf-visually-hidden, .form-honeypot, .rf-sprite, .skip-link, thead"); })
      .map((element) => `${element.tagName.toLowerCase()}.${element.className}`);
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth: width, offenders: wide.slice(0, 5) };
  });
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  expect(offenders).toEqual([]);
}

module.exports = { test, expect, contracts, errorBody, prepare, fillAndSubmit, expectNoHorizontalOverflow, PAGE };
