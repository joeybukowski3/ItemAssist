// Layout checks at the in-between widths around the 960px switch from one continuous page to two panes side by side.
// Viewport is set per test, so this runs once (desktop project) instead of once per project.
// Set RF_SCREENSHOT_DIR to also capture each width.
const path = require("path");
const { test, expect, contracts, prepare, runLookup, openTab, tabControl, panelLocator, isLanded, expectNoHorizontalOverflow, NARROW_MAX, PAGE } = require("./helpers.js");

const WIDTHS = [375, 390, 520, 768, 900, 960, 961, 1000, 1024, 1100, 1280];
const TABLE_MIN_PANE = 560;
const SECTIONS = ["Overview", "Specifications", "Replacement", "Pricing", "Evidence"];

for (const width of WIDTHS) {
  test(`layout @${width}px: panes, bar, tabs and comparison stay clean`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1280", "viewport is set explicitly; run once");
    const seen = await prepare(page, { reply: () => ({ status: 200, body: contracts.engineBestAvailableUnconfirmed() }) });
    await page.setViewportSize({ width, height: 900 });
    await page.goto(PAGE);
    await runLookup(page, { notes: "Reusing existing wall mount" });

    const m = await page.evaluate(() => {
      const box = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top + window.scrollY, bottom: r.bottom + window.scrollY, width: r.width, height: r.height }; };
      const bar = document.querySelector(".rf-bar");
      const label = document.querySelector(".rf-bar-label");
      return {
        bar: box(".rf-bar"), labelOverflow: label.scrollWidth > label.clientWidth, barSticky: getComputedStyle(bar).position,
        assistant: box("#rf-assistant"), product: box("#rf-product"), switchControls: document.querySelectorAll(".rf-toggle, #rf-view-assistant, #rf-view-product").length
      };
    });
    const sideBySide = width > NARROW_MAX;
    expect(m.bar.height).toBeLessThanOrEqual(53);
    expect(m.barSticky).toBe("sticky");
    expect(m.labelOverflow).toBe(false);
    expect(m.switchControls).toBe(0); // there is no Assistant | Product switch at any width
    if (sideBySide) {
      expect(m.product.left).toBeGreaterThanOrEqual(m.assistant.right - 1);
      expect(m.assistant.width).toBeGreaterThanOrEqual(340);
      expect(m.assistant.width / width).toBeLessThan(0.43);
      expect(m.product.width).toBeGreaterThan(560);
      expect(m.product.right).toBeLessThanOrEqual(width + 1);
      await expect(page.getByRole("tablist")).toHaveCount(1);
      // Beside the report the composer stays in the assistant pane, and the match summary keeps its original four-in-a-row form.
      await expect(page.locator("#rf-composer")).toHaveCSS("position", "static");
      await expect(page.locator("details")).toHaveCount(0);
    } else {
      // One continuous page: the product follows the assistant, both full width, nothing hidden.
      expect(m.product.top).toBeGreaterThanOrEqual(m.assistant.bottom - 1);
      expect(m.assistant.width).toBeGreaterThan(width - 2);
      expect(m.product.width).toBeGreaterThan(width - 2);
      await expect(page.getByRole("tablist")).toHaveCount(0);
      for (const name of SECTIONS) await expect(panelLocator(page, name)).toBeVisible();
      // The conversation text column stays readable on tablets instead of stretching edge to edge.
      const column = await page.evaluate(() => { const r = document.querySelector(".rf-msg-body").getBoundingClientRect(); return r.width; });
      expect(column).toBeLessThanOrEqual(780);
      // The composer is pinned to the bottom edge at every single-page width, the page leaves room for it, and the summary is 2x2.
      await expect(page.locator("#rf-composer")).toHaveCSS("position", "fixed");
      const pinned = await page.evaluate(() => { const r = document.querySelector("#rf-composer").getBoundingClientRect(); return { bottom: Math.round(r.bottom), height: r.height, viewport: window.innerHeight, padding: parseFloat(getComputedStyle(document.querySelector("#rf-shell")).paddingBottom) }; });
      expect(pinned.bottom).toBe(pinned.viewport);
      expect(pinned.padding).toBeGreaterThanOrEqual(pinned.height - 1);
      const tops = await page.locator(".rf-tiles .rf-tile").evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
      expect(tops[0]).toBe(tops[1]);
      expect(tops[2]).toBe(tops[3]);
      expect(tops[2]).toBeGreaterThan(tops[0]);
      // Sticky offsets: the section row sits directly under the bar.
      const [barBottom, rowTop] = await page.evaluate(() => [document.querySelector(".rf-bar").getBoundingClientRect().bottom, document.querySelector(".rf-tabbar").getBoundingClientRect().top]);
      await page.evaluate(() => window.scrollTo({ top: document.querySelector("#rf-panel-replacement").getBoundingClientRect().top + window.scrollY - 120, behavior: "instant" }));
      const stuck = await page.evaluate(() => document.querySelector(".rf-tabbar").getBoundingClientRect().top - document.querySelector(".rf-bar").getBoundingClientRect().bottom);
      expect(Math.abs(stuck)).toBeLessThanOrEqual(1);
      expect(barBottom).toBeGreaterThan(0);
      expect(rowTop).toBeGreaterThan(0);
    }

    // The tab row is fully reachable.
    const tabs = await page.evaluate(() => document.querySelector(".rf-tablist").children.length);
    expect(tabs).toBe(5);

    // Comparison: a table while the pane can hold four columns, stacked cards below that. Never clipped.
    const panel = await openTab(page, "Replacement");
    const wide = m.product.width > TABLE_MIN_PANE;
    const rowDisplay = await panel.locator("tbody tr").first().evaluate((tr) => getComputedStyle(tr).display);
    expect(rowDisplay).toBe(wide ? "table-row" : "grid");
    const clipped = await panel.locator(".rf-table-wrap").evaluate((node) => node.scrollWidth > node.clientWidth + 1);
    expect(clipped).toBe(false);
    for (const name of SECTIONS) {
      await tabControl(page, name).click();
      if (!sideBySide) await expect.poll(() => isLanded(page, panelLocator(page, name))).toBe(true);
      await expectNoHorizontalOverflow(page);
    }
    expect(seen.consoleErrors).toEqual([]);
    expect(seen.pageErrors).toEqual([]);
    expect(seen.analytics).toEqual([]);
    if (process.env.RF_SCREENSHOT_DIR) {
      await openTab(page, "Replacement");
      await page.screenshot({ path: path.join(process.env.RF_SCREENSHOT_DIR, `width-${width}.png`), fullPage: true });
    }
  });
}
