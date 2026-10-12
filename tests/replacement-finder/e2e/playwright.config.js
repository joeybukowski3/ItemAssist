const path = require("path");
const { defineConfig, devices } = require("@playwright/test");

// Reuses the repository's static server and (in helpers.js) its analytics-blocking fixture from the request-intake suite.
const PORT = process.env.RF_STATIC_SERVER_PORT || 47231;
const STATIC_SERVER = path.resolve(__dirname, "../../request-intake/e2e/static-server.mjs");

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: "**/*.spec.js",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    serviceWorkers: "block",
    trace: "retain-on-failure"
  },
  webServer: {
    command: `node "${STATIC_SERVER}"`,
    port: Number(PORT),
    reuseExistingServer: !process.env.CI,
    env: { STATIC_SERVER_PORT: String(PORT) }
  },
  projects: [
    { name: "mobile-375", use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 } } },
    { name: "tablet-768", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } } },
    { name: "desktop-1280", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } }
  ]
});
