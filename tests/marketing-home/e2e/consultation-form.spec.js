const { test, expect, stubSite, fillConsultation, openHome } = require("./helpers.js");

const submit = (page) => page.locator("#consultation-form .form-submit");

test("a valid inquiry posts JSON once to the consultation endpoint and shows an accessible confirmation", async ({ page }) => {
  const calls = await stubSite(page);
  await openHome(page);
  await fillConsultation(page, { company: "Smith Adjusting", phone: "(555) 555-5555", count: "11-50", description: "About thirty items." });
  await submit(page).click();

  await expect(page.locator("#consult-success")).toBeVisible();
  await expect(page.locator("#consult-success")).toBeFocused();
  await expect(page.locator("#consult-success")).toHaveAttribute("role", "status");
  await expect(page.locator("#consult-success h3")).toContainText("your request was received");
  await expect(page.locator("#consultation-form")).toBeHidden();

  expect(calls.consultation).toHaveLength(1);
  expect(calls.contact).toHaveLength(0);
  const [{ headers, body }] = calls.consultation;
  expect(headers["content-type"]).toContain("application/json");
  expect(body).toMatchObject({
    name: "Jane Smith",
    email: "jane@example.com",
    reason: "contents_research",
    company: "Smith Adjusting",
    phone: "(555) 555-5555",
    item_count: "11-50",
    description: "About thirty items.",
    website: "",
    turnstileToken: "fake-turnstile-token"
  });
  expect(body.submission_id).toMatch(/^sub_[A-Za-z0-9-]{16,}$/);
  // Only the documented fields are sent: no files, claim information or payment details.
  expect(Object.keys(body).sort()).toEqual(
    ["company", "description", "email", "item_count", "name", "phone", "reason", "submission_id", "turnstileToken", "website"].sort()
  );
});

test("only name, email and a reason are required", async ({ page }) => {
  const calls = await stubSite(page);
  await openHome(page);
  await fillConsultation(page);
  await submit(page).click();
  await expect(page.locator("#consult-success")).toBeVisible();
  expect(calls.consultation).toHaveLength(1);
  expect(calls.consultation[0].body).toMatchObject({ company: "", phone: "", item_count: "", description: "" });
  for (const id of ["#consult-company", "#consult-phone", "#consult-count", "#consult-description"]) {
    await expect(page.locator(id)).not.toHaveAttribute("required", "");
  }
});

test("submitting an empty form explains each missing field, focuses the first, and sends nothing", async ({ page }) => {
  const calls = await stubSite(page);
  await openHome(page);
  await submit(page).click();

  const messages = {
    name: "Please enter your name.",
    email: "Please enter your email address.",
    reason: "Please choose a reason for your inquiry."
  };
  for (const [id, message] of Object.entries(messages)) {
    await expect(page.locator(`#consult-${id}`)).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator(`#consult-${id}-error`)).toBeVisible();
    await expect(page.locator(`#consult-${id}-error`)).toHaveText(message);
    // The message is tied to its field for assistive technology.
    await expect(page.locator(`#consult-${id}`)).toHaveAttribute("aria-describedby", new RegExp(`consult-${id}-error`));
  }
  await expect(page.locator("#consult-name")).toBeFocused();
  await expect(page.locator("#consult-status")).toHaveAttribute("role", "alert");
  await expect(page.locator("#consult-status")).toHaveText("Please fix the highlighted fields and try again.");
  await expect(page.locator("#consult-company-error")).toBeHidden();
  expect(calls.consultation).toHaveLength(0);
});

test("an invalid email or phone is explained, and the message clears when the value is corrected", async ({ page }) => {
  const calls = await stubSite(page);
  await openHome(page);
  await fillConsultation(page, { email: "jane@", phone: "12" });
  await submit(page).click();

  await expect(page.locator("#consult-email-error")).toHaveText("Please enter a valid email address.");
  await expect(page.locator("#consult-phone-error")).toContainText("(555) 555-5555");
  await expect(page.locator("#consult-email")).toBeFocused();
  expect(calls.consultation).toHaveLength(0);

  await page.locator("#consult-email").fill("jane@example.com");
  await expect(page.locator("#consult-email-error")).toBeHidden();
  await expect(page.locator("#consult-email")).not.toHaveAttribute("aria-invalid", "true");
  await page.locator("#consult-phone").fill("(555) 555-5555");
  await expect(page.locator("#consult-phone-error")).toBeHidden();
});

test("a duplicate click while sending produces one request", async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = await stubSite(page);
  await page.unroute("**/api/consultation-request");
  await page.route("**/api/consultation-request", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ turnstileSiteKey: "k" }) });
    }
    calls.consultation.push({ body: route.request().postDataJSON() });
    await gate;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await openHome(page);
  await fillConsultation(page);

  await submit(page).click();
  await expect(submit(page)).toBeDisabled();
  await expect(submit(page)).toHaveText("Sending...");
  await expect(page.locator("#consultation-form")).toHaveAttribute("aria-busy", "true");
  await submit(page).click({ force: true }).catch(() => {});
  await page.locator("#consult-name").press("Enter");
  release();
  await expect(page.locator("#consult-success")).toBeVisible();
  expect(calls.consultation).toHaveLength(1);
});

test("a server rejection of one field is shown on that field", async ({ page }) => {
  const calls = await stubSite(page, { consultation: { status: 400, body: { ok: false, error: "Please enter a valid email address.", errors: { email: "Please enter a valid email address." } } } });
  await openHome(page);
  await fillConsultation(page);
  await submit(page).click();

  await expect(page.locator("#consult-email-error")).toHaveText("Please enter a valid email address.");
  await expect(page.locator("#consult-email")).toBeFocused();
  await expect(page.locator("#consult-status")).toHaveAttribute("role", "alert");
  await expect(page.locator("#consultation-form")).toBeVisible();
  await expect(page.locator("#consult-success")).toBeHidden();
  expect(calls.consultation).toHaveLength(1);
});

