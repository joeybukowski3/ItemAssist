const { test, expect } = require("./fixtures.js");
const { stubTurnstileAndApi } = require("./helpers.js");

test("page has no horizontal overflow at this viewport", async ({ page }) => {
  await stubTurnstileAndApi(page);
  await page.goto("/request-age-verification.html");

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));

  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
});

test("header and footer render at this viewport", async ({ page }) => {
  await stubTurnstileAndApi(page);
  await page.goto("/request-age-verification.html");

  await expect(page.locator("nav .logo")).toBeVisible();
  await expect(page.locator("footer")).toBeVisible();
});

test("mobile nav toggle opens and closes the menu on narrow viewports", async ({ page }, testInfo) => {
  const isNarrow = testInfo.project.use.viewport.width <= 900;
  test.skip(!isNarrow, "Nav toggle only applies below the mobile breakpoint.");

  await stubTurnstileAndApi(page);
  await page.goto("/request-age-verification.html");

  const toggle = page.locator(".nav-toggle");
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("the comparison table stays inside a horizontally scrollable wrapper instead of overflowing the page", async ({ page }) => {
  await stubTurnstileAndApi(page);
  await page.goto("/request-age-verification.html");

  const wrap = page.locator(".avr-table-wrap");
  await expect(wrap).toBeVisible();

  const overflowX = await wrap.evaluate((el) => getComputedStyle(el).overflowX);
  expect(["auto", "scroll"]).toContain(overflowX);

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
});

test("item cards and buttons remain visible and tappable at this viewport", async ({ page }) => {
  await stubTurnstileAndApi(page);
  await page.goto("/request-age-verification.html");
  await page.check("#avr-method-enter_items_now");

  const addButton = page.locator("#avr-add-item");
  await expect(addButton).toBeVisible();

  const box = await addButton.boundingBox();
  expect(box).not.toBeNull();
  expect(box.height).toBeGreaterThanOrEqual(32);
});
