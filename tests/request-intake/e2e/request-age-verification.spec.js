const { test, expect } = require("@playwright/test");
const { stubTurnstileAndApi } = require("./helpers.js");

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "Functional flow is exercised once on desktop; see responsive.spec.js for cross-viewport checks.");
});

test.describe("direct visit", () => {
  test("renders the shared header, hero, and footer with no referral banner", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await expect(page.locator("nav .logo")).toBeVisible();
    await expect(page.locator("h1")).toHaveText("Professional Age Verification");
    await expect(page.locator("footer")).toBeVisible();
    await expect(page.locator("#avr-referral-banner")).toBeHidden();
  });

  test("starts with exactly one item block and no service preselected", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await expect(page.locator(".avr-item-card")).toHaveCount(1);
    await expect(page.locator('[data-service-option].is-selected')).toHaveCount(0);
  });
});

test.describe("DecodeMyItem referral", () => {
  test("resolved status shows the correct banner copy and prefills brand/model/category", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html?source=decodemyitem&result_status=resolved&brand=Sony&model=XBR-65X900F&category=Television%20%2F%20Home%20Electronics&result_id=RES-123");

    await expect(page.locator("#avr-referral-banner")).toBeVisible();
    await expect(page.locator("#avr-referral-copy")).toContainText("automated age estimate");
    await expect(page.locator('[data-service-option="age_verification"]')).toHaveClass(/is-selected/);

    const firstItem = page.locator(".avr-item-card").first();
    await expect(firstItem.locator('input[name$="_brand"]')).toHaveValue("Sony");
    await expect(firstItem.locator('input[name$="_model"]')).toHaveValue("XBR-65X900F");
    await expect(firstItem.locator('select[name$="_category"]')).toHaveValue("Television / Home Electronics");
    await expect(firstItem.locator('input[type="text"][name$="_serial"]')).toHaveValue("");
  });

  test("ambiguous status shows the correct banner copy", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html?source=decodemyitem&result_status=ambiguous");

    await expect(page.locator("#avr-referral-copy")).toContainText("multiple possible manufacture years");
  });

  test("no_match status shows the correct banner copy", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html?source=decodemyitem&result_status=no_match");

    await expect(page.locator("#avr-referral-copy")).toContainText("could not confirm");
  });

  test("unsupported / unknown query parameters are ignored and never rendered", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto(
      "/request-age-verification.html?source=decodemyitem&result_status=resolved&serial_number=SECRET-SN-1&claim_number=CLAIM-999&admin=true&<script>=x"
    );

    const html = await page.content();
    expect(html).not.toContain("SECRET-SN-1");
    expect(html).not.toContain("CLAIM-999");
  });

  test("without source=decodemyitem, the banner stays hidden even if other referral params are present", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html?brand=Sony&result_status=resolved");

    await expect(page.locator("#avr-referral-banner")).toBeHidden();
  });
});

test.describe("service selection", () => {
  test("clicking a service card selects it and updates the hidden select", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await page.click('[data-service-option="full_valuation"]');
    await expect(page.locator('[data-service-option="full_valuation"]')).toHaveClass(/is-selected/);
    await expect(page.locator("#avr-requested-service")).toHaveValue("full_valuation");
  });

  test("the full valuation upsell CTA selects the full valuation service and scrolls to the form", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await page.click("#avr-upsell-submit-cta");
    await expect(page.locator("#avr-requested-service")).toHaveValue("full_valuation");
  });
});

test.describe("customer-type conditional company field", () => {
  test("company becomes required for a professional customer type", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await page.selectOption("#avr-customer-type", "insurance_adjuster");
    await expect(page.locator("#avr-company")).toHaveAttribute("required", "");
    await expect(page.locator("#avr-company-optional")).toBeHidden();
  });

  test("company stays optional for a homeowner/consumer", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await page.selectOption("#avr-customer-type", "homeowner_or_consumer");
    await expect(page.locator("#avr-company")).not.toHaveAttribute("required", "");
    await expect(page.locator("#avr-company-optional")).toBeVisible();
  });
});

test.describe("missing-serial checkbox", () => {
  test("checking it disables and clears the serial input", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    const firstItem = page.locator(".avr-item-card").first();
    const serialInput = firstItem.locator('input[type="text"][name$="_serial"]');
    await serialInput.fill("SN-12345");
    await firstItem.locator(".avr-no-serial-checkbox").check();

    await expect(serialInput).toBeDisabled();
    await expect(serialInput).toHaveValue("");
  });
});