test("a send failure keeps the visitor's entries, says so plainly, and a retry reuses the same submission id", async ({ page }) => {
  const calls = await stubSite(page, {
    consultation: (n) => (n === 1 ? { status: 502, body: { ok: false, error: "We couldn't send your request. Please try again, or email submissions@itemassist.com." } } : undefined)
  });
  await openHome(page);
  await fillConsultation(page, { description: "Keep me." });
  await submit(page).click();

  await expect(page.locator("#consult-status")).toHaveAttribute("role", "alert");
  await expect(page.locator("#consult-status")).toContainText("submissions@itemassist.com");
  await expect(page.locator("#consult-description")).toHaveValue("Keep me.");
  await expect(submit(page)).toBeEnabled();
  expect(await page.evaluate(() => window.__turnstileResets)).toBeGreaterThanOrEqual(1);

  await page.waitForTimeout(4200); // the short lock between attempts
  await submit(page).click();
  await expect(page.locator("#consult-success")).toBeVisible();
  expect(calls.consultation).toHaveLength(2);
  expect(calls.consultation[1].body.submission_id).toBe(calls.consultation[0].body.submission_id);
});

test("a network failure is reported without losing the form", async ({ page }) => {
  await stubSite(page);
  await page.unroute("**/api/consultation-request");
  await page.route("**/api/consultation-request", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ turnstileSiteKey: "k" }) })
      : route.abort("failed")
  );
  await openHome(page);
  await fillConsultation(page);
  await submit(page).click();
  await expect(page.locator("#consult-status")).toContainText("couldn't reach the server");
  await expect(page.locator("#consult-name")).toHaveValue("Jane Smith");
});

test("a campaign tag in the URL travels with the inquiry, including after browsing on", async ({ page }) => {
  const calls = await stubSite(page);
  await openHome(page, "/index.html?utm_source=linkedin&utm_medium=social&utm_campaign=launch-nov");
  await page.goto("/index.html");
  await expect(page.locator('#consultation-form[data-turnstile-ready="true"]')).toBeAttached();
  await fillConsultation(page);
  await submit(page).click();
  await expect(page.locator("#consult-success")).toBeVisible();
  expect(calls.consultation[0].body).toMatchObject({ utm_source: "linkedin", utm_medium: "social", utm_campaign: "launch-nov" });
});

test("a direct visit sends no source, and nothing the visitor types is kept in browser storage", async ({ page }) => {
  const calls = await stubSite(page);
  await openHome(page);
  await fillConsultation(page, { description: "Private note." });
  await submit(page).click();
  await expect(page.locator("#consult-success")).toBeVisible();
  const body = calls.consultation[0].body;
  expect(["utm_source", "utm_medium", "utm_campaign", "ref"].filter((key) => key in body)).toEqual([]);
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(stored).not.toMatch(/Jane|jane@example|Private note/);
});

test("service cards that start a consultation preselect the matching reason", async ({ page }) => {
  await stubSite(page);
  await openHome(page);
  await page.locator('[data-consult-reason="individual_item"]').click();
  await expect(page.locator("#consult-reason")).toHaveValue("individual_item");
  await page.locator('[data-consult-reason="ongoing_support"]').click();
  await expect(page.locator("#consult-reason")).toHaveValue("ongoing_support");
  await expect(page).toHaveURL(/#consultation$/);
});

test("every field has a visible label, and the spam trap is hidden from people and assistive technology", async ({ page }) => {
  await stubSite(page);
  await openHome(page);
  const form = page.locator("#consultation-form");
  for (const label of ["Name", "Email", "Reason for inquiry", "Company", "Phone", "Approximate item count", "Short description"]) {
    await expect(form.getByLabel(label)).toBeVisible();
  }
  await expect(form.locator(".form-honeypot")).toHaveAttribute("aria-hidden", "true");
  await expect(form.locator("#consult-website")).toHaveAttribute("tabindex", "-1");
  await expect(form.locator("#consult-website")).not.toBeInViewport();
  await expect(form).toHaveAttribute("novalidate", "");
  await expect(page.locator("#consult-status")).toHaveAttribute("aria-live", "polite");
});

test("the assignment form still submits to its own endpoint and never touches the consultation endpoint", async ({ page }) => {
  const calls = await stubSite(page);
  await page.goto("/");
  await expect(page.locator("#contact-form")).toBeAttached();
  await page.locator("#contact-name").fill("Alex Adjuster");
  await page.locator("#email").fill("alex@example.com");
  await page.locator("#assignment-notes").fill("Forty items, mostly electronics.");
  await page.waitForFunction(() => document.querySelector("#contact-form .form-turnstile"), null, { timeout: 5000 });
  await page.locator("#contact-form .form-submit").scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator("#form-status").textContent(), { timeout: 5000 }).not.toMatch(/could not load/);
  await page.locator("#contact-form .form-submit").click();

  await expect(page.locator("#form-status")).toContainText("Contents list received");
  expect(calls.contact).toHaveLength(1);
  expect(calls.contact[0].headers["content-type"]).toContain("multipart/form-data");
  expect(calls.contact[0].body).toContain("Alex Adjuster");
  expect(calls.contact[0].body).toContain("Forty items, mostly electronics.");
  expect(calls.consultation).toHaveLength(0);
});
