// The compact single-page experience at 960px and below: a pinned composer, a folded conversation, dense result sections, disclosures for
// lower-priority detail, a 2x2 match summary and sticky offsets. Desktop (above 960px) is checked to be unchanged.
// Mocked contracts only (no provider is contacted) and the analytics-blocking `test` from helpers.js.
const { test, expect, contracts, prepare, runLookup, fillAndSubmit, tabControl, panelLocator, isNarrowViewport, expectNoHorizontalOverflow, PAGE } = require("./helpers.js");

const settle = async (seen) => { expect(seen.consoleErrors).toEqual([]); expect(seen.pageErrors).toEqual([]); expect(seen.analytics).toEqual([]); };
const reply = (body) => ({ reply: () => ({ status: 200, body }) });
const best = () => reply(contracts.engineBestAvailableUnconfirmed());
const PHONE_MAX = 520;
const PAGE_HEIGHT_BUDGET = { phone: 4300, tablet: 3200 }; // the previous single page was about 6,200px (phone) and 4,400px (768): this keeps at least ~30% off

const box = (page, selector) => page.evaluate((query) => {
  const r = document.querySelector(query).getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width };
}, selector);
const settleScroll = (page) => page.waitForTimeout(1300); // smooth scrolling (the jump after a lookup) finishes
const scrollFraction = (page, fraction) => page.evaluate((f) => window.scrollTo({ top: (document.documentElement.scrollHeight - window.innerHeight) * f, behavior: "instant" }), fraction);
const narrowOnly = (page) => test.skip(!isNarrowViewport(page), "applies at 960px and below");

// ---- the pinned composer ---------------------------------------------------------------------------------------------

test("composer: pinned to the bottom of the screen, compact, and usable from deep in the results", async ({ page }) => {
  narrowOnly(page);
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  const viewportHeight = page.viewportSize().height;
  const composer = page.locator("#rf-composer");
  // Before any result and at every depth afterwards the bar is at the bottom edge and out of the way.
  await expect(composer).toHaveCSS("position", "fixed");
  await runLookup(page);
  for (const fraction of [0, 0.3, 0.65, 1]) {
    await scrollFraction(page, fraction);
    const bar = await box(page, "#rf-composer");
    expect(Math.round(bar.bottom)).toBe(viewportHeight);
    expect(bar.height).toBeLessThanOrEqual(80);
    expect(bar.left).toBe(0);
    expect(bar.right).toBe(page.viewportSize().width);
    await expect(page.getByLabel("Message ItemAssist")).toBeInViewport();
    await expect(page.getByRole("button", { name: "Send message" })).toBeInViewport();
  }
  // Typing from the bottom of the page needs no scrolling back to the top, and the reply goes into the conversation.
  await scrollFraction(page, 0.65);
  await page.getByLabel("Message ItemAssist").fill("what is the best phone?");
  await page.getByLabel("Message ItemAssist").press("Enter");
  await expect(page.locator("#rf-log")).toContainText("I can't answer free-form questions yet");
  await expectNoHorizontalOverflow(page);
  await settle(seen);
});

test("composer: the last of the report is never hidden behind it", async ({ page }) => {
  narrowOnly(page);
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  await scrollFraction(page, 1);
  const bar = await box(page, "#rf-composer");
  const last = await box(page, "#rf-panel-evidence");
  expect(last.bottom).toBeLessThanOrEqual(bar.top + 1);
  // The room is the composer's own height, published for the page to use.
  const room = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector("#rf-shell")).paddingBottom));
  expect(room).toBeGreaterThanOrEqual(bar.height - 1);
  // A control scrolled into view lands above the bar, not under it, and opening more content keeps the end of the page clear too.
  await page.locator("#rf-ev-support-h").click();
  await expect(page.locator("#rf-ev-support-h")).toBeInViewport();
  expect((await box(page, "#rf-ev-support-h")).bottom).toBeLessThanOrEqual((await box(page, "#rf-composer")).top + 1);
  await scrollFraction(page, 1);
  expect((await box(page, "#rf-panel-evidence")).bottom).toBeLessThanOrEqual((await box(page, "#rf-composer")).top + 1);
  await settle(seen);
});

