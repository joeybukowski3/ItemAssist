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
  validSubmissionBody,
  minimalSubmissionBody
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
  assert.deepEqual(payload.requestedServices, ["age_verification"]);
  assert.equal(payload.itemCount, 1);
  assert.equal(payload.contactEmail, "jane@example.com");
  assert.equal(payload.expectedResponseWindow, "within 1–2 business days");

  const storedKey = `itemassist:request:${payload.requestId}`;
  assert.ok(redis._store.has(storedKey), "record should be persisted under itemassist:request:<id>");

  const record = redis._store.get(storedKey);
  assert.equal(record.schemaVersion, 2);
  assert.equal(record.status, "submitted");
  assert.equal(record.pricingScopeStatus, "pending_review");
  assert.equal(record.items.length, 1);
  assert.equal(record.items[0].noSerial, true);
  assert.equal(record.items[0].serial, "");
  assert.equal(record.items[0].description, "Living room television");

  const index = redis._sortedSets.get("itemassist:requests:index");
  assert.equal(index.length, 1);
  assert.equal(index[0].member, payload.requestId);

  assert.equal(resend.sent.length, 2, "should send both internal and customer emails");
  assert.ok(resend.sent[0].subject.includes(payload.requestId));
  assert.equal(resend.sent[1].to[0], "jane@example.com");

  assert.equal(ratelimit.calls.length, 1);
});

test("a minimal submission with only universal required fields succeeds", async () => {
  const { handler, redis } = buildHandler();
  const req = createFakeReq({ body: minimalSubmissionBody() });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  const payload = res.json();
  const record = redis._store.get(`itemassist:request:${payload.requestId}`);
  assert.equal(record.customerType, "");
  assert.equal(record.company, "");
  assert.equal(record.contact.preferredContactMethod, "");
  assert.equal(record.contact.phone, "");
});

test("a submission with only phone (no email) succeeds and skips the customer confirmation email", async () => {
  const { handler, resend } = buildHandler();
  const req = createFakeReq({ body: minimalSubmissionBody({ email: "", phone: "555-555-5555" }) });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(resend.sent.length, 1, "only the internal notification is sent when there is no customer email");
});

test("missing both email and phone is rejected", async () => {
  const { handler } = buildHandler();
  const req = createFakeReq({ body: minimalSubmissionBody({ email: "", phone: "" }) });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /email address or a phone number/);
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

test("no requested service selected is rejected", async () => {
  const { handler } = buildHandler();
  const req = createFakeReq({ body: validSubmissionBody({ requested_services: [] }) });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /at least one requested service/);
});

test("multiple requested services are persisted", async () => {
  const { handler, redis } = buildHandler();
  const req = createFakeReq({
    body: validSubmissionBody({ requested_services: ["age_verification", "item_pricing_valuation"] })
  });
  const res = createFakeRes();

  await handler(req, res);

  const payload = res.json();
  assert.deepEqual(payload.requestedServices.sort(), ["age_verification", "item_pricing_valuation"].sort());
  const record = redis._store.get(`itemassist:request:${payload.requestId}`);
  assert.deepEqual(record.requestedServices.sort(), ["age_verification", "item_pricing_valuation"].sort());
});

test('"all_of_the_above" is never accepted as a requested service value', async () => {
  const { handler } = buildHandler();
  const req = createFakeReq({ body: validSubmissionBody({ requested_services: ["all_of_the_above"] }) });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /not valid/);
});

test('"unsure" alone is a valid requested-service selection', async () => {
  const { handler } = buildHandler();
  const req = createFakeReq({
    body: validSubmissionBody({ requested_services: ["unsure"], limitations_ack: false })
  });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
});

