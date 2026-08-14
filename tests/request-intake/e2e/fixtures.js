const { test: base, expect } = require("@playwright/test");

const ANALYTICS_HOSTS = ["google-analytics.com", "googletagmanager.com"];

function isAnalyticsRequestUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return ANALYTICS_HOSTS.some((analyticsHost) =>
      hostname === analyticsHost || hostname.endsWith(`.${analyticsHost}`)
    );
  } catch {
    return false;
  }
}

async function blockAnalyticsTraffic(context) {
  await context.route("**/*", async (route) => {
    if (isAnalyticsRequestUrl(route.request().url())) {
      await route.abort();
      return;
    }

    await route.continue();
  });
}

const test = base.extend({
  analyticsBlocking: [async ({ context }, use) => {
    await blockAnalyticsTraffic(context);
    await use();
  }, { auto: true }]
});

module.exports = { test, expect, blockAnalyticsTraffic, isAnalyticsRequestUrl };
