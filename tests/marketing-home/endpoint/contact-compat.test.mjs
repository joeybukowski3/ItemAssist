// /api/contact is the detailed assignment endpoint. The homepage no longer posts to it, but the About page still does,
// so the unified-inquiry work must leave its contract alone. These checks stop at the validation gates, so nothing
// reaches Resend, Turnstile or the network.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createFakeReq, createFakeRes } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const ENV = {
  RESEND_API_KEY: "test-resend-key",
  CONTACT_FROM_EMAIL: "noreply@itemassist.com",
  CONTACT_TO_EMAIL: "inbox@itemassist.com",
  TURNSTILE_SECRET_KEY: "test-secret",
  TURNSTILE_SITE_KEY: "test-site-key"
};
const previous = {};
let contact;

before(() => {
  for (const key of Object.keys(ENV)) {
    previous[key] = process.env[key];
    process.env[key] = ENV[key];
  }
  contact = require("../../../api/contact.js");
});

after(() => {
  for (const key of Object.keys(ENV)) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
});

async function call(req) {
  const res = createFakeRes();
  await contact(req, res);
  return res;
}

const jsonPost = (body) => createFakeReq({ body, headers: { "content-type": "application/json" } });

test("GET still returns the public Turnstile site key", async () => {
  const res = await call(createFakeReq({ method: "GET" }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { turnstileSiteKey: "test-site-key" });
});

test("other methods are still 405 with GET, POST allowed", async () => {
  const res = await call(createFakeReq({ method: "DELETE" }));
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "GET, POST");
});

test("the assignment contract still needs name, email and assignment notes", async () => {
  const res = await call(jsonPost({ name: "Alex Adjuster", email: "alex@example.com" }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "Please complete all required fields.");
});

test("an invalid email and a missing spam-protection token are still rejected with the same messages", async () => {
  const badEmail = await call(jsonPost({ name: "Alex", email: "nope", assignment_notes: "Forty items." }));
  assert.equal(badEmail.statusCode, 400);
  assert.equal(badEmail.json().error, "Please enter a valid email address.");

  const noToken = await call(jsonPost({ name: "Alex", email: "alex@example.com", assignment_notes: "Forty items." }));
  assert.equal(noToken.statusCode, 400);
  assert.equal(noToken.json().error, "Please complete the spam protection check.");
});

test("the honeypot still answers success without sending anything", async () => {
  const res = await call(jsonPost({ name: "Bot", email: "bot@example.com", assignment_notes: "x", website: "http://spam.test" }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().message, "Submission received.");
});

test("it does not accept the inquiry form's fields: a request-type body is not an assignment", async () => {
  const res = await call(jsonPost({ name: "Jane", email: "jane@example.com", reason: "research_request", description: "Forty items.", turnstileToken: "t" }));
  assert.equal(res.statusCode, 400, "the unified inquiry belongs to /api/consultation-request, not /api/contact");
  assert.equal(res.json().error, "Please complete all required fields.");
});
