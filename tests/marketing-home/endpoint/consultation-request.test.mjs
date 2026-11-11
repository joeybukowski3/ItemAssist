import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  createFakeResend,
  createFakeGuardRedis,
  createFakeRatelimit,
  createFakeTurnstileVerify,
  createFakeReq,
  createFakeRes,
  validConsultationBody,
  minimalConsultationBody
} from "./helpers.mjs";

const require = createRequire(import.meta.url);
const { createHandler } = require("../../../api/consultation-request.js");

const REQUIRED_ENV = {
  RESEND_API_KEY: "test-resend-key",
  CONTACT_FROM_EMAIL: "noreply@itemassist.com",
  CONTACT_TO_EMAIL: "inbox@itemassist.com",
  TURNSTILE_SECRET_KEY: "test-secret",
  TURNSTILE_SITE_KEY: "test-site-key"
};
const previousEnv = {};

beforeEach(() => {
  for (const key of Object.keys(REQUIRED_ENV)) {
    previousEnv[key] = process.env[key];
    process.env[key] = REQUIRED_ENV[key];
  }
});

afterEach(() => {
  for (const key of Object.keys(REQUIRED_ENV)) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
});

function build(overrides = {}) {
  const resend = overrides.resend || createFakeResend();
  const redis = overrides.redis || createFakeGuardRedis();
  const ratelimit = overrides.ratelimit || createFakeRatelimit();
  const verifyTurnstile = overrides.verifyTurnstile || createFakeTurnstileVerify();
  const events = [];
  const errors = [];
  const handler = createHandler({
    resend,
    redis,
    ratelimit,
    verifyTurnstile,
    now: () => new Date("2026-11-03T15:00:00Z"),
    logEvent: (event) => events.push(event),
    logError: (...args) => errors.push(args.join(" "))
  });
  return { handler, resend, redis, ratelimit, verifyTurnstile, events, errors };
}

async function post(handler, body, headers) {
  const res = createFakeRes();
  await handler(createFakeReq({ body, headers }), res);
  return res;
}

