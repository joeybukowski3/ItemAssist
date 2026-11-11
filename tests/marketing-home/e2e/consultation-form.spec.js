const { test, expect, stubSite, fillConsultation, openHome, horizontalOverflow } = require("./helpers.js");

const submit = (page) => page.locator("#consultation-form .form-submit");

test("a valid inquiry posts JSON once to the consultation endpoint and shows an accessible confirmation", async ({ page }) => {
  const calls = await stubSite(page);
  await openHome(page);
  await fillConsultation(page, { company: "Smith & Co", phone: "(555) 555-5555", description: "A dishwasher that is no longer sold." });
  await submit(page).click();

  await expect(page.locator("#consult-success")).toBeVisible();
  await expect(page.locator("#consult-success")).toBeFocused();
  await expect(page.locator("#consult-success")).toHaveAttribute("role", "status");
  await expect(page.locator("#consult-success h3")).toContainText("your message was received");
  await expect(page.locator("#consultation-form")).toBeHidden();

  expect(calls.consultation).toHaveLength(1);
  expect(calls.contact).toHaveLength(0);
  const [{ headers, body }] = calls.consultation;
  expect(headers["content-type"]).toContain("application/json");
  expect(body).toMatchObject({
    name: "Jane Smith",
    email: "jane@example.com",
    reason: "human_research",
    company: "Smith & Co",
    phone: "(555) 555-5555",
    description: "A dishwasher that is no longer sold.",
    website: "",
    turnstileToken: "fake-turnstile-token"
  });
  expect(body.submission_id).toMatch(/^sub_[A-Za-z0-9-]{16,}$/);
  // Only the documented fields are sent: no files, no research text and no payment details.
  expect(Object.keys(body).sort()).toEqual(["company", "description", "email", "name", "phone", "reason", "submission_id", "turnstileToken", "website"].sort());
});

test("only name, email and the reason for the inquiry are required", async ({ page }) => {
  const calls = await stubSite(page);
  await openHome(page);
  await fillConsultation(page);
  await submit(page).click();
  await expect(page.locator("#consult-success")).toBeVisible();
  expect(calls.consultation).toHaveLength(1);
  expect(calls.consultation[0].body).toMatchObject({ company: "", phone: "", description: "" });
  for (const id of ["#consult-company", "#consult-phone", "#consult-description"]) {
    await expect(page.locator(id)).not.toHaveAttribute("required", "");
    await expect(page.locator(id)).not.toHaveAttribute("aria-required", "true");
  }
  for (const id of ["#consult-name", "#consult-email", "#consult-reason"]) await expect(page.locator(id)).toHaveAttribute("aria-required", "true");
});