test("composer: the box grows a little then stops, the controls stay reachable, and safe areas are respected", async ({ page }) => {
  narrowOnly(page);
  await prepare(page, best());
  await page.goto(PAGE);
  const input = page.getByLabel("Message ItemAssist");
  const before = (await box(page, "#rf-composer")).height;
  await input.fill(Array.from({ length: 14 }, (_, i) => `line ${i + 1}`).join("\n"));
  const grown = await box(page, "#rf-compose-input");
  expect(grown.height).toBeGreaterThan(44);
  expect(grown.height).toBeLessThanOrEqual(98); // capped
  expect(await input.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  expect((await box(page, "#rf-composer")).height).toBeGreaterThan(before);
  await expect(page.getByRole("button", { name: "Send message" })).toBeInViewport();
  await expect(page.getByRole("button", { name: /Attach a photo or document/ })).toBeDisabled();
  // The page can reach under a notch only because viewport-fit=cover is set, and the bar then pads for the home indicator and the sides.
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);
  const css = await page.evaluate(async () => (await fetch("/replacement-finder.css")).text());
  expect(css).toContain("env(safe-area-inset-bottom");
  expect(css).toContain("env(safe-area-inset-left");
  expect(css).toContain("env(safe-area-inset-right");
});

// ---- conversation ---------------------------------------------------------------------------------------------------

test("conversation: one compact summary after a lookup, far less height than the history it replaces", async ({ page }) => {
  narrowOnly(page);
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page, { notes: "Reusing existing wall mount" });
  const folded = (await box(page, "#rf-log")).height;
  await page.getByRole("button", { name: "View conversation" }).click();
  const open = (await box(page, "#rf-log")).height;
  expect(folded).toBeLessThan(open);
  expect(folded).toBeLessThanOrEqual(190); // one card, not 300-500px of history
  // The summary names the result, the model and the price, and keeps the no-LKQ caveat.
  const summary = page.locator(".rf-msg--summary");
  for (const text of ["Best Available Current Replacement", "Samsung QN55QN80H", "$999.99", "No Confirmed LKQ"]) await expect(summary).toContainText(text);
  await settle(seen);
});

test("conversation: messages are tighter on a small screen and sender labels stay available to screen readers", async ({ page }) => {
  narrowOnly(page);
  await prepare(page, best());
  await page.goto(PAGE);
  await page.getByLabel("Message ItemAssist").fill("hello");
  await page.getByLabel("Message ItemAssist").press("Enter");
  const first = page.locator(".rf-msg").first();
  await expect(first.locator(".rf-msg-who")).toHaveText("ItemAssist"); // still in the page for assistive technology
  const label = await first.locator(".rf-msg-who").evaluate((node) => node.getBoundingClientRect().width);
  expect(label).toBeLessThanOrEqual(1); // but not drawn
  const gap = await page.evaluate(() => getComputedStyle(document.querySelector("#rf-log")).rowGap);
  expect(parseFloat(gap)).toBeLessThanOrEqual(8);
});

// ---- result sections ------------------------------------------------------------------------------------------------

test("sections: critical warnings are always visible, never inside a collapsed disclosure", async ({ page }) => {
  narrowOnly(page);
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  for (const code of ["NO_CONFIRMED_LKQ", "ORIGINAL_SOURCE_NON_US"]) {
    const note = page.locator(`#rf-panel-overview [data-code="${code}"]`);
    await expect(note).toBeVisible();
    expect(await note.evaluate((node) => Boolean(node.closest("details")))).toBe(false);
  }
  await expect(page.locator(".rf-lead")).toBeVisible();
  await expect(page.locator(".rf-lead")).toContainText("No Confirmed LKQ");
  await expect(page.locator(".rf-tiles")).toBeVisible();
  await expect(page.locator(".rf-compare")).toBeVisible();
  await settle(seen);
});