test("GET returns the public Turnstile site key and nothing else", async () => {
  const { handler } = build();
  const res = createFakeRes();
  await handler(createFakeReq({ method: "GET" }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { turnstileSiteKey: "test-site-key" });
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.ok(!res.body.includes("test-secret") && !res.body.includes("test-resend-key"));
});

test("GET reports 500 when the site key is missing", async () => {
  delete process.env.TURNSTILE_SITE_KEY;
  const res = createFakeRes();
  await build().handler(createFakeReq({ method: "GET" }), res);
  assert.equal(res.statusCode, 500);
});

test("other methods are 405 with an Allow header", async () => {
  const res = createFakeRes();
  await build().handler(createFakeReq({ method: "PUT" }), res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "GET, POST");
});

test("a valid inquiry sends exactly one internal notification and nothing to the visitor", async () => {
  const { handler, resend, events } = build();
  const res = await post(handler, validConsultationBody());
  assert.equal(res.statusCode, 200);
  const payload = res.json();
  assert.equal(payload.ok, true);
  assert.match(payload.leadId, /^CI-20261103-[0-9A-F]{8}$/);

  assert.equal(resend.sent.length, 1);
  const [mail] = resend.sent;
  assert.deepEqual(mail.to, ["inbox@itemassist.com"]);
  assert.equal(mail.from, "noreply@itemassist.com");
  assert.equal(mail.replyTo, "jane@example.com");
  assert.equal(events.at(-1).outcome, "submitted");
});

test("a free-consultation request is labelled as one, distinct from an assignment submission", async () => {
  const { handler, resend } = build();
  await post(handler, validConsultationBody({ reason: "consultation" }));
  const [mail] = resend.sent;
  assert.match(mail.subject, /^New Consultation Request CI-20261103-[0-9A-F]{8} — ItemAssist$/);
  assert.ok(!/Contents List Submission|Work Order/.test(mail.subject));
  assert.deepEqual(mail.tags, [{ name: "lead_type", value: "consultation_inquiry" }]);
  assert.match(mail.text, /FREE CONSULTATION REQUEST \(marketing lead\) - not an assignment submission\./);
  assert.match(mail.html, /Free consultation request &middot; marketing lead/);
  assert.match(mail.text, /Request type: Free consultation/);
  assert.match(mail.text, /Suggested next step: Follow up to discuss scope, turnaround, and pricing\./);
  assert.match(mail.text, /Approximate item count: 11–50 items/);
  assert.match(mail.text, /Marketing source: source: linkedin, medium: social, campaign: launch-nov/);
});

test("a research request is labelled as ready-to-submit work, with its own subject, id prefix, tag and next step", async () => {
  const { handler, resend, events } = build();
  const res = await post(handler, validConsultationBody({ reason: "research_request" }));
  assert.match(res.json().leadId, /^RR-20261103-[0-9A-F]{8}$/);
  const [mail] = resend.sent;
  assert.match(mail.subject, /^New Research Request RR-20261103-[0-9A-F]{8} — ItemAssist$/);
  assert.deepEqual(mail.tags, [{ name: "lead_type", value: "research_request" }]);
  assert.match(mail.text, /^RESEARCH REQUEST \/ ASSIGNMENT INQUIRY - the sender says they are ready to submit work\./);
  assert.match(mail.html, /Research request &middot; ready to submit work/);
  assert.match(mail.text, /Request type: Research request \/ assignment/);
  assert.match(mail.text, /Suggested next step: Reply to confirm scope, turnaround, and price, and to arrange how the item list or files will be sent\./);
  assert.match(mail.text, /no scope, price, or files have been agreed or received/);
  assert.ok(!/FREE CONSULTATION REQUEST/.test(mail.text));
  assert.equal(events.at(-1).leadType, "research_request");
});

test("an exploring-options inquiry is distinct from both and offers a consultation as the next step", async () => {
  const { handler, resend, events } = build();
  const res = await post(handler, validConsultationBody({ reason: "exploring" }));
  assert.match(res.json().leadId, /^EI-20261103-[0-9A-F]{8}$/);
  const [mail] = resend.sent;
  assert.match(mail.subject, /^New Inquiry \(Exploring Options\) EI-20261103-[0-9A-F]{8} — ItemAssist$/);
  assert.deepEqual(mail.tags, [{ name: "lead_type", value: "exploring_inquiry" }]);
  assert.match(mail.text, /Request type: Exploring options/);
  assert.match(mail.text, /offer a free consultation/);
  assert.equal(events.at(-1).leadType, "exploring_inquiry");
});

test("the three request types never share a subject label, tag or banner", async () => {
  const seen = new Set();
  for (const reason of ["consultation", "research_request", "exploring"]) {
    const { handler, resend } = build();
    await post(handler, validConsultationBody({ reason }));
    const [mail] = resend.sent;
    seen.add(mail.subject.split(" ").slice(0, 3).join(" "));
    seen.add(mail.tags[0].value);
    seen.add(mail.text.split("\n")[0]);
  }
  assert.equal(seen.size, 9);
});

const RESEARCH_SITE_TYPES = [
  { reason: "human_research", prefix: "HR", subject: /^New Human-Reviewed Research Request HR-20261103-[0-9A-F]{8} — ItemAssist$/, tag: "human_research_request", banner: /^HUMAN-REVIEWED RESEARCH REQUEST - /, type: "Human-reviewed research request" },
  { reason: "paid_access", prefix: "PA", subject: /^New Additional \/ Paid Access Inquiry PA-20261103-[0-9A-F]{8} — ItemAssist$/, tag: "paid_access_inquiry", banner: /^ADDITIONAL \/ PAID ACCESS INQUIRY - /, type: "Additional or paid access inquiry" },
  { reason: "general_question", prefix: "GQ", subject: /^New General Question GQ-20261103-[0-9A-F]{8} — ItemAssist$/, tag: "general_question", banner: /^GENERAL QUESTION - /, type: "General question" }
];

for (const expected of RESEARCH_SITE_TYPES) {
  test(`a ${expected.reason} inquiry is identified in the subject, banner, tag, request-type row and log, with a source and a Reply-To`, async () => {
    const { handler, resend, events } = build();
    const res = await post(handler, validConsultationBody({ reason: expected.reason }));
    assert.equal(res.statusCode, 200);
    assert.match(res.json().leadId, new RegExp(`^${expected.prefix}-20261103-[0-9A-F]{8}$`));
    const [mail] = resend.sent;
    assert.match(mail.subject, expected.subject);
    assert.deepEqual(mail.tags, [{ name: "lead_type", value: expected.tag }]);
    assert.match(mail.text, expected.banner);
    assert.match(mail.text, new RegExp(`Request type: ${expected.type}`));
    assert.match(mail.html, /Reply to this email to respond to the sender/);
    assert.equal(mail.replyTo, "jane@example.com");
    assert.match(mail.text, /Marketing source: source: linkedin, medium: social, campaign: launch-nov/);
    assert.equal(events.at(-1).leadType, expected.tag);
    assert.equal(events.at(-1).source, "linkedin");
  });
}

test("the six request types never share a subject label, tag or banner", async () => {
  const seen = new Set();
  for (const reason of ["consultation", "research_request", "exploring", "human_research", "paid_access", "general_question"]) {
    const { handler, resend } = build();
    await post(handler, validConsultationBody({ reason }));
    const [mail] = resend.sent;
    seen.add(mail.subject.replace(/ [A-Z]{2}-\d{8}-[0-9A-F]{8} — ItemAssist$/, ""));
    seen.add(mail.tags[0].value);
    seen.add(mail.text.split("\n")[0]);
  }
  assert.equal(seen.size, 18);
});

test("the paid-access notification says paid access is not self-serve and nothing was quoted", async () => {
  const { handler, resend } = build();
  await post(handler, validConsultationBody({ reason: "paid_access" }));
  const [mail] = resend.sent;
  assert.match(mail.text, /not available for self-serve purchase, and nothing has been quoted or agreed/);
});

test("on the research site only name, email and the reason for the inquiry are required: no description, company, phone or item count", async () => {
  for (const reason of ["human_research", "paid_access", "general_question"]) {
    const { handler, resend } = build();
    const res = await post(handler, { name: "Jane Smith", email: "jane@example.com", reason, submission_id: "sub_" + reason.padEnd(20, "x"), website: "", turnstileToken: "valid-token" });
    assert.equal(res.statusCode, 200, reason);
    const [mail] = resend.sent;
    assert.ok(!/Short description:|Company:|Phone:|Approximate item count:/.test(mail.text), "blank optional fields are left out of the email");
  }
});

test("the log line carries the lead type and the source but no name, email, phone or description", async () => {
  const { handler, events } = build();
  await post(handler, validConsultationBody());
  const event = events.at(-1);
  assert.deepEqual(event, {
    outcome: "submitted",
    leadId: event.leadId,
    leadType: "consultation_inquiry",
    reason: "consultation",
    hasCompany: true,
    hasPhone: true,
    source: "linkedin",
    medium: "social",
    campaign: "launch-nov"
  });
  const serialized = JSON.stringify(events);
  for (const secret of ["Jane", "jane@example.com", "555", "living-room", "Smith Adjusting"]) {
    assert.ok(!serialized.includes(secret), `log leaked ${secret}`);
  }
});

test("the default log wrapper tags lines with the lead type, and early rejections with a generic one", async () => {
  const lines = [];
  const original = console.info;
  console.info = (line) => lines.push(line);
  try {
    const handler = createHandler({ resend: createFakeResend(), redis: createFakeGuardRedis(), ratelimit: createFakeRatelimit(), verifyTurnstile: createFakeTurnstileVerify() });
    await post(handler, validConsultationBody());
  } finally {
    console.info = original;
  }
  const parsed = JSON.parse(lines.at(-1));
  assert.equal(parsed.event, "itemassist_lead");
  assert.equal(parsed.leadType, "consultation_inquiry");
  assert.equal(parsed.outcome, "submitted");

  const early = [];
  console.info = (line) => early.push(line);
  try {
    const handler = createHandler({ resend: createFakeResend(), redis: createFakeGuardRedis(), ratelimit: createFakeRatelimit({ allow: false }), verifyTurnstile: createFakeTurnstileVerify() });
    await post(handler, validConsultationBody());
  } finally {
    console.info = original;
  }
  assert.equal(JSON.parse(early.at(-1)).leadType, "website_inquiry");
  assert.equal(JSON.parse(early.at(-1)).outcome, "rate_limited");
});

test("only name, email, a request type and a short description are required", async () => {
  const { handler, resend } = build();
  const res = await post(handler, minimalConsultationBody());
  assert.equal(res.statusCode, 200);
  assert.equal(resend.sent.length, 1);
  assert.ok(!/Company:|Phone:|item count:/.test(resend.sent[0].text));
  assert.match(resend.sent[0].text, /Short description: Just looking at options\./);
  assert.match(resend.sent[0].text, /Marketing source: Not provided/);
});

test("claim information, files and payment details are not collected: unknown fields never reach the email", async () => {
  const { handler, resend } = build();
  await post(handler, validConsultationBody({ claim_number: "CLM-123456", policy_number: "POL-9", card_number: "4111111111111111", attachments: "x.pdf" }));
  const mail = resend.sent[0];
  for (const text of [mail.text, mail.html]) {
    assert.ok(!/CLM-123456|POL-9|4111111111111111|x\.pdf/.test(text));
  }
});

test("missing required fields are rejected with one message per field and no email", async () => {
  const { handler, resend } = build();
  const res = await post(handler, { turnstileToken: "valid-token" });
  assert.equal(res.statusCode, 400);
  const body = res.json();
  assert.equal(body.ok, false);
  assert.deepEqual(Object.keys(body.errors).sort(), ["description", "email", "name", "reason"]);
  assert.equal(body.error, body.errors.name);
  assert.equal(resend.sent.length, 0);
});

test("invalid email, request type, phone and item count are each rejected", async () => {
  const { handler, resend } = build();
  const res = await post(handler, validConsultationBody({ email: "jane@", reason: "free-money", phone: "12", item_count: "a lot" }));
  assert.equal(res.statusCode, 400);
  assert.deepEqual(Object.keys(res.json().errors).sort(), ["email", "item_count", "phone", "reason"]);
  assert.equal(resend.sent.length, 0);
});

test("a blank or whitespace-only description is rejected, and the retired reason values are no longer accepted", async () => {
  const { handler, resend } = build();
  const blank = await post(handler, validConsultationBody({ description: "   \n " }));
  assert.equal(blank.statusCode, 400);
  assert.deepEqual(Object.keys(blank.json().errors), ["description"]);
  for (const reason of ["contents_research", "individual_item", "ongoing_support", "question", "other"]) {
    const res = await post(handler, validConsultationBody({ reason, submission_id: "sub_" + "z".repeat(20) }));
    assert.equal(res.statusCode, 400, reason);
  }
  assert.equal(resend.sent.length, 0);
});

test("over-long values are rejected, not truncated silently", async () => {
  const { handler, resend } = build();
  const res = await post(handler, validConsultationBody({ name: "N".repeat(101), description: "d".repeat(1001), company: "C".repeat(121) }));
  assert.equal(res.statusCode, 400);
  assert.deepEqual(Object.keys(res.json().errors).sort(), ["company", "description", "name"]);
  assert.equal(resend.sent.length, 0);
});

test("email header injection through any field cannot reach the subject, reply-to or recipients", async () => {
  const { handler, resend } = build();
  const evil = "Jane\r\nBcc: attacker@evil.test";
  const res = await post(handler, validConsultationBody({ name: evil, company: evil, email: "jane@example.com\r\nBcc: attacker@evil.test" }));
  assert.equal(res.statusCode, 400, "a line break inside the email address is not a valid address");

  const second = await post(handler, validConsultationBody({ name: evil, company: evil, submission_id: "sub_aaaaaaaaaaaaaaaaaaaa" }));
  assert.equal(second.statusCode, 200);
  const mail = resend.sent[0];
  assert.ok(!/[\r\n]/.test(mail.subject) && !mail.subject.includes("Bcc"));
  assert.ok(!/[\r\n]/.test(mail.replyTo));
  assert.deepEqual(mail.to, ["inbox@itemassist.com"]);
  assert.ok(!mail.text.includes("\r"));
});

test("visitor-supplied markup is escaped in the HTML body", async () => {
  const { handler, resend } = build();
  await post(handler, validConsultationBody({ name: "<script>alert(1)</script>", description: "<img src=x onerror=alert(1)> & more" }));
  const { html } = resend.sent[0];
  assert.ok(!html.includes("<script>") && !html.includes("<img"));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; &amp; more/);
});

