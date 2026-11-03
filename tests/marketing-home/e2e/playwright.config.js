const { defineConfig, devices } = require("@playwright/test");

const PORT = process.env.MARKETING_STATIC_PORT || 4193;

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: "**/*.spec.js",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    serviceWorkers: "block",
    trace: "retain-on-failure"
  },
  webServer: {
    command: `node "${__dirname}/../../request-intake/e2e/static-server.mjs"`,
    port: Number(PORT),
    reuseExistingServer: false,
    env: { STATIC_SERVER_PORT: String(PORT) }
  },
  projects: [
    { name: "desktop-1440", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "tablet-1024", use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 900 } } },
    { name: "tablet-768", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } } },
    { name: "mobile-390", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
    { name: "mobile-375", use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 } } }
  ]
});