test("sections: lower-priority detail is in native disclosures that start closed and work from the keyboard", async ({ page }) => {
  narrowOnly(page);
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  const closed = ["#rf-why-h", "#rf-unknown-h", "#rf-needs-h", "#rf-later-h", "#rf-ev-support-h"];
  for (const id of closed) {
    const details = page.locator(`details:has(> ${id})`);
    await expect(details).toHaveCount(1);
    await expect(details).not.toHaveAttribute("open", "");
  }
  // The preview names what is inside without opening it.
  await expect(page.locator("#rf-needs-h")).toContainText("HDR support, Physical fit");
  await expect(page.locator("#rf-unknown-h")).toContainText("Physical fit");
  // Keyboard: focus the summary, Enter opens it, Enter closes it.
  const needs = page.locator("#rf-needs-h");
  await needs.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("details:has(> #rf-needs-h)")).toHaveAttribute("open", "");
  await expect(page.locator("#rf-panel-replacement .rf-need").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("details:has(> #rf-needs-h)")).not.toHaveAttribute("open", "");
  // "Why this match?" opens its disclosure and lands on it.
  await page.getByRole("button", { name: "Why this match?" }).click();
  await expect(page.locator("#rf-why-h")).toBeFocused();
  await expect(page.locator("details:has(> #rf-why-h)")).toHaveAttribute("open", "");
  await expect(page.locator(".rf-why-list")).toBeVisible();
  await settle(seen);
});

test("sections: alternatives are a closed disclosure that names the models", async ({ page }) => {
  narrowOnly(page);
  await prepare(page, reply(contracts.engineComplete()));
  await page.goto(PAGE);
  await runLookup(page);
  await expect(page.locator("details:has(> #rf-alts-h)")).not.toHaveAttribute("open", "");
  await expect(page.locator("#rf-alts-h")).toContainText("Samsung QN55QN90D");
  await page.locator("#rf-alts-h").click();
  await expect(page.locator(".rf-alt").first()).toBeVisible();
});

test("sections: a provenance warning is described once and the other sections point to it", async ({ page }) => {
  narrowOnly(page);
  await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  await expect(page.locator('[data-code="ORIGINAL_SOURCE_NON_US"]')).toHaveCount(1);
  await expect(page.locator(".rf-wref")).toHaveCount(2); // Specifications and Evidence
  await page.locator("#rf-panel-evidence").getByRole("button", { name: /See warning/ }).click();
  await expect(page.locator("#rf-warn-h")).toBeFocused();
  await expect(page.locator('[data-code="ORIGINAL_SOURCE_NON_US"]')).toBeInViewport();
  await expect(tabControl(page, "Overview")).toHaveAttribute("aria-current", "location");
});

test("sections: the replacement is not repeated; the Replacement section holds a one-line reference and the comparison", async ({ page }) => {
  narrowOnly(page);
  await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  await expect(page.locator(".rf-lead")).toHaveCount(1);
  await expect(page.locator("#rf-panel-replacement .rf-retail")).toHaveCount(0);
  await expect(page.locator("#rf-panel-replacement .rf-ref")).toContainText("Samsung QN55QN80H");
  await expect(page.locator("#rf-panel-pricing .rf-price-big")).toHaveCount(1);
  await expect(page.locator("#rf-panel-pricing").getByText("$999.99")).toHaveCount(1);
  expect(await page.locator("#rf-panel-replacement .rf-ref").evaluate((node) => node.getBoundingClientRect().height)).toBeLessThanOrEqual(115); // about half the full replacement card it stands in for
});

test("match summary: a compact 2x2 grid with a status strip on each tile", async ({ page }) => {
  narrowOnly(page);
  await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  const tiles = page.locator(".rf-tiles .rf-tile");
  await expect(tiles).toHaveCount(4);
  const rects = await tiles.evaluateAll((nodes) => nodes.map((node) => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, height: r.height }; }));
  expect(Math.abs(rects[0].top - rects[1].top)).toBeLessThan(2); // Required | Important
  expect(Math.abs(rects[2].top - rects[3].top)).toBeLessThan(2); // Additional | Needs Review
  expect(rects[2].top).toBeGreaterThan(rects[0].top + 20);
  expect(Math.abs(rects[0].left - rects[2].left)).toBeLessThan(2);
  expect(rects[1].left).toBeGreaterThan(rects[0].left + 50);
  for (const rect of rects) expect(rect.height).toBeLessThanOrEqual(92);
  await expect(tiles.nth(0)).toContainText("Required");
  await expect(tiles.nth(0)).toContainText("2 / 2");
  await expect(tiles.nth(3)).toContainText("Needs Review");
  const strip = await tiles.nth(0).evaluate((node) => parseFloat(getComputedStyle(node, "::before").height));
  expect(strip).toBeGreaterThanOrEqual(4);
  await expectNoHorizontalOverflow(page);
});

