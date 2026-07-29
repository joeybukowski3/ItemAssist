import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  createFakeRedis,
  createFailingRedis,
  createFakeResend,
  createFakeRatelimit,
  createFakeTurnstileVerify,
  createFakeReq,
  createFakeRes,
  validSubmissionBody
} from "./helpers.mjs";

const require = createRequire(import.meta.url);
const { createHandler } = require("../../../api/age-verification-request.js");

const REQUIRED_ENV = {
  RESEND_API_KEY: "test-resend-key",
  CONTACT_FROM_EMAIL: "noreply@itemassist.com",
  CONTACT_TO_EMAIL: "fallback@itemassist.com",
  PROFESSIONAL_REQUEST_TO_EMAIL: "professional@itemassist.com",
  TURNSTILE_SECRET_KEY: "test-secret",
  TURNSTILE_SITE_KEY: "test-site-key"
};

const previousEnv = {};

beforeEach(() => {
  Object.keys(REQUIRED_ENV).forEach((key) => {
    previousEnv[key] = process.env[key];
    process.env[key] = REQUIRED_ENV[key];
  });
});

afterEach(() => {
  Object.keys(REQUIRED_ENV).forEach((key) => {
    if (previousEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previousEnv[key];
    }
  });
});

function buildHandler(overrides = {}) {
  const redis = overrides.redis || createFakeRedis();
  const resend = overrides.resend || createFakeResend();
  const ratelimit = overrides.ratelimit || createFakeRatelimit();
  const verifyTurnstile = overrides.verifyTurnstile || createFakeTurnstileVerify();

  const handler = createHandler({
    redis,
    resend,
    ratelimit,
    verifyTurnstile,
    now: overrides.now || (() => new Date("2026-07-29T12:00:00Z")),
    generateRequestId: overrides.generateRequestId,
    logError: () => {}
  });

  return { handler, redis, resend, ratelimit, verifyTurnstile };
}

test("GET returns the Turnstile site key when configured", async () => {
  const { handler } = buildHandler();
  const req = createFakeReq({ method: "GET" });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { turnstileSiteKey: "test-site-key" });
});

test("GET returns 500 when Turnstile site key is missing", async () => {
  delete process.env.TURNSTILE_SITE_KEY;
  const { handler } = buildHandler();
  const req = createFakeReq({ method: "GET" });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 500);
});

test("unsupported HTTP methods are rejected with 405", async () => {
  const { handler } = buildHandler();
  const req = createFakeReq({ method: "DELETE" });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 405);
});

test("a fully valid submission is persisted, emailed, and returns a confirmation payload", async () => {
  const { handler, redis, resend, ratelimit } = buildHandler();
  const req = createFakeReq({ body: validSubmissionBody() });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  const payload = res.json();
  assert.equal(payload.ok, true);
  assert.match(payload.requestId, /^IAV-\d{8}-[0-9A-F]{8}$/);
  assert.equal(payload.selectedService, "age_verification");
  assert.equal(payload.itemCount, 1);
  assert.equal(payload.contactEmail, "jane@example.com");
  assert.equal(payload.expectedResponseWindow, "within 1–2 business days");

  const storedKey = `itemassist:request:${payload.requestId}`;
  assert.ok(redis._store.has(storedKey), "record should be persisted under itemassist:request:<id>");

  const record = redis._store.get(storedKey);
  assert.equal(record.status, "submitted");
  assert.equal(record.items.length, 1);
  assert.equal(record.items[0].noSerial, true);
  assert.equal(record.items[0].serial, "");

  const index = redis._sortedSets.get("itemassist:requests:index");
  assert.equal(index.length, 1);
  assert.equal(index[0].member, payload.requestId);

  assert.equal(resend.sent.length, 2, "should send both internal and customer emails");
  assert.ok(resend.sent[0].subject.includes(payload.requestId));
  assert.equal(resend.sent[1].to[0], "jane@example.com");

  assert.equal(ratelimit.calls.length, 1);
});

test("required contact field errors return 400 and take no side effects", async () => {
  const { handler, redis, resend } = buildHandler();
  const req = createFakeReq({ body: validSubmissionBody({ full_name: "" }) });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(redis._store.size, 0);
  assert.equal(resend.sent.length, 0);
});

test("professional customer type without a company is rejected", async () => {
  const { handler } = buildHandler();
  const req = createFakeReq({
    body: validSubmissionBody({ customer_type: "insurance_adjuster", company: "" })
  });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /Company or organization/);
});

test("missing serial without the no-serial checkbox is rejected", async () => {
  const { handler } = buildHandler();
  const req = createFakeReq({
    body: validSubmissionBody({ item_0_no_serial: false, item_0_serial: "" })
  });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /Item 1:/);
});

test("at least one item is required", async () => {
  const { handler } = buildHandler();
  const body = validSubmissionBody();
  delete body.item_0_category;
  delete body.item_0_brand;
  delete body.item_0_model;
  delete body.item_0_serial;
  delete body.item_0_no_serial;
  delete body.item_0_notes;

  const req = createFakeReq({ body });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /At least one item/);
});

test("multiple items are parsed correctly from flat item_N_* fields", async () => {
  const { handler, redis } = buildHandler();
  const req = createFakeReq({
    body: validSubmissionBody({
      item_1_category: "Refrigerator",
      item_1_brand: "GE",
      item_1_model: "GFE28",
      item_1_serial: "SN-999",
      item_1_no_serial: false
    })
  });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  const payload = res.json();
  assert.equal(payload.itemCount, 2);

  const record = redis._store.get(`itemassist:request:${payload.requestId}`);
  assert.equal(record.items[1].category, "Refrigerator");
  assert.equal(record.items[1].serial, "SN-999");
});

