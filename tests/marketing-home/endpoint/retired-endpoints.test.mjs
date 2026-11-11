// AI-only mode retires the public upload and intake routes it does not use (see docs/ai-only-mode.md). A retired route answers 410 to
// everything, never reads the request (so no upload is parsed) and never reaches a mailer, store, limiter, Turnstile or the network.
// The real implementations stay importable (`createHandler` / `legacyHandler`) so the commercial site can be restored.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createFakeRes } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const { RETIRED_MESSAGE } = require("../../../api/_lib/retired-endpoint.js");

// Every credential a live route would use is present, so a retired route that wrongly proceeded would have what it needs.
const ENV = { RESEND_API_KEY: "test-resend-key", CONTACT_FROM_EMAIL: "noreply@itemassist.com", CONTACT_TO_EMAIL: "inbox@itemassist.com", TURNSTILE_SECRET_KEY: "test-secret-xyz", TURNSTILE_SITE_KEY: "test-site-key-xyz", UPSTASH_REDIS_REST_URL: "https://redis.invalid", UPSTASH_REDIS_REST_TOKEN: "t" };
const previous = {};
let realFetch;
let networkCalls;

before(() => {
  for (const key of Object.keys(ENV)) { previous[key] = process.env[key]; process.env[key] = ENV[key]; }
  realFetch = globalThis.fetch;
  networkCalls = [];
  globalThis.fetch = (...args) => { networkCalls.push(String(args[0])); throw new Error("a retired route must not use the network"); };
});
after(() => {
  for (const key of Object.keys(ENV)) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  globalThis.fetch = realFetch;
});

/** A request that fails the test if anything reads its body or stream. */
function untouchableReq(method, headers = {}) {
  const trap = (name) => () => { throw new Error(`the retired route touched req.${name}`); };
  return {
    method,
    headers: { "content-type": "multipart/form-data; boundary=----x", "content-length": "1048576", "x-forwarded-for": "203.0.113.5", ...headers },
    socket: { remoteAddress: "203.0.113.5" },
    get body() { throw new Error("the retired route read req.body"); },
    on: trap("on"), once: trap("once"), pipe: trap("pipe"), read: trap("read"), resume: trap("resume"), [Symbol.asyncIterator]: trap("asyncIterator")
  };
}

const ROUTES = [
  ["/api/age-verification-request", () => require("../../../api/age-verification-request.js")],
  ["/api/contact", () => require("../../../api/contact.js")]
];

for (const [route, load] of ROUTES) {
  for (const method of ["POST", "GET", "PUT", "DELETE", "OPTIONS", "HEAD"]) {
    test(`${route} answers ${method} with 410 Gone, reads nothing and calls nothing`, async () => {
      const res = createFakeRes();
      await load()(untouchableReq(method), res);
      assert.equal(res.statusCode, 410);
      assert.deepEqual(res.json(), { ok: false, error: RETIRED_MESSAGE });
      assert.equal(res.headers["Cache-Control"], "no-store");
      assert.equal(res.headers["X-Robots-Tag"], "noindex, nofollow");
      assert.deepEqual(networkCalls, []);
    });
  }

  test(`${route} does not accept a JSON submission or reveal the Turnstile site key`, async () => {
    const res = createFakeRes();
    await load()({ method: "POST", headers: { "content-type": "application/json" }, body: { name: "Jane", email: "jane@example.com" }, socket: {} }, res);
    assert.equal(res.statusCode, 410);
    assert.equal(JSON.stringify(res.json()).includes("turnstile"), false);
    const get = createFakeRes();
    await load()({ method: "GET", headers: {}, socket: {} }, get);
    assert.equal(get.statusCode, 410);
    assert.equal(JSON.stringify(get.json()).includes(ENV.TURNSTILE_SITE_KEY), false);
  });
}

test("the real implementations are kept for tests and restoration, and are not what the route serves", () => {
  const av = require("../../../api/age-verification-request.js");
  assert.equal(typeof av.createHandler, "function");
  assert.notEqual(av, av.createHandler());
  const contact = require("../../../api/contact.js");
  assert.equal(typeof contact.legacyHandler, "function");
  assert.notEqual(contact, contact.legacyHandler);
});

test("no public page or browser script posts to a retired route", () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const relative = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) { if (!["node_modules", "tests", "docs", "api", ".git", ".vercel", "test-results"].includes(entry.name)) walk(relative); }
      else if (/\.(html|js|css)$/.test(entry.name)) files.push(relative);
    }
  };
  walk(".");
  assert.ok(files.length > 10);
  for (const file of files) assert.doesNotMatch(read(file), /api\/(age-verification-request|contact)\b/, file);
});

test("every API route is either served to a public page or retired; the one webhook verifies its signature", () => {
  const routes = fs.readdirSync(path.join(ROOT, "api")).filter((name) => name.endsWith(".js")).map((name) => name.replace(/\.js$/, "")).sort();
  assert.deepEqual(routes, ["age-verification-request", "consultation-request", "contact", "inbound-email", "itemassist-research", "replacement-finder"]);
  // Used by the shipped homepage code.
  const shipped = read("consultation.js") + read("replacement-finder.js") + fs.readdirSync(path.join(ROOT, "assets/js")).map((name) => read(`assets/js/${name}`)).join("\n");
  for (const used of ["consultation-request", "itemassist-research", "replacement-finder"]) assert.ok(shipped.includes(`/api/${used}`), `${used} is used by the homepage`);
  // Retired.
  for (const retired of ["age-verification-request", "contact"]) assert.match(read(`api/${retired}.js`), /module\.exports = createRetiredHandler\(\);/);
  // The inbound-email route is a Resend webhook, not a public form: it refuses unsigned requests.
  const inbound = read("api/inbound-email.js");
  assert.match(inbound, /svix-signature/);
  assert.match(inbound, /Missing webhook signature headers/);
});