test("marketing-source tags are kept only when they look like short campaign tags", async () => {
  const { handler, resend } = build();
  await post(handler, validConsultationBody({ utm_source: "https://evil.test/?a=b", utm_medium: "x@y.com", utm_campaign: "spring-sale" }));
  const text = resend.sent[0].text;
  assert.ok(!text.includes("evil.test") && !text.includes("x@y.com"));
  assert.match(text, /campaign: spring-sale/);
});

test("the honeypot answers success but sends nothing and does not touch the guards", async () => {
  const { handler, resend, verifyTurnstile, redis, events } = build();
  const res = await post(handler, validConsultationBody({ website: "http://spam.test" }));
  assert.equal(res.statusCode, 200);
  assert.equal(resend.sent.length, 0);
  assert.equal(verifyTurnstile.calls.length, 0);
  assert.equal(redis.store.size, 0);
  assert.equal(events.at(-1).outcome, "honeypot");
});

test("a missing spam-protection token is rejected before verification", async () => {
  const { handler, resend, verifyTurnstile } = build();
  const res = await post(handler, validConsultationBody({ turnstileToken: "" }));
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /spam protection/i);
  assert.equal(verifyTurnstile.calls.length, 0);
  assert.equal(resend.sent.length, 0);
});

test("a token that fails server-side verification is rejected", async () => {
  const { handler, resend, events } = build();
  const res = await post(handler, validConsultationBody({ turnstileToken: "forged" }));
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /verification failed/i);
  assert.equal(resend.sent.length, 0);
  assert.equal(events.at(-1).outcome, "turnstile_failed");
});

