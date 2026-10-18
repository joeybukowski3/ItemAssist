// Conversational intake in the ItemAssist assistant: a typed brand/model starts the existing lookup, a gap becomes one short question,
// and the structured form stays available. Every reply is a mocked /api/replacement-finder response: no engine or provider is contacted.
// Uses the analytics-blocking `test` from helpers.js.
const { test, expect, contracts, errorBody, prepare, fillAndSubmit, isNarrowViewport, expectNoHorizontalOverflow, PAGE } = require("./helpers.js");

const settle = async (seen) => { expect(seen.consoleErrors).toEqual([]); expect(seen.pageErrors).toEqual([]); expect(seen.analytics).toEqual([]); };
const reply = (body, status = 200) => ({ reply: () => ({ status, body }) });
const best = () => reply(contracts.engineBestAvailableUnconfirmed());

async function send(page, text) {
  const input = page.getByLabel("Message ItemAssist");
  await input.fill(text);
  await input.press("Enter");
}
const log = (page) => page.locator("#rf-log");
const post = (category, brand, model, notes = "") => ({ category, brand, model, notes, website: "" });

// ---- direct recognition ---------------------------------------------------------------------------------------------------

for (const [input, expected, ack] of [
  ["Samsung QN55Q80C", post("television", "Samsung", "QN55Q80C"), "I found Samsung QN55Q80C. Researching the current replacement now."],
  ["QN55Q80C", post("television", "Samsung", "QN55Q80C"), "I found Samsung QN55Q80C."],
  ["Find a replacement for my Samsung QN55Q80C", post("television", "Samsung", "QN55Q80C"), "I found Samsung QN55Q80C."],
  ["LG LRFCS25D3S", post("refrigerator", "LG", "LRFCS25D3S"), "I found LG LRFCS25D3S. Researching the current replacement now."],
  ["LRFCS25D3S", post("refrigerator", "LG", "LRFCS25D3S"), "I found LG LRFCS25D3S."]
]) {
  test(`intake: "${input}" runs the lookup directly and never opens the form`, async ({ page }) => {
    const seen = await prepare(page, best());
    await page.goto(PAGE);
    await send(page, input);
    await expect(log(page)).toContainText(ack);
    await expect(page.locator("#rf-product-name")).toBeVisible();
    await expect(page.locator("#rf-ask")).toHaveCount(0);
    expect(seen.posts).toEqual([expected]);
    // The user's own message is the only echo: there is no second "Find replacement: ..." bubble.
    await expect(log(page)).not.toContainText("Find replacement:");
    await expectNoHorizontalOverflow(page);
    await settle(seen);
  });
}

test("intake: the existing loading state shows while the lookup runs, and the result renders as before", async ({ page }) => {
  const seen = await prepare(page, { reply: () => ({ status: 200, body: contracts.engineComplete(), delayMs: 3000 }) });
  await page.goto(PAGE);
  await send(page, "LG LRFCS25D3S");
  await expect(page.locator("#rf-loading-h")).toContainText("Researching LG LRFCS25D3S");
  await expect(page.locator(".rf-stages li")).toHaveCount(5);
  await expect(page.locator("#rf-product-name")).toBeVisible({ timeout: 12000 });
  await expect(page.locator(".rf-lead #rf-lead-h")).toHaveText("Recommended Replacement");
  await settle(seen);
});

// ---- notes ----------------------------------------------------------------------------------------------------------------

test("notes: a supported constraint in the same message is sent as the note", async ({ page }) => {
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await send(page, "LG LRFCS25D3S must fit the same opening");
  await expect(page.locator("#rf-product-name")).toBeVisible();
  expect(seen.posts).toEqual([post("refrigerator", "LG", "LRFCS25D3S", "Must fit existing opening")]);
  await expect(log(page)).toContainText("I'll note: Must fit existing opening.");
});

test("notes: reusing the wall mount is sent as the note, and a general preference is not", async ({ page }) => {
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await send(page, "Samsung QN55Q80C, reusing the existing wall mount, and I'd like a brighter picture");
  await expect(page.locator("#rf-product-name")).toBeVisible();
  expect(seen.posts).toEqual([post("television", "Samsung", "QN55Q80C", "Reusing existing wall mount")]);
});

// ---- follow-up questions --------------------------------------------------------------------------------------------------

