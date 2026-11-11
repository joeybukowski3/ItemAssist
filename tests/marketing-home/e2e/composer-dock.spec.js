// On narrow layouts the research composer is pinned to the bottom of the screen and the contact form sits below the workspace.
// The composer must always be there for research, and may step aside only while the contact form is in use or the whole workspace is off screen.
const { test, expect, stubSite, horizontalOverflow } = require("./helpers.js");

const NARROW_MAX = 960;
const isNarrow = (page) => page.viewportSize().width <= NARROW_MAX;
const state = (page) => page.evaluate(() => {
  const shell = document.getElementById("rf-shell").getBoundingClientRect();
  const composer = document.getElementById("rf-composer");
  return {
    active: document.body.classList.contains("rf-contact-active"),
    workspaceOffScreen: shell.bottom <= 0 || shell.top >= window.innerHeight,
    composerVisibility: getComputedStyle(composer).visibility,
    composerPosition: getComputedStyle(composer).position
  };
});
const scrollTo = (page, y) => page.evaluate((top) => window.scrollTo(0, top), y);
const maxScroll = (page) => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);

test("the research composer is visible and accepts text on first load at every width", async ({ page }) => {
  await stubSite(page);
  await page.goto("/");
  const input = page.getByLabel("Message ItemAssist");
  await expect(input).toBeVisible();
  await expect(page.locator("#rf-composer")).toBeInViewport();
  await input.fill("Samsung RF32CG5300SR");
  await expect(input).toHaveValue("Samsung RF32CG5300SR");
  await expect(page.locator("body")).not.toHaveClass(/rf-contact-active/);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test("on narrow screens the composer stays while any of the workspace is on screen, even with the contact section beside it", async ({ page }) => {
  test.skip(!isNarrow(page), "the composer is only pinned on narrow layouts");
  await stubSite(page);
  await page.goto("/");
  const top = await page.evaluate(() => Math.round(document.getElementById("contact").getBoundingClientRect().top));
  // Scroll until the contact section starts a quarter of the way down the screen, while the workspace is still partly visible.
  const target = Math.max(0, top - Math.round((await page.viewportSize()).height / 4));
  await scrollTo(page, Math.min(target, await maxScroll(page)));
  const now = await state(page);
  if (!now.workspaceOffScreen) {
    expect(now.active).toBe(false);
    await expect(page.getByLabel("Message ItemAssist")).toBeVisible();
  }
});

test("on narrow screens the composer steps aside for the contact form and returns when the visitor goes back to research", async ({ page }) => {
  test.skip(!isNarrow(page), "the composer is only pinned on narrow layouts");
  await stubSite(page);
  await page.goto("/");
  await page.locator("#consult-name").focus();
  await expect(page.locator("body")).toHaveClass(/rf-contact-active/);
  await expect(page.locator("#rf-composer")).toBeHidden();
  // Moving between the form's fields keeps it aside.
  await page.keyboard.press("Tab");
  await expect(page.locator("#consult-email")).toBeFocused();
  await expect(page.locator("#rf-composer")).toBeHidden();
  // Back to research: the composer is usable again.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator("#consult-email").evaluate((element) => element.blur());
  await expect(page.locator("body")).not.toHaveClass(/rf-contact-active/);
  await expect(page.getByLabel("Message ItemAssist")).toBeVisible();
  await page.getByLabel("Message ItemAssist").fill("LG C3 OLED");
  await expect(page.getByLabel("Message ItemAssist")).toHaveValue("LG C3 OLED");
});

test("on narrow screens the composer is hidden exactly when the workspace is off screen (or the form is in use), at every scroll position", async ({ page }) => {
  test.skip(!isNarrow(page), "the composer is only pinned on narrow layouts");
  await stubSite(page);
  await page.goto("/");
  const end = await maxScroll(page);
  for (const y of [0, Math.round(end / 4), Math.round(end / 2), Math.round((3 * end) / 4), end, 0]) {
    await scrollTo(page, y);
    await expect.poll(async () => {
      const s = await state(page);
      return s.active === s.workspaceOffScreen && (s.active ? s.composerVisibility === "hidden" : s.composerVisibility === "visible");
    }, { message: `scroll position ${y}`, timeout: 4000 }).toBe(true);
  }
});

test("on narrow screens the end of the page clears the composer: the footer links are reachable", async ({ page }) => {
  test.skip(!isNarrow(page), "the composer is only pinned on narrow layouts");
  await stubSite(page);
  await page.goto("/");
  await scrollTo(page, await maxScroll(page));
  const covered = await page.evaluate(() => [...document.querySelectorAll(".rf-foot a")].map((link) => {
    const r = link.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit === link || link.contains(hit);
  }));
  expect(covered).toEqual([true, true]);
  await expect(page.locator('.rf-foot a[href="/privacy"]')).toBeInViewport();
});

test("on wide screens the composer lives in the assistant pane and is never hidden by the contact section", async ({ page }) => {
  test.skip(isNarrow(page), "wide layouts only");
  await stubSite(page);
  await page.goto("/");
  await scrollTo(page, await maxScroll(page));
  const s = await state(page);
  expect(s.composerPosition).not.toBe("fixed");
  expect(s.composerVisibility).toBe("visible");
});