test("a Turnstile outage is reported as a retryable server error and sends nothing", async () => {
  const { handler, resend } = build({ verifyTurnstile: async () => { throw new Error("boom"); } });
  const res = await post(handler, validConsultationBody());
  assert.equal(res.statusCode, 500);
  assert.equal(resend.sent.length, 0);
});

test("the rate limit stops a flood with 429 before any verification or email", async () => {
  const ratelimit = createFakeRatelimit({ allow: false });
  const { handler, resend, verifyTurnstile } = build({ ratelimit });
  const res = await post(handler, validConsultationBody());
  assert.equal(res.statusCode, 429);
  assert.deepEqual(ratelimit.calls, ["203.0.113.5"]);
  assert.equal(verifyTurnstile.calls.length, 0);
  assert.equal(resend.sent.length, 0);
});

test("the rate limiter keys on the first forwarded address", async () => {
  const ratelimit = createFakeRatelimit();
  const { handler } = build({ ratelimit });
  await post(handler, validConsultationBody(), { "x-forwarded-for": "198.51.100.7, 10.0.0.1" });
  assert.deepEqual(ratelimit.calls, ["198.51.100.7"]);
});

test("an unavailable rate-limit store does not turn a real lead away", async () => {
  const ratelimit = { async limit() { throw new Error("redis down"); } };
  const { handler, resend, errors } = build({ ratelimit });
  const res = await post(handler, validConsultationBody());
  assert.equal(res.statusCode, 200);
  assert.equal(resend.sent.length, 1);
  assert.match(errors.join("\n"), /rate limit check failed/);
});