test("clarify: Samsung Q80C asks for the size with compact choices, and never invents a SKU", async ({ page }) => {
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await send(page, "Samsung Q80C");
  await expect(log(page)).toContainText("What size is the TV?");
  const choices = page.locator(".rf-choices .rf-choice");
  await expect(choices).toHaveText(['55"', '65"', '75"', "Other"]);
  await expect(page.locator("#rf-ask")).toHaveCount(0);
  expect(seen.posts).toEqual([]);
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: '65"' }).click();
  await expect(log(page)).toContainText("I read that as Samsung QN65Q80C. Researching the current replacement now.");
  await expect(page.locator("#rf-product-name")).toBeVisible();
  await expect(page.locator(".rf-choices")).toHaveCount(0); // answered: the buttons are gone
  expect(seen.posts).toEqual([post("television", "Samsung", "QN65Q80C")]);
  await settle(seen);
});

test("clarify: a typed size answer completes the lookup and clears the buttons", async ({ page }) => {
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await send(page, "Q80C");
  await expect(page.locator(".rf-choices")).toHaveCount(1);
  await send(page, "75 inch");
  await expect(page.locator("#rf-product-name")).toBeVisible();
  await expect(page.locator(".rf-choices")).toHaveCount(0);
  expect(seen.posts).toEqual([post("television", "Samsung", "QN75Q80C")]);
});

test("clarify: Samsung 55 inch Q80C resolves in one message", async ({ page }) => {
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await send(page, "Samsung 55 inch Q80C");
  await expect(page.locator("#rf-product-name")).toBeVisible();
  expect(seen.posts).toEqual([post("television", "Samsung", "QN55Q80C")]);
});

test("clarify: LG refrigerator asks for the model number, and the typed model completes it", async ({ page }) => {
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await send(page, "LG refrigerator");
  await expect(log(page)).toContainText("What is the model number of the LG refrigerator?");
  expect(seen.posts).toEqual([]);
  await send(page, "LRFCS25D3S");
  await expect(page.locator("#rf-product-name")).toBeVisible();
  expect(seen.posts).toEqual([post("refrigerator", "LG", "LRFCS25D3S")]);
});

test("clarify: Other opens the structured form with what is already known", async ({ page }) => {
  const seen = await prepare(page);
  await page.goto(PAGE);
  await send(page, "Samsung Q80C, reusing the existing wall mount");
  await page.getByRole("button", { name: "Other" }).click();
  await expect(page.locator("#rf-ask")).toBeVisible();
  await expect(page.locator("#rf-brand")).toHaveValue("Samsung");
  await expect(page.locator("#rf-notes")).toHaveValue("Reusing existing wall mount");
  expect(seen.posts).toEqual([]);
});

test("clarify: ignoring the buttons and asking something else replaces the question", async ({ page }) => {
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await send(page, "Samsung Q80C");
  await send(page, "LG LRFCS25D3S");
  await expect(page.locator("#rf-product-name")).toBeVisible();
  await expect(page.locator(".rf-choices")).toHaveCount(0);
  expect(seen.posts).toEqual([post("refrigerator", "LG", "LRFCS25D3S")]);
});

// ---- scope, unsupported and fallback --------------------------------------------------------------------------------------

test("scope: hello gets a helpful boundary message, with no API call and no form", async ({ page }) => {
  const seen = await prepare(page);
  await page.goto(PAGE);
  await send(page, "hello");
  await expect(log(page)).toContainText("I can currently help identify and research replacement models. Send me a brand and model number, or use Find Replacement.");
  await expect(log(page)).not.toContainText("free-form");
  await expect(page.locator("#rf-ask")).toHaveCount(0);
  expect(seen.posts).toEqual([]);
  await settle(seen);
});

test("unsupported: an unrecognised Samsung model asks first, and the server's unsupported answer is shown unchanged", async ({ page }) => {
  const seen = await prepare(page, reply(errorBody("UNSUPPORTED"), 422));
  await page.goto(PAGE);
  await send(page, "Samsung ZZ99X");
  await expect(log(page)).toContainText("I don't recognize ZZ99X as a Samsung television model number");
  await expect(page.getByRole("button", { name: "Enter the details manually" })).toBeVisible();
  expect(seen.posts).toEqual([]); // nothing is sent until the user agrees
  await page.getByRole("button", { name: "Research ZZ99X anyway" }).click();
  await expect(log(page)).toContainText("I couldn't match");
  await expect(page.locator("#rf-product-name")).toHaveCount(0); // no fabricated product
  expect(seen.posts).toEqual([post("television", "Samsung", "ZZ99X")]);
  await settle(seen);
});

test("fallback: a model from an unsupported brand offers the manual form and sends nothing", async ({ page }) => {
  const seen = await prepare(page);
  await page.goto(PAGE);
  await send(page, "Sony KD55X80K");
  await expect(log(page)).toContainText("I can currently research Samsung televisions and LG refrigerators");
  await expect(page.locator("#rf-ask")).toBeVisible();
  await expect(page.locator("#rf-model")).toHaveValue("KD55X80K");
  expect(seen.posts).toEqual([]);
});