test("the Age-Verification limitations acknowledgement is required only for Age Verification without Item Pricing / Valuation", async () => {
  const { handler } = buildHandler();

  const avOnly = createFakeReq({ body: validSubmissionBody({ requested_services: ["age_verification"], limitations_ack: false }) });
  const res1 = createFakeRes();
  await handler(avOnly, res1);
  assert.equal(res1.statusCode, 400);
  assert.match(res1.json().error, /service-limitations statement/);

  const avPlusPricing = createFakeReq({
    body: validSubmissionBody({ requested_services: ["age_verification", "item_pricing_valuation"], limitations_ack: false })
  });
  const res2 = createFakeRes();
  await handler(avPlusPricing, res2);
  assert.equal(res2.statusCode, 200);
});

test("item without model, brand, or serial succeeds when a description is present", async () => {
  const { handler, redis } = buildHandler();
  const req = createFakeReq({
    body: validSubmissionBody({
      item_0_description: "Some kitchen appliance",
      item_0_category: "",
      item_0_brand: "",
      item_0_model: "",
      item_0_serial: "",
      item_0_no_serial: false
    })
  });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  const record = redis._store.get(`itemassist:request:${res.json().requestId}`);
  assert.equal(record.items[0].description, "Some kitchen appliance");
  assert.equal(record.items[0].category, "");
});

test("an item without a description is rejected under enter_items_now", async () => {
  const { handler } = buildHandler();
  const req = createFakeReq({ body: validSubmissionBody({ item_0_description: "" }) });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /Item 1:/);
});

test("at least one item is required under enter_items_now", async () => {
  const { handler } = buildHandler();
  const body = validSubmissionBody();
  delete body.item_0_description;
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
      item_1_description: "Kitchen refrigerator",
      item_1_category: "Major Household Appliance",
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
  assert.equal(record.items[1].description, "Kitchen refrigerator");
  assert.equal(record.items[1].serial, "SN-999");
});

function withoutItemZero(body) {
  const next = { ...body };
  ["description", "category", "brand", "model", "serial", "no_serial", "notes"].forEach((suffix) => {
    delete next[`item_0_${suffix}`];
  });
  return next;
}

test("upload_or_paste_list succeeds with only pasted text", async () => {
  const { handler, redis } = buildHandler();
  const body = withoutItemZero(
    validSubmissionBody({
      information_method: "upload_or_paste_list",
      pasted_item_list: "TV, refrigerator, microwave"
    })
  );
  const req = createFakeReq({ body });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  const record = redis._store.get(`itemassist:request:${res.json().requestId}`);
  assert.equal(record.itemList.pastedText, "TV, refrigerator, microwave");
  assert.equal(record.items.length, 0);
});

test("upload_or_paste_list succeeds when only will_provide_list_later is selected", async () => {
  const { handler, redis } = buildHandler();
  const body = validSubmissionBody({
    information_method: "upload_or_paste_list",
    will_provide_list_later: true
  });
  delete body.item_0_description;
  const req = createFakeReq({ body });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  const record = redis._store.get(`itemassist:request:${res.json().requestId}`);
  assert.equal(record.itemList.willProvideLater, true);
});

test("upload_or_paste_list with an unknown/blank estimated item count is accepted", async () => {
  const { handler, redis } = buildHandler();
  const body = validSubmissionBody({
    information_method: "upload_or_paste_list",
    pasted_item_list: "a big list",
    estimated_item_count: ""
  });
  delete body.item_0_description;
  const req = createFakeReq({ body });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  const record = redis._store.get(`itemassist:request:${res.json().requestId}`);
  assert.equal(record.itemList.estimatedItemCount, "");
});

test("upload_or_paste_list is rejected when no file, no pasted text, and no will-provide-later flag is present", async () => {
  const { handler } = buildHandler();
  const body = validSubmissionBody({ information_method: "upload_or_paste_list" });
  delete body.item_0_description;
  const req = createFakeReq({ body });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /upload a file, paste your item list/);
});

