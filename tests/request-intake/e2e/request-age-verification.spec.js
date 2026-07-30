const { test, expect } = require("@playwright/test");
const { stubTurnstileAndApi } = require("./helpers.js");

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "Functional flow is exercised once on desktop; see responsive.spec.js for cross-viewport checks.");
});

async function openOptionalWorkOrderDetails(page) {
  await page.click(".avr-optional-details summary");
}

test.describe("direct visit", () => {
  test("renders the shared header, compact header, and footer with no referral banner", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await expect(page.locator("nav .logo")).toBeVisible();
    await expect(page.locator("h1")).toHaveText("Submit a Work Order Request");
    await expect(page.locator("footer")).toBeVisible();
    await expect(page.locator("#avr-referral-banner")).toBeHidden();
  });

  test('defaults the information method to "Upload, paste, or provide later" and shows only that content', async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await expect(page.locator("#avr-method-upload_or_paste_list")).toBeChecked();
    await expect(page.locator("#avr-method-enter_items_now")).not.toBeChecked();
    await expect(page.locator("#avr-method-list_needs_collection")).not.toBeChecked();

    await expect(page.locator("#avr-method-content-upload_or_paste_list")).toBeVisible();
    await expect(page.locator("#avr-method-content-enter_items_now")).toBeHidden();
    await expect(page.locator("#avr-method-content-list_needs_collection")).toBeHidden();

    await expect(page.locator(".avr-item-row")).toHaveCount(0);
    await expect(page.locator("[data-service-checkbox]:checked")).toHaveCount(0);
  });

  test("the form appears immediately below the compact header -- no large marketing sections in between", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    const headerBox = await page.locator(".avr-compact-header").boundingBox();
    const formBox = await page.locator("#avr-form").boundingBox();

    expect(formBox.y).toBeGreaterThanOrEqual(headerBox.y);
    // The form section must start right after the header, not after a
    // large hero/comparison/how-it-works stack (which is now below the form).
    expect(formBox.y - (headerBox.y + headerBox.height)).toBeLessThan(20);
  });
});

test.describe("explicit information-method selection", () => {
  test('selecting "Manually enter item details" shows only that content and seeds one empty item row', async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await page.check("#avr-method-enter_items_now");

    await expect(page.locator("#avr-method-content-enter_items_now")).toBeVisible();
    await expect(page.locator("#avr-method-content-upload_or_paste_list")).toBeHidden();
    await expect(page.locator("#avr-method-content-list_needs_collection")).toBeHidden();
    await expect(page.locator(".avr-item-row")).toHaveCount(1);
    await expect(page.locator('[data-method-row="enter_items_now"]')).toHaveClass(/is-selected/);
  });

  test('selecting "Have Item Assist obtain the list" shows only the third-party contact content', async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await page.check("#avr-method-list_needs_collection");

    await expect(page.locator("#avr-method-content-list_needs_collection")).toBeVisible();
    await expect(page.locator("#avr-method-content-upload_or_paste_list")).toBeHidden();
    await expect(page.locator("#avr-method-content-enter_items_now")).toBeHidden();
  });

  test('selecting "Upload, paste, or provide later" shows only the files/paste/provide-later content', async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await page.check("#avr-method-enter_items_now");
    await page.check("#avr-method-upload_or_paste_list");

    await expect(page.locator("#avr-method-content-upload_or_paste_list")).toBeVisible();
    await expect(page.locator("#avr-method-content-enter_items_now")).toBeHidden();
    await expect(page.locator("#avr-method-content-list_needs_collection")).toBeHidden();
  });

  test("switching methods clears stale validation errors from the previously-active method", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await page.check("#avr-method-list_needs_collection");
    await page.click("#avr-submit-btn");
    await expect(page.locator("#avr-error-summary")).toBeVisible();

    await page.check("#avr-method-enter_items_now");
    await expect(page.locator("#avr-error-summary")).toBeHidden();
  });

  test("no information method selected blocks submission", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");
    await fillUniversalFieldsWithoutMethod(page);

    await page.click("#avr-submit-btn");

    await expect(page.locator("#avr-error-summary")).toContainText(/how you are providing the item information/);
  });
});