test("the honeypot field silently short-circuits without persistence or email", async () => {
  const { handler, redis, resend, ratelimit } = buildHandler();
  const req = createFakeReq({ body: validSubmissionBody({ website: "http://spam.example" }) });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().ok, true);
  assert.equal(redis._store.size, 0);
  assert.equal(resend.sent.length, 0);
  assert.equal(ratelimit.calls.length, 0, "rate limit check happens after the honeypot short-circuit");
});

test("a missing Turnstile token is rejected before verification is attempted", async () => {
  const { handler, verifyTurnstile } = buildHandler();
  const req = createFakeReq({ body: validSubmissionBody({ turnstileToken: "" }) });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(verifyTurnstile.calls.length, 0);
});

test("a failed Turnstile verification is rejected and nothing is persisted", async () => {
  const { handler, redis } = buildHandler({ verifyTurnstile: createFakeTurnstileVerify({ succeed: false }) });
  const req = createFakeReq({ body: validSubmissionBody() });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /Spam protection/);
  assert.equal(redis._store.size, 0);
});

test("Turnstile is verified server-side even though the client already claims success", async () => {
  const { handler, verifyTurnstile } = buildHandler();
  const req = createFakeReq({ body: validSubmissionBody({ turnstileToken: "valid-token" }) });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(verifyTurnstile.calls.length, 1);
  assert.equal(verifyTurnstile.calls[0].token, "valid-token");
});

test("rate limiting rejects a request over the configured window", async () => {
  const { handler, redis, resend } = buildHandler({ ratelimit: createFakeRatelimit({ allow: false }) });
  const req = createFakeReq({ body: validSubmissionBody() });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 429);
  assert.equal(redis._store.size, 0);
  assert.equal(resend.sent.length, 0);
});

test("a Redis persistence failure returns a retryable error and never sends the customer confirmation", async () => {
  const { handler, resend } = buildHandler({ redis: createFailingRedis("set") });
  const req = createFakeReq({ body: validSubmissionBody() });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.json().retryable, true);
  assert.equal(resend.sent.length, 0, "no email should be sent if persistence failed");
});

test("an internal-notification email failure still reports the requestId (record already persisted)", async () => {
  const { handler, redis } = buildHandler({ resend: createFakeResend({ failOn: "internal" }) });
  const req = createFakeReq({ body: validSubmissionBody() });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 502);
  const payload = res.json();
  assert.equal(payload.ok, false);
  assert.ok(payload.requestId);
  assert.ok(redis._store.has(`itemassist:request:${payload.requestId}`), "record must remain persisted even if the internal email fails");
});

test("a customer-confirmation email failure is non-fatal since persistence and internal notification already succeeded", async () => {
  const { handler } = buildHandler({ resend: createFakeResend({ failOn: "customer" }) });
  const req = createFakeReq({ body: validSubmissionBody() });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().ok, true);
});

test("DecodeMyItem attribution and unsupported extra fields are handled safely", async () => {
  const { handler, redis } = buildHandler();
  const req = createFakeReq({
    body: validSubmissionBody({
      source: "decodemyitem",
      result_id: "RES-123",
      result_status: "ambiguous",
      brand: "Sony",
      model: "XBR-65",
      category: "Television",
      some_untrusted_admin_field: "should_be_ignored"
    })
  });
  const res = createFakeRes();

  await handler(req, res);

  const payload = res.json();
  const record = redis._store.get(`itemassist:request:${payload.requestId}`);

  assert.equal(record.attribution.source, "decodemyitem");
  assert.equal(record.attribution.resultId, "RES-123");
  assert.equal(record.attribution.resultStatus, "ambiguous");
  assert.equal(record.someUntrustedAdminField, undefined);
});

test("an invalid result_status enum value is dropped rather than stored", async () => {
  const { handler, redis } = buildHandler();
  const req = createFakeReq({
    body: validSubmissionBody({ source: "decodemyitem", result_status: "not_a_real_status" })
  });
  const res = createFakeRes();

  await handler(req, res);

  const payload = res.json();
  const record = redis._store.get(`itemassist:request:${payload.requestId}`);
  assert.equal(record.attribution.resultStatus, "");
});

test("request IDs are unique across back-to-back submissions", async () => {
  const { handler, redis } = buildHandler();
  const ids = [];

  for (let i = 0; i < 5; i++) {
    const req = createFakeReq({ body: validSubmissionBody() });
    const res = createFakeRes();
    await handler(req, res);
    ids.push(res.json().requestId);
  }

  assert.equal(new Set(ids).size, 5);
  assert.equal(redis._store.size, 5);
});

test("the endpoint returns 500 when required server configuration (e.g. Resend/email envs) is missing", async () => {
  delete process.env.CONTACT_FROM_EMAIL;
  const { handler } = buildHandler();
  const req = createFakeReq({ body: validSubmissionBody() });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 500);
});

test("PROFESSIONAL_REQUEST_TO_EMAIL is used when present, falling back to CONTACT_TO_EMAIL otherwise", async () => {
  delete process.env.PROFESSIONAL_REQUEST_TO_EMAIL;
  const { handler, resend } = buildHandler();
  const req = createFakeReq({ body: validSubmissionBody() });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(resend.sent[0].to[0], "fallback@itemassist.com");
});
