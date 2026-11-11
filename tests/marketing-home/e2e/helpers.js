// Stubs for the homepage's contact form, its research status checks and Turnstile. No request ever leaves the machine:
// Turnstile's script is aborted, /api/consultation-request and /api/contact are answered here, and the research and classic
// status routes report "enabled" without a provider, engine or proxy being involved.
const { test, expect } = require("../../request-intake/e2e/fixtures.js");

async function stubSite(page, { consultation, contact } = {}) {
  const calls = { consultation: [], contact: [], other: [] };

  await page.addInitScript(() => {
    window.turnstile = { render: () => "fake-widget-id", getResponse: () => "fake-turnstile-token", reset: () => { window.__turnstileResets = (window.__turnstileResets || 0) + 1; } };
  });
  await page.route("**/challenges.cloudflare.com/**", (route) => route.abort());
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await page.route("**/api/itemassist-research", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: true, dailyLimit: 5 }) }));
  await page.route("**/api/replacement-finder", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: true }) }));

  await page.route("**/api/consultation-request", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ turnstileSiteKey: "test-site-key" }) });
    }
    calls.consultation.push({ headers: request.headers(), body: request.postDataJSON() });
    const reply = typeof consultation === "function" ? consultation(calls.consultation.length) : consultation;
    const { status, body } = reply || { status: 200, body: { ok: true, message: "Request received.", leadId: "HR-20261110-DEADBEEF" } };
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.route("**/api/contact", async (route) => {
    const request = route.request();
    calls.contact.push({ method: request.method(), headers: request.headers(), body: request.postData() || "" });
    const { status, body } = contact || { status: 200, body: { ok: true, message: "Request sent successfully." } };
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });

  return calls;
}

/** Only name, email and the reason for the inquiry are filled unless more is passed. */
async function fillConsultation(page, values = {}) {
  const v = { name: "Jane Smith", email: "jane@example.com", reason: "human_research", ...values };
  await page.locator("#consult-name").fill(v.name);
  await page.locator("#consult-email").fill(v.email);
  if (v.reason) await page.locator("#consult-reason").selectOption(v.reason);
  if (v.company) await page.locator("#consult-company").fill(v.company);
  if (v.phone) await page.locator("#consult-phone").fill(v.phone);
  if (v.description) await page.locator("#consult-description").fill(v.description);
}

/** The form is below the research workspace; wait until the script has rendered the (stubbed) Turnstile widget. */
async function openHome(page, path = "/") {
  await page.goto(path);
  await expect(page.locator('#consultation-form[data-turnstile-ready="true"]')).toBeAttached();
  await page.locator("#consultation-form").scrollIntoViewIfNeeded();
}

async function horizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

module.exports = { test, expect, stubSite, fillConsultation, openHome, horizontalOverflow };
