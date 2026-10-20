const path = require("path");
const { defineConfig, devices } = require("@playwright/test");

// Same static server and analytics-blocking fixture as the replacement-finder suite, on its own port so the two can run side by side.
const PORT = process.env.RESEARCH_STATIC_SERVER_PORT || 47232;
const STATIC_SERVER = path.resolve(__dirname, "../../request-intake/e2e/static-server.mjs");

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: "**/*.spec.js",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, serviceWorkers: "block", trace: "retain-on-failure" },
  webServer: {
    command: `node "${STATIC_SERVER}"`,
    port: Number(PORT),
    reuseExistingServer: false,
    env: { STATIC_SERVER_PORT: String(PORT) }
  },
  projects: [
    { name: "mobile-390", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
    { name: "tablet-768", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } } },
    { name: "desktop-1024", use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 768 } } },
    { name: "desktop-1280", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } }
  ]
});