test("comparison: dense rows on a phone, with no repeated Specification / Assessment headings", async ({ page }) => {
  test.skip(page.viewportSize().width > PHONE_MAX, "stacked rows apply while the pane is narrower than a table needs");
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  const rows = page.locator("#rf-panel-replacement tbody tr");
  await expect(rows).toHaveCount(5);
  const heights = await rows.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  for (const height of heights) expect(height).toBeLessThanOrEqual(110);
  expect(heights.reduce((sum, height) => sum + height, 0)).toBeLessThanOrEqual(500);
  const labels = await rows.first().evaluate((tr) => ({
    original: getComputedStyle(tr.querySelector('td[data-label="Original"]'), "::before").content,
    replacement: getComputedStyle(tr.querySelector('td[data-label="Replacement"]'), "::before").content,
    assessment: getComputedStyle(tr.querySelector('td[data-label="Assessment"]'), "::before").display
  }));
  expect(labels.original).toContain("Original"); // the values are labelled inline
  expect(labels.replacement).toContain("Replacement");
  expect(labels.assessment).toBe("none"); // the pill says it in words
  // Status stays in text and on a stronger border, never colour alone.
  await expect(rows.filter({ hasText: "Screen size" })).toContainText("Meets");
  await expect(rows.filter({ hasText: "HDR support" })).toContainText("Verify");
  const border = await rows.filter({ hasText: "HDR support" }).evaluate((tr) => parseFloat(getComputedStyle(tr).borderLeftWidth));
  expect(border).toBeGreaterThanOrEqual(4);
  await settle(seen);
});

test("categories: each section has its own colour-keyed border and label", async ({ page }) => {
  narrowOnly(page);
  await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  const tops = {};
  for (const [name, id] of [["Overview", "overview"], ["Specifications", "specs"], ["Replacement", "replacement"], ["Pricing", "pricing"], ["Evidence", "evidence"]]) {
    const panel = page.locator(`#rf-panel-${id}`);
    tops[name] = await panel.evaluate((node) => ({ color: getComputedStyle(node).borderTopColor, width: parseFloat(getComputedStyle(node).borderTopWidth), label: getComputedStyle(node, "::before").content }));
    expect(tops[name].width).toBeGreaterThanOrEqual(3);
    expect(tops[name].label).toContain(name);
  }
  expect(new Set(Object.values(tops).map((top) => top.color)).size).toBe(5);
  // Warnings carry their own amber structural border.
  const warn = await page.locator(".rf-block--warn").evaluate((node) => parseFloat(getComputedStyle(node).borderLeftWidth));
  expect(warn).toBeGreaterThanOrEqual(4);
});

// ---- navigation and sticky offsets ----------------------------------------------------------------------------------

test("sticky stack: bar on top, section row beneath it, composer at the bottom, and a jump lands clear of all three", async ({ page }) => {
  narrowOnly(page);
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  const viewportHeight = page.viewportSize().height;
  for (const name of ["Specifications", "Replacement", "Pricing", "Evidence", "Overview"]) {
    await tabControl(page, name).click();
    await expect(tabControl(page, name)).toHaveAttribute("aria-current", "location");
    await page.waitForTimeout(1300);
    const [bar, row, composer, panel, strip] = await Promise.all([box(page, ".rf-bar"), box(page, ".rf-tabbar"), box(page, "#rf-composer"), box(page, `#rf-panel-${{ Specifications: "specs", Replacement: "replacement", Pricing: "pricing", Evidence: "evidence", Overview: "overview" }[name]}`), box(page, ".rf-pane-head--product")]);
    expect(bar.top).toBe(0);
    expect(Math.abs(row.top - bar.bottom)).toBeLessThanOrEqual(1); // pinned directly under the bar
    expect(row.height).toBeLessThanOrEqual(46); // one compact line
    expect(Math.round(composer.bottom)).toBe(viewportHeight);
    expect(panel.top).toBeGreaterThanOrEqual(row.bottom - 1); // not under the section row
    expect(row.bottom).toBeLessThan(composer.top);
    expect(strip.bottom).toBeLessThan(viewportHeight);
  }
  await settle(seen);
});