test("list_needs_collection succeeds with authorization confirmed and email-only third-party contact", async () => {
  const { handler, redis } = buildHandler();
  const body = validSubmissionBody({
    information_method: "list_needs_collection",
    third_party_contact_name: "John Insured",
    third_party_email: "john@example.com",
    third_party_authorization_ack: true
  });
  delete body.item_0_description;
  const req = createFakeReq({ body });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  const record = redis._store.get(`itemassist:request:${res.json().requestId}`);
  assert.equal(record.thirdPartyCollection.contactNameOrOrg, "John Insured");
  assert.equal(record.thirdPartyCollection.authorizationAck, true);
  assert.ok(record.thirdPartyCollection.authorizationAckAt);
  assert.equal(record.authorization.thirdPartyContactAck, true);
});

test("list_needs_collection is rejected without the authorization acknowledgement", async () => {
  const { handler, redis } = buildHandler();
  const body = validSubmissionBody({
    information_method: "list_needs_collection",
    third_party_contact_name: "John Insured",
    third_party_email: "john@example.com",
    third_party_authorization_ack: false
  });
  delete body.item_0_description;
  const req = createFakeReq({ body });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /authorized to provide this contact/);
  assert.equal(redis._store.size, 0);
});

test("list_needs_collection is rejected without any third-party contact method", async () => {
  const { handler } = buildHandler();
  const body = validSubmissionBody({
    information_method: "list_needs_collection",
    third_party_contact_name: "John Insured",
    third_party_email: "",
    third_party_phone: "",
    third_party_authorization_ack: true
  });
  delete body.item_0_description;
  const req = createFakeReq({ body });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /email address or a phone number for the item list collection contact/);
});

test("list_needs_collection is rejected without a contact name or organization", async () => {
  const { handler } = buildHandler();
  const body = validSubmissionBody({
    information_method: "list_needs_collection",
    third_party_contact_name: "",
    third_party_email: "john@example.com",
    third_party_authorization_ack: true
  });
  delete body.item_0_description;
  const req = createFakeReq({ body });
  const res = createFakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /contact person or organization/);
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

test("the customer confirmation email never states the assignment was accepted, priced, or started", async () => {
  const { handler, resend } = buildHandler();
  const req = createFakeReq({ body: validSubmissionBody() });
  const res = createFakeRes();

  await handler(req, res);

  const customerEmail = resend.sent.find((email) => email.to[0] === "jane@example.com");
  const bannedPhrases = /\baccepted\b|\bpriced\b|\bstarted\b|\bapproved\b/i;
  assert.ok(!bannedPhrases.test(customerEmail.text));
  assert.ok(!bannedPhrases.test(customerEmail.html));
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

test("no binary file data is ever passed to Redis persistence", async () => {
  const { handler, redis } = buildHandler();
  const req = createFakeReq({ body: validSubmissionBody() });
  const res = createFakeRes();

  await handler(req, res);

  const record = redis._store.get(`itemassist:request:${res.json().requestId}`);
  const serialized = JSON.stringify(record);
  // sharedDocuments/uploadedFiles must only ever contain filename/mimeType/size
  // metadata -- never a `buffer` or `content` key holding raw bytes.
  assert.ok(!/"buffer"|"content":\s*"[A-Za-z0-9+/=]{50,}"/.test(serialized));
});

test("schemaVersion 1 records already in Redis remain readable and untouched", async () => {
  const redis = createFakeRedis();
  const legacyRecord = {
    requestId: "IAV-20260101-LEGACY01",
    status: "submitted",
    createdAt: "2026-01-01T00:00:00.000Z",
    selectedService: "age_verification",
    contact: { fullName: "Old Record", email: "old@example.com", phone: "555-000-0000", preferredContactMethod: "email" },
    items: [{ category: "Television", brand: "Sony", model: "", serial: "", noSerial: true, notes: "" }]
  };
  await redis.set("itemassist:request:IAV-20260101-LEGACY01", legacyRecord);

  const { getRequestRecord } = require("../../../api/lib/age-verification/store.js");
  const fetched = await getRequestRecord("IAV-20260101-LEGACY01", { redis });

  assert.deepEqual(fetched, legacyRecord);
  assert.equal(fetched.schemaVersion, undefined);
});