test.describe("DecodeMyItem referral", () => {
  test('resolved status shows the correct banner copy, preselects Age Verification, selects "Manually enter item details," and prefills brand/model/category', async ({ page }) => {
    await stubTurnstileAndApi(page);
    // "category=electronics" is DecodeMyItem's real internal key (not a
    // form option label) -- this exercises the actual cross-site contract,
    // not a coincidentally-matching literal string. See "category mapping"
    // describe block below for full key coverage.
    await page.goto("/request-age-verification.html?source=decodemyitem&result_status=resolved&brand=Sony&model=XBR-65X900F&category=electronics&result_id=RES-123");

    await expect(page.locator("#avr-referral-banner")).toBeVisible();
    await expect(page.locator("#avr-referral-copy")).toContainText("automated age estimate");
    await expect(page.locator("#avr-service-age_verification")).toBeChecked();
    await expect(page.locator("#avr-method-enter_items_now")).toBeChecked();
    await expect(page.locator("#avr-method-content-enter_items_now")).toBeVisible();

    const firstItem = page.locator(".avr-item-row").first();
    await expect(firstItem.locator('input[name$="_brand"]')).toHaveValue("Sony");
    await expect(firstItem.locator('input[name$="_model"]')).toHaveValue("XBR-65X900F");
    await expect(firstItem.locator('select[name$="_category"]')).toHaveValue("Television / Home Electronics");
    await expect(firstItem.locator('input[type="text"][name$="_serial"]')).toHaveValue("");

    // The select and the method radios must remain fully user-editable.
    await expect(firstItem.locator('select[name$="_category"]')).toBeEnabled();
    await expect(page.locator("#avr-method-upload_or_paste_list")).toBeEnabled();
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

  test('without source=decodemyitem, the banner stays hidden and the default method is "Upload, paste, or provide later" (not Manually enter item details)', async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html?brand=Sony&result_status=resolved");

    await expect(page.locator("#avr-referral-banner")).toBeHidden();
    await expect(page.locator("#avr-method-upload_or_paste_list")).toBeChecked();
    await expect(page.locator("#avr-method-enter_items_now")).not.toBeChecked();
    await expect(page.locator("#avr-service-age_verification")).not.toBeChecked();
  });
});

test.describe("DecodeMyItem category prefill mapping", () => {
  for (const [key, expectedOption] of [
    ["electronics", "Television / Home Electronics"],
    ["appliances", "Major Household Appliance"],
    ["hvac", "HVAC Equipment"],
    ["waterHeaters", "Water Heater"]
  ]) {
    test(`category=${key} maps to "${expectedOption}"`, async ({ page }) => {
      await stubTurnstileAndApi(page);
      await page.goto(`/request-age-verification.html?source=decodemyitem&result_status=resolved&category=${encodeURIComponent(key)}`);

      const categorySelect = page.locator(".avr-item-row").first().locator('select[name$="_category"]');
      await expect(categorySelect).toHaveValue(expectedOption);
      await expect(categorySelect).toBeEnabled();
    });
  }

  test("an unknown category key leaves the field unselected instead of forcing a value", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html?source=decodemyitem&result_status=resolved&category=furniture");

    const categorySelect = page.locator(".avr-item-row").first().locator('select[name$="_category"]');
    await expect(categorySelect).toHaveValue("");
    await expect(categorySelect).toBeEnabled();
  });

  test("without source=decodemyitem, a category param is never applied -- direct-visitor behavior is unchanged", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html?category=electronics");

    await expect(page.locator("#avr-referral-banner")).toBeHidden();
    await expect(page.locator(".avr-item-row")).toHaveCount(0);
  });

  test("the mapped category can still be changed by the user", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html?source=decodemyitem&result_status=resolved&category=hvac");

    const categorySelect = page.locator(".avr-item-row").first().locator('select[name$="_category"]');
    await expect(categorySelect).toHaveValue("HVAC Equipment");

    await categorySelect.selectOption("Power Tool");
    await expect(categorySelect).toHaveValue("Power Tool");
  });

  test("a category value that already exactly matches a valid option label is passed through unchanged", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto(`/request-age-verification.html?source=decodemyitem&result_status=resolved&category=${encodeURIComponent("Water Heater")}`);

    const categorySelect = page.locator(".avr-item-row").first().locator('select[name$="_category"]');
    await expect(categorySelect).toHaveValue("Water Heater");
    await expect(categorySelect).toBeEnabled();
  });
});