test("navigation: the section row stays on one line, scrolls sideways if it must, and abbreviates Specifications on phones", async ({ page }) => {
  narrowOnly(page);
  await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  const tabs = await page.locator(".rf-tablist .rf-tab").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
  expect(new Set(tabs.map(Math.round)).size).toBe(1);
  const list = await page.locator(".rf-tablist").evaluate((node) => getComputedStyle(node).overflowX);
  expect(list).toBe("auto");
  const specs = tabControl(page, "Specifications");
  const shown = await specs.evaluate((node) => getComputedStyle(node, "::before").content);
  if (page.viewportSize().width <= PHONE_MAX) expect(shown).toContain("Specs");
  else expect(shown === "none" || shown === "normal").toBe(true);
  // Whatever is drawn, the control keeps its full accessible name.
  await expect(page.getByRole("navigation", { name: "Product intelligence sections" }).getByRole("button", { name: "Specifications" })).toBeVisible();
  await specs.click();
  await expect(tabControl(page, "Specifications")).toHaveAttribute("aria-current", "location");
});

test("identity: brand, model, type and one status row sit together above the section row", async ({ page }) => {
  narrowOnly(page);
  await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  await settleScroll(page);
  const header = await box(page, ".rf-ph");
  const row = await box(page, ".rf-tabbar");
  expect(header.height).toBeLessThanOrEqual(page.viewportSize().width <= PHONE_MAX ? 140 : 130);
  expect(Math.abs(row.top - header.bottom)).toBeLessThanOrEqual(1); // no gap between identity and navigation
  const chips = await box(page, ".rf-status-row");
  expect(chips.height).toBeLessThanOrEqual(62); // at most two short lines of chips
  // The divider that separates chat from results is solid and labelled.
  const divider = page.locator(".rf-pane-head--product");
  await expect(divider).toContainText("Product Intelligence");
  expect(await divider.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(30, 58, 95)");
});

// ---- page length, initial state, tablet ---------------------------------------------------------------------------------

test("length: a typical result fits the page-height budget", async ({ page }) => {
  narrowOnly(page);
  await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page, { notes: "Reusing existing wall mount" });
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(height).toBeLessThanOrEqual(page.viewportSize().width <= PHONE_MAX ? PAGE_HEIGHT_BUDGET.phone : PAGE_HEIGHT_BUDGET.tablet);
});

test("initial: the empty state is a single restrained message, and the page needs no scrolling", async ({ page }) => {
  narrowOnly(page);
  const seen = await prepare(page);
  await page.goto(PAGE);
  await expect(page.locator(".rf-empty-lede")).toBeVisible();
  await expect(page.getByText("What appears here")).toBeHidden();
  await expect(page.locator(".rf-empty-list")).toBeHidden();
  const [scrollHeight, innerHeight] = await page.evaluate(() => [document.documentElement.scrollHeight, window.innerHeight]);
  expect(scrollHeight).toBeLessThanOrEqual(innerHeight);
  const [greeting, quick, divider, composer] = await Promise.all([box(page, "#rf-log"), box(page, "#rf-quick"), box(page, ".rf-pane-head--product"), box(page, "#rf-composer")]);
  expect(greeting.bottom).toBeLessThanOrEqual(quick.top + 1);
  expect(quick.bottom).toBeLessThanOrEqual(divider.top + 1);
  expect(composer.top).toBeGreaterThan(divider.bottom);
  expect(divider.top).toBeLessThanOrEqual(260); // everything above the results is a handful of short rows
  await expectNoHorizontalOverflow(page);
  await settle(seen);
});

