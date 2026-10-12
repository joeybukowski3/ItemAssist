// Optional visual-review capture. Skipped unless RF_SCREENSHOT_DIR is set, so it never writes into the repository by default.
// Uses the same analytics-blocking `test` as every other spec in this suite.
const path = require("path");
const { test, contracts, errorBody, prepare, fillAndSubmit, PAGE } = require("./helpers.js");

const DIR = process.env.RF_SCREENSHOT_DIR;
test.skip(!DIR, "set RF_SCREENSHOT_DIR to capture screenshots");

const states = {
  initial: null,
  complete: { reply: () => ({ status: 200, body: contracts.engineComplete() }) },
  partial: { reply: () => ({ status: 200, body: contracts.enginePartial() }) },
  best: { reply: () => ({ status: 200, body: contracts.engineBestAvailable() }) },
  unsupported: { reply: () => ({ status: 422, body: errorBody("UNSUPPORTED") }) },
  error: { reply: () => ({ status: 429, body: errorBody("RATE_LIMITED") }) },
  loading: { reply: () => ({ status: 200, body: contracts.engineComplete(), delayMs: 4000 }) }
};

for (const [name, options] of Object.entries(states)) {
  test(`screenshot: ${name}`, async ({ page }, testInfo) => {
    await prepare(page, options || {});
    await page.goto(PAGE);
    if (options) await fillAndSubmit(page, { notes: "Reusing existing wall mount" });
    if (name === "loading") await page.locator("#rf-loading-h").waitFor();
    else if (options) await page.locator("#rf-results").locator("h2, h3").first().waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(DIR, `${name}-${testInfo.project.name}.png`), fullPage: true });
  });
}
