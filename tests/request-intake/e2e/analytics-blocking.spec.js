const { test, expect, isAnalyticsRequestUrl } = require("./fixtures.js");

test("automated browser contexts abort Google Analytics and Tag Manager traffic", async ({ context, page }) => {
  const urls = [
    "https://google-analytics.com/collect",
    "https://region1.analytics.google-analytics.com/g/collect",
    "https://googletagmanager.com/gtm.js",
    "https://assets.preview.googletagmanager.com/gtm.js"
  ];
  const attempted = [];
  const failed = [];
  const responded = [];

  context.on("request", (request) => {
    if (isAnalyticsRequestUrl(request.url())) attempted.push(request.url());
  });
  context.on("requestfailed", (request) => {
    if (isAnalyticsRequestUrl(request.url())) failed.push(request.url());
  });
  context.on("response", (response) => {
    if (isAnalyticsRequestUrl(response.url())) responded.push(response.url());
  });

  const results = await page.evaluate(async (analyticsUrls) => Promise.all(
    analyticsUrls.map(async (url) => {
      try {
        await fetch(url, { mode: "no-cors" });
        return { url, succeeded: true };
      } catch {
        return { url, succeeded: false };
      }
    })
  ), urls);

  expect(results).toEqual(urls.map((url) => ({ url, succeeded: false })));
  expect(attempted.sort()).toEqual([...urls].sort());
  expect(failed.sort()).toEqual([...urls].sort());
  expect(responded).toEqual([]);
});