test.describe("dynamic item add/remove", () => {
  test("adding an item increases the count and each item shows its own file inputs", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await page.click("#avr-add-item");
    await expect(page.locator(".avr-item-card")).toHaveCount(2);

    const secondItem = page.locator(".avr-item-card").nth(1);
    await expect(secondItem.locator('input[type="file"][name$="_data_label_photo"]')).toHaveCount(1);
    await expect(secondItem.locator('input[type="file"][name$="_overview_photo"]')).toHaveCount(1);
  });

  test("removing an item decreases the count, and the remove button is hidden on the last remaining item", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await expect(page.locator(".avr-item-card .avr-remove-item").first()).toBeHidden();

    await page.click("#avr-add-item");
    await expect(page.locator(".avr-item-card")).toHaveCount(2);

    await page.locator(".avr-item-card").nth(1).locator(".avr-remove-item").click();
    await expect(page.locator(".avr-item-card")).toHaveCount(1);
    await expect(page.locator(".avr-item-card .avr-remove-item").first()).toBeHidden();
  });

  test("item numbers renumber correctly after removal", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await page.click("#avr-add-item");
    await page.click("#avr-add-item");
    await expect(page.locator(".avr-item-card")).toHaveCount(3);

    await page.locator(".avr-item-card").nth(0).locator(".avr-remove-item").click();
    await expect(page.locator(".avr-item-card")).toHaveCount(2);

    const numbers = await page.locator(".avr-item-number").allTextContents();
    expect(numbers).toEqual(["1", "2"]);
  });
});

test.describe("pricing guidance", () => {
  test("shows the planning-only estimate disclaimer once a service is selected", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await page.click('[data-service-option="age_verification"]');
    await expect(page.locator("#avr-estimate")).toContainText("Estimated pricing for planning purposes only.");
  });

  test("the published pricing guidance strings appear on the page", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await expect(page.locator(".avr-pricing-highlight")).toContainText(
      "Typical Professional Age Verification pricing starts at $35"
    );
    await expect(page.getByText(/does not authorize paid work/)).toBeVisible();
  });
});

async function fillRequiredContactFields(page) {
  await page.fill("#avr-full-name", "Jane Smith");
  await page.fill("#avr-email", "jane@example.com");
  await page.fill("#avr-phone", "555-555-5555");
  await page.selectOption("#avr-preferred-contact", "email");
  await page.selectOption("#avr-customer-type", "homeowner_or_consumer");
  await page.selectOption("#avr-requested-service", "age_verification");
  await page.fill("#avr-reason", "Need a supportable age estimate for a claim.");

  const firstItem = page.locator(".avr-item-card").first();
  await firstItem.locator('select[name$="_category"]').selectOption("Television / Home Electronics");
  await firstItem.locator(".avr-no-serial-checkbox").check();

  await page.check("#avr-authorization-ack");
  await page.check("#avr-limitations-ack");
}

test.describe("submission", () => {
  test("a fully valid submission shows the confirmation panel with the expected fields", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");
    await fillRequiredContactFields(page);

    await page.click("#avr-submit-btn");

    await expect(page.locator("#avr-confirmation")).toBeVisible();
    await expect(page.locator("#avr-intake-form")).toBeHidden();
    await expect(page.locator("#avr-confirm-id")).toHaveText("IAV-20260729-DEADBEEF");
    await expect(page.locator("#avr-confirm-service")).toHaveText("Professional Age Verification");
    await expect(page.locator("#avr-confirm-items")).toHaveText("1");
    await expect(page.locator("#avr-confirm-email")).toHaveText("jane@example.com");

    const confirmationText = await page.locator("#avr-confirmation").innerText();
    expect(confirmationText).not.toMatch(/order accepted/i);
    expect(confirmationText).not.toMatch(/payment confirmed/i);
    expect(confirmationText).not.toMatch(/work (has )?started/i);
    expect(confirmationText).not.toMatch(/guaranteed/i);
  });

  test("a backend error surfaces the error message and keeps the form visible", async ({ page }) => {
    await stubTurnstileAndApi(page, {
      submitResponse: { status: 400, body: { ok: false, error: "Please complete all required fields." } }
    });
    await page.goto("/request-age-verification.html");
    await fillRequiredContactFields(page);

    await page.click("#avr-submit-btn");

    await expect(page.locator("#avr-form-status")).toContainText("Please complete all required fields.");
    await expect(page.locator("#avr-intake-form")).toBeVisible();
    await expect(page.locator("#avr-confirmation")).toBeHidden();
  });

  test("client-side validation blocks submission and lists errors before hitting the network", async ({ page }) => {
    let requestCount = 0;
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await page.route("**/api/age-verification-request", async (route) => {
      if (route.request().method() === "POST") {
        requestCount += 1;
      }
      await route.continue();
    });

    await page.click("#avr-submit-btn");

    await expect(page.locator("#avr-error-summary")).toBeVisible();
    expect(requestCount).toBe(0);
  });
});

test.describe("keyboard navigation and focus", () => {
  test("service cards and the add-item button are reachable and operable via keyboard", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await page.locator('[data-service-option="age_verification"]').focus();
    await expect(page.locator('[data-service-option="age_verification"]')).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-service-option="age_verification"]')).toHaveClass(/is-selected/);

    await page.locator("#avr-add-item").focus();
    await expect(page.locator("#avr-add-item")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator(".avr-item-card")).toHaveCount(2);
  });

  test("focused interactive elements show a visible focus style", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await page.locator("#avr-full-name").focus();
    const boxShadow = await page.locator("#avr-full-name").evaluate((el) => getComputedStyle(el).boxShadow);
    expect(boxShadow).not.toBe("none");

    await page.locator('[data-service-option="age_verification"]').focus();
    const cardOutline = await page
      .locator('[data-service-option="age_verification"]')
      .evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(cardOutline).not.toBe("none");
  });
});