test("a repeated submission id sends one notification, however many times it arrives", async () => {
  const { handler, resend, events } = build();
  const body = validConsultationBody();
  const results = await Promise.all([post(handler, body), post(handler, body), post(handler, body)]);
  assert.ok(results.every((res) => res.statusCode === 200 && res.json().ok === true));
  assert.equal(resend.sent.length, 1, "double-click or retry must not raise a second notification");
  assert.equal(results.filter((res) => res.json().duplicate === true).length, 2);
  assert.equal(events.filter((event) => event.outcome === "duplicate").length, 2);
});

test("different submission ids are different inquiries", async () => {
  const { handler, resend } = build();
  await post(handler, validConsultationBody({ submission_id: "sub_aaaaaaaaaaaaaaaaaaaa" }));
  await post(handler, validConsultationBody({ submission_id: "sub_bbbbbbbbbbbbbbbbbbbb" }));
  assert.equal(resend.sent.length, 2);
});

test("the duplicate guard stores a hash of the id, not the visitor's details", async () => {
  const { handler, redis } = build();
  await post(handler, validConsultationBody());
  const [key] = [...redis.store.keys()];
  assert.match(key, /^itemassist:consultation:submission:[0-9a-f]{32}$/);
  assert.ok(!key.includes("sub_0123456789abcdef0123"));
  assert.deepEqual([...redis.store.values()], ["1"]);
});

