import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const v = require("../../../api/_lib/consultation/validation.js");
const { buildInternalNotification, escapeHtml } = require("../../../api/_lib/consultation/email.js");
const { dedupeKey, claimSubmission, releaseSubmission } = require("../../../api/_lib/consultation/dedupe.js");

const base = { name: "Jane Smith", email: "jane@example.com", reason: "other" };

test("a minimal valid body has no errors and trims every field", () => {
  const { errors, fields } = v.validateConsultation({ name: "  Jane  Smith ", email: " jane@example.com ", reason: " other " });
  assert.deepEqual(errors, {});
  assert.equal(fields.name, "Jane Smith");
  assert.equal(fields.email, "jane@example.com");
  assert.equal(fields.reason, "other");
});

test("every published reason and item-count band is accepted", () => {
  for (const reason of Object.keys(v.REASONS)) assert.deepEqual(v.validateConsultation({ ...base, reason }).errors, {});
  for (const item_count of Object.keys(v.ITEM_COUNT_BANDS)) assert.deepEqual(v.validateConsultation({ ...base, item_count }).errors, {});
});

test("inherited object keys are not accepted as reasons", () => {
  for (const reason of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    assert.ok(v.validateConsultation({ ...base, reason }).errors.reason, reason);
  }
});

test("email rules: one plain address, no whitespace, no angle brackets, bounded length", () => {
  for (const good of ["a@b.co", "first.last+tag@sub.example.com"]) assert.ok(v.isValidEmail(good), good);
  for (const bad of ["", "a@b", "a b@c.com", "a@b.c", "<a@b.com>", "a@b.com, c@d.com", "a@b.com;c@d.com", "a@@b.com", "x".repeat(250) + "@b.com"]) {
    assert.ok(!v.isValidEmail(bad), bad);
  }
});

test("phone rules: 7 to 20 digits with ordinary punctuation, extension allowed", () => {
  for (const good of ["(555) 555-5555", "+1 555 555 5555", "555.555.5555 ext 12", "555-5555 x2"]) assert.ok(v.isValidPhone(good), good);
  for (const bad of ["12", "abcdefghij", "extextext", "555-555-5555; DROP TABLE", "1".repeat(21), "5".repeat(7) + "<b>"]) assert.ok(!v.isValidPhone(bad), bad);
});

test("line breaks and control characters are stripped from single-line fields", () => {
  assert.equal(v.cleanLine("a\r\nb\u0000c d"), "a bc d");
  assert.equal(v.cleanText("a\r\nb\u0007c\n\n\n\nd"), "a\nbc\n\nd");
});

test("a campaign tag is kept only when it is a short plain tag", () => {
  for (const good of ["linkedin", "spring-sale", "news_letter", "email.2026", "a b"]) assert.equal(v.cleanSourceToken(good), good);
  for (const bad of ["", "https://x.test/y", "a@b.com", "<script>", "x".repeat(41), "-leading", "semi;colon"]) assert.equal(v.cleanSourceToken(bad), "", bad);
  assert.equal(v.validateConsultation({ ...base, ref: "partner-a" }).fields.source.source, "partner-a");
  assert.equal(v.validateConsultation({ ...base, utm_source: "li", ref: "ignored" }).fields.source.source, "li");
});

test("a malformed submission id is blanked", () => {
  assert.equal(v.validateConsultation({ ...base, submission_id: "short" }).fields.submissionId, "");
  assert.equal(v.validateConsultation({ ...base, submission_id: "has spaces and ! chars......" }).fields.submissionId, "");
  assert.equal(v.validateConsultation({ ...base, submission_id: "sub_0123456789abcdef0123" }).fields.submissionId, "sub_0123456789abcdef0123");
});

test("the notification body lists only what was provided, escapes it, and states what it is", () => {
  const { fields } = v.validateConsultation({ ...base, name: "A <b>Name</b>", description: "line one\nline two" });
  const mail = buildInternalNotification(fields, { leadId: "CI-20261103-AAAAAAAA", receivedAt: "2026-11-03T15:00:00.000Z" });
  assert.ok(mail.html.includes("A &lt;b&gt;Name&lt;/b&gt;"));
  assert.ok(mail.html.includes("line one<br>line two"));
  assert.ok(!mail.text.includes("Phone:"));
  assert.match(mail.text, /not an assignment submission/);
  assert.equal(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
});

test("the duplicate-guard key is a fixed-length hash of the id", () => {
  const key = dedupeKey("sub_0123456789abcdef0123");
  assert.match(key, /^itemassist:consultation:submission:[0-9a-f]{32}$/);
  assert.equal(key, dedupeKey("sub_0123456789abcdef0123"));
  assert.notEqual(key, dedupeKey("sub_0123456789abcdef0124"));
});

test("claim uses SET NX with an expiry, and release deletes the same key", async () => {
  const calls = [];
  const redis = {
    async set(...args) { calls.push(["set", ...args]); return "OK"; },
    async del(...args) { calls.push(["del", ...args]); return 1; }
  };
  assert.equal(await claimSubmission("sub_0123456789abcdef0123", { redis }), true);
  await releaseSubmission("sub_0123456789abcdef0123", { redis });
  const key = dedupeKey("sub_0123456789abcdef0123");
  assert.deepEqual(calls[0], ["set", key, "1", { nx: true, ex: 3600 }]);
  assert.deepEqual(calls[1], ["del", key]);
  const taken = { async set() { return null; } };
  assert.equal(await claimSubmission("sub_0123456789abcdef0123", { redis: taken }), false);
});