test.describe("requested-services multi-select (compact row list)", () => {
  test("selecting one service checks only that row and applies the selected styling", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await page.check("#avr-service-age_verification");
    await expect(page.locator("#avr-service-age_verification")).toBeChecked();
    await expect(page.locator("#avr-service-item_pricing_valuation")).not.toBeChecked();
    await expect(page.locator('[data-service-card="age_verification"]')).toHaveClass(/is-selected/);
  });

  test("selecting multiple services checks each of them independently", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await page.check("#avr-service-age_verification");
    await page.check("#avr-service-item_list_collection");

    await expect(page.locator("#avr-service-age_verification")).toBeChecked();
    await expect(page.locator("#avr-service-item_list_collection")).toBeChecked();
    await expect(page.locator("#avr-service-item_pricing_valuation")).not.toBeChecked();
  });

  test('"All of the Above" selects exactly the three concrete services', async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await page.check("#avr-service-all");

    await expect(page.locator("#avr-service-age_verification")).toBeChecked();
    await expect(page.locator("#avr-service-item_pricing_valuation")).toBeChecked();
    await expect(page.locator("#avr-service-item_list_collection")).toBeChecked();
    await expect(page.locator("#avr-service-unsure")).not.toBeChecked();
  });

  test("selecting Unsure clears every concrete service", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await page.check("#avr-service-age_verification");
    await page.check("#avr-service-unsure");

    await expect(page.locator("#avr-service-unsure")).toBeChecked();
    await expect(page.locator("#avr-service-age_verification")).not.toBeChecked();
  });

  test("selecting a concrete service clears Unsure", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await page.check("#avr-service-unsure");
    await page.check("#avr-service-item_pricing_valuation");

    await expect(page.locator("#avr-service-item_pricing_valuation")).toBeChecked();
    await expect(page.locator("#avr-service-unsure")).not.toBeChecked();
  });

  test('manually deselecting one concrete service after "All of the Above" un-checks the shortcut', async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await page.check("#avr-service-all");
    await expect(page.locator("#avr-service-all")).toBeChecked();

    await page.uncheck("#avr-service-item_list_collection");
    await expect(page.locator("#avr-service-all")).not.toBeChecked();
    await expect(page.locator("#avr-service-age_verification")).toBeChecked();
    await expect(page.locator("#avr-service-item_pricing_valuation")).toBeChecked();
  });

  test("the Age-Verification-specific limitations acknowledgement only appears when Age Verification is selected without Item Pricing / Valuation", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await expect(page.locator("#avr-av-limitations-row")).toBeHidden();

    await page.check("#avr-service-age_verification");
    await expect(page.locator("#avr-av-limitations-row")).toBeVisible();

    await page.check("#avr-service-item_pricing_valuation");
    await expect(page.locator("#avr-av-limitations-row")).toBeHidden();
  });

  test('the upsell CTA adds Item Pricing / Valuation without clearing an already-selected service', async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await page.check("#avr-service-age_verification");
    await page.click("#avr-upsell-submit-cta");

    await expect(page.locator("#avr-service-age_verification")).toBeChecked();
    await expect(page.locator("#avr-service-item_pricing_valuation")).toBeChecked();
  });
});