test("chat and results are two clearly different surfaces", async ({ page }) => {
  narrowOnly(page);
  await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  const surface = (selector, prop) => page.locator(selector).evaluate((node, property) => getComputedStyle(node)[property], prop);
  expect(await surface("#rf-assistant", "backgroundColor")).toBe("rgb(255, 255, 255)");
  expect(await page.locator(".rf-msg--assistant .rf-msg-body").first().evaluate((node) => getComputedStyle(node).borderLeftColor)).toBe("rgb(30, 58, 95)");
  expect(await surface(".rf-pane-head--product", "backgroundColor")).toBe("rgb(30, 58, 95)");
  expect(await surface("#rf-product", "backgroundImage")).toContain("linear-gradient");
  expect(await page.locator(".rf-block").first().evaluate((node) => getComputedStyle(node).borderTopWidth)).toBe("1px");
});

test("tablet: the first things to read sit side by side instead of in one long column", async ({ page }) => {
  const width = page.viewportSize().width;
  test.skip(!(isNarrowViewport(page) && width >= 700), "two-column sections apply to wide single-page layouts");
  await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  await settleScroll(page);
  const lead = await box(page, ".rf-lead");
  const warnings = await box(page, '#rf-panel-overview .rf-block--warn');
  expect(warnings.left).toBeGreaterThan(lead.right - 2);
  expect(Math.abs(warnings.top - lead.top)).toBeLessThan(24);
  // The comparison is a table here, not stacked cards.
  const display = await page.locator("#rf-panel-replacement tbody tr").first().evaluate((tr) => getComputedStyle(tr).display);
  expect(display).toBe("table-row");
  await expectNoHorizontalOverflow(page);
});

// ---- desktop is unchanged ----------------------------------------------------------------------------------------------

test("desktop: no pinned composer, no folding, no disclosures, full labels and the original summary card", async ({ page }) => {
  test.skip(isNarrowViewport(page), "applies above 960px");
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await runLookup(page);
  await expect(page.locator("#rf-composer")).toHaveCSS("position", "static");
  await expect(page.locator("#rf-convo-toggle")).toBeHidden();
  await expect(page.locator("#rf-product details")).toHaveCount(0);
  await expect(page.locator("#rf-log")).toHaveCSS("overflow-y", "auto");
  // The summary message is shown in full beside the report, with its original button.
  await expect(page.getByRole("button", { name: "View product intelligence" })).toBeVisible();
  await expect(page.locator(".rf-msg--user", { hasText: "Find replacement" })).toBeVisible();
  // Nothing from the compact layout leaks in: full status labels, the full replacement intro, one tab panel at a time.
  await expect(page.getByRole("group", { name: "Report status" })).toContainText("Needs Verification · 2");
  await expect(page.locator("#rf-panel-replacement .rf-intro")).toHaveCount(1);
  await expect(page.locator("#rf-panel-replacement .rf-ref")).toHaveCount(0);
  await expect(page.locator(".rf-tabpanel").first()).toHaveCSS("border-top-width", "0px");
  expect(await page.locator(".rf-tabpanel").first().evaluate((node) => getComputedStyle(node, "::before").content)).toMatch(/none|normal/);
  await expect(page.locator(".rf-pane-head--product")).not.toHaveCSS("background-color", "rgb(30, 58, 95)");
  const tiles = await page.locator(".rf-tiles .rf-tile").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
  // As before: four in a row while the pane can hold them (a 1280px screen), two by two in the narrower 1024px pane.
  if (page.viewportSize().width >= 1100) expect(Math.max(...tiles) - Math.min(...tiles)).toBeLessThan(2);
  await settle(seen);
});

test("errors: with a folded conversation the error and the composer are both on screen, and no report remains", async ({ page }) => {
  narrowOnly(page);
  let calls = 0;
  const seen = await prepare(page, { reply: () => (++calls === 1 ? { status: 200, body: contracts.engineBestAvailableUnconfirmed() } : { status: 504, body: { contractVersion: "1", status: "ERROR", errorCode: "ENGINE_TIMEOUT", message: "x", requestId: "r" } }) });
  await page.goto(PAGE);
  await runLookup(page);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await fillAndSubmit(page);
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("took longer than expected");
  await expect(alert).toBeInViewport();
  await expect(page.getByLabel("Message ItemAssist")).toBeInViewport();
  await expect(page.locator(".rf-lead, #rf-product-name, .rf-tabbar")).toHaveCount(0);
  await expect(panelLocator(page, "Overview")).toHaveCount(0);
  await settle(seen);
});