test("a failed send releases the submission id so the visitor's retry goes through", async () => {
  const redis = createFakeGuardRedis();
  const failing = build({ resend: createFakeResend({ mode: "throw" }), redis });
  const first = await post(failing.handler, validConsultationBody());
  assert.equal(first.statusCode, 502);
  assert.equal(redis.store.size, 0);

  const working = build({ redis });
  const retry = await post(working.handler, validConsultationBody());
  assert.equal(retry.statusCode, 200);
  assert.equal(working.resend.sent.length, 1);
});

test("a provider rejection returned as a result (not thrown) is treated as a failure, never as success", async () => {
  const { handler, events, errors } = build({ resend: createFakeResend({ mode: "error-result" }) });
  const res = await post(handler, validConsultationBody());
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().ok, false);
  assert.match(res.json().error, /submissions@itemassist\.com/);
  assert.equal(events.at(-1).outcome, "send_failed");
  assert.match(errors.join("\n"), /notification failed/);
});

test("an unavailable duplicate guard does not block the lead", async () => {
  const { handler, resend, errors } = build({ redis: createFakeGuardRedis({ fail: true }) });
  const res = await post(handler, validConsultationBody());
  assert.equal(res.statusCode, 200);
  assert.equal(resend.sent.length, 1);
  assert.match(errors.join("\n"), /duplicate guard unavailable/);
});

test("a malformed submission id is ignored rather than rejected", async () => {
  const { handler, resend, redis } = build();
  const res = await post(handler, validConsultationBody({ submission_id: "x" }));
  assert.equal(res.statusCode, 200);
  assert.equal(resend.sent.length, 1);
  assert.equal(redis.store.size, 0);
});

test("non-JSON bodies are refused", async () => {
  const { handler, resend } = build();
  const res = await post(handler, validConsultationBody(), { "content-type": "multipart/form-data; boundary=x" });
  assert.equal(res.statusCode, 415);
  assert.equal(resend.sent.length, 0);
});

test("a missing email configuration fails closed with a plain message, without leaking which setting", async () => {
  delete process.env.CONTACT_TO_EMAIL;
  const { handler, resend } = build();
  const res = await post(handler, validConsultationBody());
  assert.equal(res.statusCode, 500);
  assert.ok(!/CONTACT_TO_EMAIL|RESEND|TURNSTILE/.test(res.body));
  assert.equal(resend.sent.length, 0);
});

test("a personal-mailbox sender is treated as misconfigured, as in the assignment form", async () => {
  process.env.CONTACT_FROM_EMAIL = "someone@gmail.com";
  const { handler, resend } = build();
  const res = await post(handler, validConsultationBody());
  assert.equal(res.statusCode, 500);
  assert.equal(resend.sent.length, 0);
});

test("an absent or non-object body is a validation error, not a crash", async () => {
  const { handler } = build();
  for (const body of [undefined, null, "text", 42, []]) {
    const res = await post(handler, body);
    assert.equal(res.statusCode, 400);
  }
});