test("fallback: the structured form still works end to end, and Find Replacement resets a pending question", async ({ page }) => {
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await send(page, "Samsung Q80C");
  await page.locator('[data-action="find"]').click();
  await expect(page.locator(".rf-choices")).toHaveCount(0);
  await expect(page.locator("#rf-model")).toBeVisible();
  await fillAndSubmit(page, { model: "qn55q80c", notes: "Reusing existing wall mount" });
  await expect(page.locator("#rf-product-name")).toBeVisible();
  await expect(log(page)).toContainText("Find replacement: Samsung QN55Q80C");
  expect(seen.posts).toEqual([post("television", "Samsung", "QN55Q80C", "Reusing existing wall mount")]);
  // After the form lookup a chat message works again.
  await send(page, "LG LRFCS25D3S");
  await expect.poll(() => seen.posts.length).toBe(2);
});

// ---- existing error and availability behaviour ----------------------------------------------------------------------------

test("errors: a rate-limited conversational lookup shows the existing message and Try again reopens the form", async ({ page }) => {
  const seen = await prepare(page, reply(errorBody("RATE_LIMITED"), 429));
  await page.goto(PAGE);
  await send(page, "QN55Q80C");
  await expect(page.locator(".rf-msg--error")).toContainText("lookup limit");
  await expect(page.locator(".rf-msg--error")).not.toContainText("server text the page must not show");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("#rf-model")).toBeVisible();
  await settle(seen);
});

test("errors: a network failure shows the existing message", async ({ page }) => {
  const seen = await prepare(page, { reply: () => "abort" });
  await page.goto(PAGE);
  await send(page, "LRFCS25D3S");
  await expect(page.locator(".rf-msg--error")).toContainText("couldn't reach ItemAssist");
  expect(seen.posts).toHaveLength(1);
});

test("availability off: a typed model sends nothing", async ({ page }) => {
  const seen = await prepare(page, { enabled: false });
  await page.goto(PAGE);
  await send(page, "LG LRFCS25D3S");
  await expect(log(page)).toContainText("isn't available right now");
  expect(seen.posts).toEqual([]);
});

// ---- a second lookup after a result ---------------------------------------------------------------------------------------

test("follow-on: a new typed model after a result replaces the report and folds earlier history on a narrow screen", async ({ page }) => {
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await send(page, "Samsung QN55Q80C");
  await expect(page.locator("#rf-product-name")).toHaveText("QN55Q80C");
  await send(page, "LG LRFCS25D3S");
  await expect(log(page)).toContainText("I found LG LRFCS25D3S.");
  await expect.poll(() => seen.posts.length).toBe(2);
  if (isNarrowViewport(page)) await expect(page.locator(".rf-msg--folded").first()).toBeAttached();
  await settle(seen);
});

// ---- the sticky mobile composer -------------------------------------------------------------------------------------------

test("mobile: a clarification card sits above the pinned composer and stays inside the screen", async ({ page }) => {
  test.skip(!isNarrowViewport(page), "applies at 960px and below");
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await send(page, "Samsung Q80C");
  const card = page.locator(".rf-msg--choice");
  await expect(card).toBeInViewport();
  const { cardBottom, composerTop, composerBottom } = await page.evaluate(() => ({
    cardBottom: document.querySelector(".rf-msg--choice").getBoundingClientRect().bottom,
    composerTop: document.querySelector("#rf-composer").getBoundingClientRect().top,
    composerBottom: document.querySelector("#rf-composer").getBoundingClientRect().bottom
  }));
  expect(cardBottom).toBeLessThanOrEqual(composerTop + 1);
  expect(Math.round(composerBottom)).toBe(page.viewportSize().height);
  for (const label of ['55"', '65"', '75"', "Other"]) await expect(page.getByRole("button", { name: label, exact: true })).toBeInViewport();
  await expect(page.getByLabel("Message ItemAssist")).toBeInViewport();
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: '55"' }).click();
  await expect(page.locator("#rf-product-name")).toBeVisible();
  await expect(page.getByLabel("Message ItemAssist")).toBeInViewport();
  await settle(seen);
});

test("mobile: a direct model needs no form, and the composer is still usable after the result", async ({ page }) => {
  const seen = await prepare(page, best());
  await page.goto(PAGE);
  await send(page, "LG LRFCS25D3S");
  await expect(page.locator("#rf-product-name")).toBeVisible();
  await expect(page.locator("#rf-ask")).toHaveCount(0);
  await expect(page.getByLabel("Message ItemAssist")).toBeInViewport();
  await expectNoHorizontalOverflow(page);
  await settle(seen);
});