test.describe("optional work-order details", () => {
  test("customer type, preferred contact, and company live inside the collapsed optional-details disclosure", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await expect(page.locator("#avr-customer-type")).toBeHidden();
    await openOptionalWorkOrderDetails(page);
    await expect(page.locator("#avr-customer-type")).toBeVisible();
    await expect(page.locator("#avr-preferred-contact")).toBeVisible();
    await expect(page.locator("#avr-company")).toBeVisible();
    await expect(page.locator("#avr-claim-reference")).toBeVisible();
    await expect(page.locator("#avr-insured-name")).toBeVisible();
    await expect(page.locator("#avr-completion-date")).toBeVisible();
    await expect(page.locator("#avr-billing-contact")).toBeVisible();
    await expect(page.locator("#avr-po-required")).toBeVisible();
    await expect(page.locator("#avr-special-reporting")).toBeVisible();
  });

  test("company becomes required for a professional customer type", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");
    await openOptionalWorkOrderDetails(page);

    await page.selectOption("#avr-customer-type", "insurance_adjuster");
    await expect(page.locator("#avr-company")).toHaveAttribute("required", "");
    await expect(page.locator("#avr-company-optional")).toBeHidden();
  });

  test("company stays optional for a homeowner/consumer", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");
    await openOptionalWorkOrderDetails(page);

    await page.selectOption("#avr-customer-type", "homeowner_or_consumer");
    await expect(page.locator("#avr-company")).not.toHaveAttribute("required", "");
    await expect(page.locator("#avr-company-optional")).toBeVisible();
  });
});

test.describe("missing-serial checkbox", () => {
  test("checking it disables and clears the serial input", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");
    await page.check("#avr-method-enter_items_now");

    const firstItem = page.locator(".avr-item-row").first();
    const serialInput = firstItem.locator('input[type="text"][name$="_serial"]');
    await serialInput.fill("SN-12345");
    await firstItem.locator(".avr-no-serial-checkbox").check();

    await expect(serialInput).toBeDisabled();
    await expect(serialInput).toHaveValue("");
  });
});

test.describe("dynamic item add/remove", () => {
  test("adding an item increases the count and each item shows a description field", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");
    await page.check("#avr-method-enter_items_now");

    await page.click("#avr-add-item");
    await expect(page.locator(".avr-item-row")).toHaveCount(2);

    const secondItem = page.locator(".avr-item-row").nth(1);
    await expect(secondItem.locator('input[name$="_description"]')).toHaveCount(1);
  });

  test("removing an item decreases the count and can go down to zero rows", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");
    await page.check("#avr-method-enter_items_now");

    await expect(page.locator(".avr-item-row")).toHaveCount(1);

    await page.locator(".avr-item-row").first().locator(".avr-remove-item").click();
    await expect(page.locator(".avr-item-row")).toHaveCount(0);
  });

  test("item numbers renumber correctly after removal", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");
    await page.check("#avr-method-enter_items_now");

    await page.click("#avr-add-item");
    await page.click("#avr-add-item");
    await expect(page.locator(".avr-item-row")).toHaveCount(3);

    await page.locator(".avr-item-row").nth(0).locator(".avr-remove-item").click();
    await expect(page.locator(".avr-item-row")).toHaveCount(2);

    const numbers = await page.locator(".avr-item-number-badge").allTextContents();
    expect(numbers).toEqual(["1", "2"]);
  });
});

test.describe("pricing guidance", () => {
  test("the compact pricing notice appears above the form, with no live estimate calculator", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await expect(page.locator(".avr-compact-notice")).toContainText("No charge to submit");
    await expect(page.locator(".avr-compact-notice")).toContainText("Volume and coordination pricing may apply");
    await expect(page.locator("#avr-estimate")).toHaveCount(0);
  });

  test("detailed pricing information appears below the form", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    const formBox = await page.locator("#avr-form").boundingBox();
    const detailBox = await page.locator(".avr-pricing-detail-section").boundingBox();

    expect(detailBox.y).toBeGreaterThan(formBox.y + formBox.height - 50);
    await expect(page.locator(".avr-pricing-detail-section")).toContainText("typically starts at $35");
  });
});