test("submitting an empty form explains each missing required field, focuses the first, and sends nothing", async ({ page }) => {
  const calls = await stubSite(page);
  await openHome(page);
  await submit(page).click();

  const messages = {
    name: "Please enter your name.",
    email: "Please enter your email address.",
    reason: "Please choose a request type."
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
  // The optional fields are never flagged, not even the description before a request type is chosen.
  for (const id of ["company", "phone", "description"]) await expect(page.locator(`#consult-${id}-error`)).toBeHidden();
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

test("a missing spam-protection token stops the submission before it is sent", async ({ page }) => {
  const calls = await stubSite(page);
  await page.addInitScript(() => { window.turnstile.getResponse = () => ""; });
  await openHome(page);
  await fillConsultation(page);
  await submit(page).click();
  await expect(page.locator("#consult-status")).toHaveText("Please complete the spam protection check before submitting.");
  expect(calls.consultation).toHaveLength(0);
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

test("every field has a visible label, and the spam trap is hidden from people and assistive technology", async ({ page }) => {
  await stubSite(page);
  await openHome(page);
  const form = page.locator("#consultation-form");
  for (const label of ["Name", "Email", "Reason for inquiry", "Company", "Phone", "Brief description"]) {
    await expect(form.getByLabel(label)).toBeVisible();
  }
  await expect(form.locator(".form-honeypot")).toHaveAttribute("aria-hidden", "true");
  await expect(form.locator("#consult-website")).toHaveAttribute("tabindex", "-1");
  await expect(form.locator("#consult-website")).not.toBeInViewport();
  await expect(form).toHaveAttribute("novalidate", "");
  await expect(page.locator("#consult-status")).toHaveAttribute("aria-live", "polite");
});

test("the research composer's send button and the contact form's submit button have distinct accessible names, and no two visible buttons share one", async ({ page }) => {
  await stubSite(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Submit Inquiry" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /send message/i })).toHaveCount(1); // nothing else is a near-match for the composer's button
  const names = await page.evaluate(() => [...document.querySelectorAll("button")]
    .filter((button) => !button.closest("[hidden]") && !button.hidden)
    .map((button) => (button.getAttribute("aria-label") || button.textContent).replace(/\s+/g, " ").trim().toLowerCase()));
  const repeated = names.filter((name, index) => names.indexOf(name) !== index);
  expect(repeated, "accessible names repeated across buttons").toEqual([]);
});

test("the reason for the inquiry offers exactly the three research-site inquiry types", async ({ page }) => {
  await stubSite(page);
  await openHome(page);
  const options = page.locator("#consult-reason option");
  await expect(options).toHaveText(["Choose one…", "Request Human-Reviewed Research", "Ask About Additional or Paid Access", "General Question"]);
  await expect(options.evaluateAll((nodes) => nodes.map((node) => node.value))).resolves.toEqual(["", "human_research", "paid_access", "general_question"]);
});

test("each inquiry type is sent as chosen, so the server can label the notification", async ({ page }) => {
  for (const reason of ["human_research", "paid_access", "general_question"]) {
    const calls = await stubSite(page);
    await openHome(page);
    await fillConsultation(page, { reason });
    await submit(page).click();
    await expect(page.locator("#consult-success")).toBeVisible();
    expect(calls.consultation, reason).toHaveLength(1);
    expect(calls.consultation[0].body.reason).toBe(reason);
    expect(calls.contact).toHaveLength(0);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});

test("the description is optional: a blank or spaces-only description is sent as empty and accepted", async ({ page }) => {
  const calls = await stubSite(page);
  await openHome(page);
  await fillConsultation(page);
  await page.locator("#consult-description").fill("   ");
  await submit(page).click();
  await expect(page.locator("#consult-success")).toBeVisible();
  expect(calls.consultation[0].body.description).toBe("");
});

test("links can preselect an inquiry type; unknown and retired values are ignored, not guessed at", async ({ page }) => {
  await stubSite(page);
  await page.goto("/index.html?consult=human_research");
  await expect(page.locator("#consult-reason")).toHaveValue("human_research");
  await page.goto("/index.html?consult=paid_access");
  await expect(page.locator("#consult-reason")).toHaveValue("paid_access");
  await page.goto("/index.html?consult=general_question");
  await expect(page.locator("#consult-reason")).toHaveValue("general_question");
  for (const retired of ["consultation", "research_request", "exploring", "individual_item"]) {
    await page.goto(`/index.html?consult=${retired}`);
    await expect(page.locator("#consult-reason")).toHaveValue("");
  }
  // The retired assignment anchor no longer selects anything on this form.
  await page.goto("/index.html#submit-assignment");
  await expect(page.locator("#consult-reason")).toHaveValue("");
});

test("the header Contact link and the footer lead to the contact section and the privacy policy", async ({ page }) => {
  await stubSite(page);
  await page.goto("/");
  await page.locator('header a[href="#contact"]').click();
  await expect(page).toHaveURL(/#contact$/);
  await expect(page.locator("#contact")).toBeInViewport();
  await expect(page.locator("#consultation-heading")).toHaveText("Ask a question or request human-reviewed research");
  await expect(page.locator('#consult-privacy a[href="/privacy"]')).toBeVisible();
  await expect(page.locator('footer a[href="/privacy"]')).toBeVisible();
  await expect(page.locator('footer a[href="mailto:submissions@itemassist.com"]')).toBeVisible();
});

test("the contact copy does not advertise automatic paid access or checkout", async ({ page }) => {
  await stubSite(page);
  await page.goto("/");
  const section = page.locator("#contact");
  await expect(section).toContainText("Paid access is not available to purchase online");
  await expect(section).toContainText("nothing is charged");
  await expect(section).not.toContainText(/checkout|subscribe|subscription|buy now|pricing plan|per month|per claim|starting at/i);
  await expect(page.locator('a[href*="checkout"], a[href*="billing"], button:has-text("Buy"), button:has-text("Subscribe")')).toHaveCount(0);
});

test("the form stays usable on a narrow screen: no overflow, nothing off-screen, button reachable", async ({ page }, testInfo) => {
  await stubSite(page);
  await openHome(page);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  const box = await page.locator("#consultation-form").boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(-0.5);
  expect(box.x + box.width).toBeLessThanOrEqual(testInfo.project.use.viewport.width + 0.5);
  await submit(page).scrollIntoViewIfNeeded();
  await expect(submit(page)).toBeInViewport();
  // On narrow screens the pinned research composer steps aside while the form is in use, so it never covers a field.
  if (testInfo.project.use.viewport.width <= 960) {
    await page.locator("#consult-name").focus();
    await expect(page.locator("body")).toHaveClass(/rf-contact-active/);
    await expect(page.locator("#rf-composer")).toBeHidden();
  }
});
