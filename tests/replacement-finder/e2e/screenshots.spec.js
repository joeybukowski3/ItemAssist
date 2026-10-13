// Optional visual-review capture. Skipped unless RF_SCREENSHOT_DIR is set, so it never writes into the repository by default.
// Uses the same analytics-blocking `test` as every other spec in this suite and only mocked contracts: no provider is contacted.
//
// File names: <state>-<project>.png is the whole page; <state>-<project>-view.png is what fits on one screen.
// Beside the assistant (wide) the tabs show one panel at a time, so each tab is captured; on the single page (narrow) every section is
// already on the page, so the whole-page capture covers them and the -view captures show where each jump link lands, what a deep scroll
// looks like with the composer pinned, and the end of the page.
const path = require("path");
const { test, contracts, errorBody, prepare, fillAndSubmit, runLookup, openPrompt, openTab, tabControl, isNarrowViewport, PAGE } = require("./helpers.js");

const DIR = process.env.RF_SCREENSHOT_DIR;
test.skip(!DIR, "set RF_SCREENSHOT_DIR to capture screenshots");

const TABS = ["Overview", "Specifications", "Replacement", "Pricing", "Evidence"];
const reply = (body, status = 200, delayMs = 0) => ({ reply: () => ({ status, body, delayMs }) });
const file = (testInfo, name, suffix = "") => path.join(DIR, `${name}-${testInfo.project.name}${suffix}.png`);

const snap = async (page, testInfo, name, { view = false } = {}) => {
  await page.waitForTimeout(view ? 1300 : 350); // smooth scrolling settles
  if (view) {
    await page.screenshot({ path: file(testInfo, name, "-view") });
    return;
  }
  // The bars are sticky and the composer is pinned, so a whole-page capture taken while scrolled would draw them mid-page.
  // Capture from the top, and on the single page give the viewport the page's own height so the composer sits at the true end.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  const size = page.viewportSize();
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  if (isNarrowViewport(page) && height > size.height) {
    await page.setViewportSize({ width: size.width, height });
    await page.waitForTimeout(250);
    await page.screenshot({ path: file(testInfo, name) });
    await page.setViewportSize(size);
    await page.waitForTimeout(150);
    return;
  }
  await page.screenshot({ path: file(testInfo, name), fullPage: true });
};

const scrollTo = (page, y) => page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);

test("screenshot: initial and prompt", async ({ page }, testInfo) => {
  await prepare(page);
  await page.goto(PAGE);
  await snap(page, testInfo, "01-initial");
  await snap(page, testInfo, "01-initial", { view: true });
  await openPrompt(page);
  await page.locator("#rf-model").fill("QN55Q80C");
  await snap(page, testInfo, "03-prompt");
  await snap(page, testInfo, "03-prompt", { view: true });
});

test("screenshot: loading", async ({ page }, testInfo) => {
  await prepare(page, reply(contracts.engineComplete(), 200, 6000));
  await page.goto(PAGE);
  await fillAndSubmit(page);
  await page.locator("#rf-loading-h").waitFor();
  await snap(page, testInfo, "04-loading");
  await snap(page, testInfo, "04-loading", { view: true });
});

const REPORTS = {
  "best-available": contracts.engineBestAvailableUnconfirmed(),
  recommended: contracts.engineComplete(),
  partial: contracts.enginePartial(),
  "no-retail": contracts.engineNoRetailReplacement(),
  "no-result": contracts.engineNoResult()
};
for (const [name, body] of Object.entries(REPORTS)) {
  test(`screenshot: ${name}`, async ({ page }, testInfo) => {
    await prepare(page, reply(body));
    await page.goto(PAGE);
    await runLookup(page, { notes: "Reusing existing wall mount" });
    await snap(page, testInfo, `10-${name}-after-lookup`, { view: true });
    if (isNarrowViewport(page)) {
      await snap(page, testInfo, `10-${name}`);
      if (name === "best-available") {
        for (const tab of TABS.slice(1)) {
          await tabControl(page, tab).click();
          await snap(page, testInfo, `12-${name}-jump-${tab.toLowerCase()}`, { view: true });
        }
        // Deep in the results the composer is still pinned and the section row still sits under the bar.
        await tabControl(page, "Replacement").click();
        await page.waitForTimeout(1300);
        await scrollTo(page, await page.evaluate(() => window.scrollY + 260));
        await snap(page, testInfo, `13-${name}-deep-scroll`, { view: true });
        // The very end of the page: the last content stops above the composer.
        await scrollTo(page, await page.evaluate(() => document.documentElement.scrollHeight));
        await snap(page, testInfo, `14-${name}-page-end`, { view: true });
        // The folded conversation, opened.
        await scrollTo(page, 0);
        await page.locator("#rf-convo-toggle").click();
        await snap(page, testInfo, `15-${name}-conversation-open`, { view: true });
      }
      return;
    }
    const tabs = name === "best-available" ? TABS : ["Overview", "Replacement"];
    for (const tab of tabs) {
      await openTab(page, tab);
      await snap(page, testInfo, `10-${name}-${tab.toLowerCase()}`);
    }
  });
}

test("screenshot: unsupported and error", async ({ page }, testInfo) => {
  await prepare(page, reply(errorBody("UNSUPPORTED"), 422));
  await page.goto(PAGE);
  await fillAndSubmit(page);
  await page.getByText("I couldn't match").waitFor();
  await snap(page, testInfo, "20-unsupported");
});

test("screenshot: error", async ({ page }, testInfo) => {
  await prepare(page, reply(errorBody("RATE_LIMITED"), 429));
  await page.goto(PAGE);
  await fillAndSubmit(page);
  await page.getByRole("alert").waitFor();
  await snap(page, testInfo, "21-error");
  await snap(page, testInfo, "21-error", { view: true });
});
