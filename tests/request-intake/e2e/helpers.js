async function stubTurnstileAndApi(page, { submitResponse } = {}) {
  await page.addInitScript(() => {
    window.turnstile = {
      render: () => "fake-widget-id",
      getResponse: () => "fake-turnstile-token",
      reset: () => {}
    };
  });

  await page.route("**/challenges.cloudflare.com/**", (route) => route.abort());

  await page.route("**/api/age-verification-request", async (route) => {
    const request = route.request();

    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ turnstileSiteKey: "test-site-key" })
      });
      return;
    }

    const response = submitResponse || {
      status: 200,
      body: {
        ok: true,
        requestId: "IAV-20260729-DEADBEEF",
        requestedServices: ["age_verification"],
        itemCount: 1,
        contactEmail: "jane@example.com",
        expectedResponseWindow: "within 1–2 business days"
      }
    };

    await route.fulfill({
      status: response.status,
      contentType: "application/json",
      body: JSON.stringify(response.body)
    });
  });
}

module.exports = { stubTurnstileAndApi };