test.describe("upload, paste, or provide later (default method)", () => {
  test("shows the centralized upload limit copy and the larger-list fallback message", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await expect(page.locator("#avr-method-content-upload_or_paste_list")).toBeVisible();
    await expect(page.locator("#avr-upload-limit-copy")).toHaveText("Upload up to 2 files, with a maximum combined size of 3.5 MB.");
    await expect(page.getByText(/Have a larger item list or supporting file/)).toBeVisible();
  });

  test('submission succeeds with only "I will provide the full item list after Item Assist contacts me" checked', async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");
    await fillUniversalFields(page);
    await page.check("#avr-method-upload_or_paste_list");
    await page.check("#avr-will-provide-later");

    await page.click("#avr-submit-btn");

    await expect(page.locator("#avr-confirmation")).toBeVisible();
  });

  test("submission succeeds with only pasted list text", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");
    await fillUniversalFields(page);
    await page.check("#avr-method-upload_or_paste_list");
    await page.fill("#avr-pasted-list", "TV, refrigerator, microwave");

    await page.click("#avr-submit-btn");

    await expect(page.locator("#avr-confirmation")).toBeVisible();
  });

  test("submission is blocked when no file, no pasted text, and no will-provide-later flag is present", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");
    await fillUniversalFields(page);
    await page.check("#avr-method-upload_or_paste_list");

    await page.click("#avr-submit-btn");

    await expect(page.locator("#avr-error-summary")).toBeVisible();
    await expect(page.locator("#avr-confirmation")).toBeHidden();
  });
});

test.describe("have Item Assist obtain the list", () => {
  test("submission succeeds with authorization confirmed and an email-only third-party contact", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");
    await fillUniversalFields(page);
    await page.check("#avr-method-list_needs_collection");
    await page.fill("#avr-tp-name", "John Insured");
    await page.fill("#avr-tp-email", "john@example.com");
    await page.check("#avr-tp-authorization-ack");

    await page.click("#avr-submit-btn");

    await expect(page.locator("#avr-confirmation")).toBeVisible();
  });

  test("submission is blocked without the third-party authorization acknowledgement", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");
    await fillUniversalFields(page);
    await page.check("#avr-method-list_needs_collection");
    await page.fill("#avr-tp-name", "John Insured");
    await page.fill("#avr-tp-email", "john@example.com");

    await page.click("#avr-submit-btn");

    await expect(page.locator("#avr-error-summary")).toBeVisible();
    await expect(page.locator("#avr-confirmation")).toBeHidden();
  });

  test("third-party contact information never appears in the page URL or in dispatched analytics events", async ({ page }) => {
    await stubTurnstileAndApi(page);
    const analyticsEvents = [];
    await page.exposeFunction("__captureAnalytics", (detail) => analyticsEvents.push(detail));
    await page.addInitScript(() => {
      window.addEventListener("itemassist:analytics", (event) => window.__captureAnalytics(event.detail));
    });

    await page.goto("/request-age-verification.html");
    await fillUniversalFields(page);
    await page.check("#avr-method-list_needs_collection");
    await page.fill("#avr-tp-name", "John Insured");
    await page.fill("#avr-tp-email", "john-secret@example.com");
    await page.fill("#avr-tp-phone", "555-000-1111");
    await page.check("#avr-tp-authorization-ack");

    await page.click("#avr-submit-btn");
    await expect(page.locator("#avr-confirmation")).toBeVisible();

    expect(page.url()).not.toContain("john-secret");
    expect(page.url()).not.toContain("555-000-1111");

    const serializedEvents = JSON.stringify(analyticsEvents);
    expect(serializedEvents).not.toContain("john-secret");
    expect(serializedEvents).not.toContain("555-000-1111");
    expect(serializedEvents).not.toContain("John Insured");
  });
});

async function fillUniversalFields(page) {
  await page.fill("#avr-full-name", "Jane Smith");
  await page.fill("#avr-email", "jane@example.com");
  await page.check("#avr-service-age_verification");
  await page.fill("#avr-reason", "Need a supportable age estimate for a claim.");
  await page.check("#avr-universal-ack");
  await page.check("#avr-limitations-ack");
}

