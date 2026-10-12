// Layout checks at the in-between widths where the two-column hero is narrowest (900 is the stacking breakpoint).
// Viewport is set per test, so this runs once (desktop project) instead of three times. Set RF_SCREENSHOT_DIR to also capture each width.
const path = require("path");
const { test, expect, prepare, expectNoHorizontalOverflow, PAGE } = require("./helpers.js");

const WIDTHS = [900, 901, 960, 1000, 1001, 1024, 1100];

for (const width of WIDTHS) {
  test(`layout @${width}px: hero, principles, header and methodology stay clean`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1280", "viewport is set explicitly; run once");
    const seen = await prepare(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(PAGE);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const m = await page.evaluate(() => {
      const box = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
      const side = document.querySelector(".rf-hero-side");
      const sideStyle = getComputedStyle(side);
      const cred = [...document.querySelectorAll(".rf-cred li")].map((li) => { const r = li.getBoundingClientRect(); return { top: Math.round(r.top), left: r.left, right: r.right, width: r.width, scroll: li.scrollWidth, client: li.clientWidth }; });
      const h1 = document.querySelector(".rf-hero h1");
      const label = document.querySelector(".rf-header-label");
      return {
        main: box(".rf-hero-main"), side: box(".rf-hero-side"), h1: box(".rf-hero h1"), h1Lines: Math.round(h1.firstChild.parentElement.getBoundingClientRect().height / parseFloat(getComputedStyle(h1).lineHeight)),
        h1Overflow: h1.scrollWidth > h1.clientWidth, borderLeft: sideStyle.borderLeftWidth, borderTop: sideStyle.borderTopWidth,
        cred, header: box(".rf-header"), label: box(".rf-header-label"), labelOverflow: label.scrollWidth > label.clientWidth,
        steps: [...document.querySelectorAll(".rf-step")].map((el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top }; }),
        connectors: [...document.querySelectorAll(".rf-step")].map((el) => getComputedStyle(el, "::after").display)
      };
    });

    const stacked = width <= 1000; // hero-only breakpoint
    const gridStacked = width <= 900; // methodology collapses to two columns at 900
    // Hero columns: side by side above 1000, stacked at or below it; neither column is cramped and they never overlap.
    if (stacked) {
      expect(m.side.top).toBeGreaterThanOrEqual(m.main.bottom - 1);
      expect(m.borderTop).toBe("1px");
      expect(m.borderLeft).toBe("0px");
    } else {
      expect(m.side.left).toBeGreaterThanOrEqual(m.main.right);
      expect(Math.abs(m.side.top - m.main.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(m.side.bottom - m.main.bottom)).toBeLessThanOrEqual(1);
      expect(m.main.width).toBeGreaterThan(380);
      expect(m.side.width).toBeGreaterThan(380);
      expect(m.borderLeft).toBe("2px");
      expect(m.borderTop).toBe("0px");
    }
    // Headline: one line, never clipped.
    expect(m.h1Overflow).toBe(false);
    expect(m.h1.height).toBeLessThan(110);
    // Principles: all three visible, none clipped or overlapping, at most two rows.
    expect(m.cred).toHaveLength(3);
    for (const item of m.cred) { expect(item.scroll).toBeLessThanOrEqual(item.client + 1); expect(item.width).toBeGreaterThan(60); }
    expect(new Set(m.cred.map((item) => item.top)).size).toBeLessThanOrEqual(2);
    const row = m.cred.filter((item) => item.top === m.cred[0].top).sort((a, b) => a.left - b.left);
    for (let i = 1; i < row.length; i++) expect(row[i].left).toBeGreaterThanOrEqual(row[i - 1].right);
    expect(m.cred.every((item) => item.right <= m.side.right + 1)).toBe(true);
    // Header stays a compact single-line bar.
    expect(m.header.height).toBeLessThanOrEqual(58);
    expect(m.label.height).toBeLessThan(24);
    expect(m.labelOverflow).toBe(false);
    // Methodology: four cards in order, no overlap, connectors only where a card follows on the same row.
    expect(m.steps).toHaveLength(4);
    const rows = [...new Set(m.steps.map((step) => Math.round(step.top)))];
    for (const rowTop of rows) {
      const inRow = m.steps.filter((step) => Math.round(step.top) === rowTop).sort((a, b) => a.left - b.left);
      for (let i = 1; i < inRow.length; i++) expect(inRow[i].left).toBeGreaterThanOrEqual(inRow[i - 1].right);
    }
    expect(m.steps.every((step) => step.right <= width)).toBe(true);
    if (!gridStacked) expect(m.connectors.slice(0, 3)).toEqual(["block", "block", "block"]);

    await expectNoHorizontalOverflow(page);
    expect(seen.consoleErrors).toEqual([]);
    expect(seen.pageErrors).toEqual([]);
    expect(seen.analytics).toEqual([]);
    if (process.env.RF_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.RF_SCREENSHOT_DIR, `width-${width}.png`), fullPage: true });
  });
}