async function fillUniversalFieldsWithoutMethod(page) {
  await fillUniversalFields(page);
  // Direct visitors default to upload_or_paste_list; explicitly uncheck all
  // radios via JS to simulate "no method selected" for the validation test.
  await page.evaluate(() => {
    document.querySelectorAll('input[name="information_method"]').forEach((radio) => {
      radio.checked = false;
    });
  });
}

async function fillRequiredContactFields(page) {
  await page.fill("#avr-full-name", "Jane Smith");
  await page.fill("#avr-email", "jane@example.com");
  await page.fill("#avr-phone", "555-555-5555");
  await openOptionalWorkOrderDetails(page);
  await page.selectOption("#avr-preferred-contact", "email");
  await page.selectOption("#avr-customer-type", "homeowner_or_consumer");
  await page.check("#avr-service-age_verification");
  await page.fill("#avr-reason", "Need a supportable age estimate for a claim.");
  await page.check("#avr-method-enter_items_now");

  const firstItem = page.locator(".avr-item-row").first();
  await firstItem.locator('input[name$="_description"]').fill("Living room television");
  await firstItem.locator('select[name$="_category"]').selectOption("Television / Home Electronics");
  await firstItem.locator(".avr-no-serial-checkbox").check();

  await page.check("#avr-universal-ack");
  await page.check("#avr-limitations-ack");
}

test.describe("minimum submission", () => {
  test("a valid request with only universal required fields succeeds (no phone, no company, no customer type)", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");
    await fillUniversalFields(page);
    await page.check("#avr-method-enter_items_now");
    await page.locator(".avr-item-row").first().locator('input[name$="_description"]').fill("Living room television");

    await page.click("#avr-submit-btn");

    await expect(page.locator("#avr-confirmation")).toBeVisible();
  });

  test("missing a required universal field blocks submission", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");
    await fillUniversalFields(page);
    await page.fill("#avr-full-name", "");
    await page.check("#avr-method-enter_items_now");
    await page.locator(".avr-item-row").first().locator('input[name$="_description"]').fill("Living room television");

    await page.click("#avr-submit-btn");

    await expect(page.locator("#avr-error-summary")).toBeVisible();
    await expect(page.locator("#avr-confirmation")).toBeHidden();
  });

  test("an item without a description blocks submission under Manually enter item details", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");
    await fillUniversalFields(page);
    await page.check("#avr-method-enter_items_now");

    await page.click("#avr-submit-btn");

    await expect(page.locator("#avr-error-summary")).toBeVisible();
    await expect(page.locator("#avr-confirmation")).toBeHidden();
  });
});

test.describe("submission", () => {
  test("a fully valid submission shows the confirmation panel with the expected fields", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");
    await fillRequiredContactFields(page);

    await page.click("#avr-submit-btn");

    await expect(page.locator("#avr-confirmation")).toBeVisible();
    await expect(page.locator("#avr-intake-form")).toBeHidden();
    await expect(page.locator("#avr-confirm-id")).toHaveText("IAV-20260729-DEADBEEF");
    await expect(page.locator("#avr-confirm-service")).toHaveText("Age Verification");
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
  test("service checkboxes and the add-item button are reachable and operable via keyboard", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await page.locator("#avr-service-age_verification").focus();
    await expect(page.locator("#avr-service-age_verification")).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.locator("#avr-service-age_verification")).toBeChecked();

    await page.check("#avr-method-enter_items_now");
    await page.locator("#avr-add-item").focus();
    await expect(page.locator("#avr-add-item")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator(".avr-item-row")).toHaveCount(2);
  });

  test("focused interactive elements show a visible focus style", async ({ page }) => {
    await stubTurnstileAndApi(page);
    await page.goto("/request-age-verification.html");

    await page.locator("#avr-full-name").focus();
    const boxShadow = await page.locator("#avr-full-name").evaluate((el) => getComputedStyle(el).boxShadow);
    expect(boxShadow).not.toBe("none");

    await page.locator("#avr-service-age_verification").focus();
    const outline = await page.locator("#avr-service-age_verification").evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
  });
});
