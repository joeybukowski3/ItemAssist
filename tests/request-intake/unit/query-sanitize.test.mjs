import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const AVShared = require("../../../assets/js/av-shared.js");

test("sanitizeQueryValue strips control chars and angle brackets, trims, and length-limits", () => {
  assert.equal(AVShared.sanitizeQueryValue("  Sony  "), "Sony");
  assert.equal(AVShared.sanitizeQueryValue("<script>alert(1)</script>"), "scriptalert(1)/script");
  assert.equal(AVShared.sanitizeQueryValue("a".repeat(200)).length, 80);
  assert.equal(AVShared.sanitizeQueryValue("a".repeat(200), 10).length, 10);
  assert.equal(AVShared.sanitizeQueryValue(null), "");
  assert.equal(AVShared.sanitizeQueryValue(undefined), "");
  assert.equal(AVShared.sanitizeQueryValue(42), "");
});

test("parseReferralParams only reads the allowlisted params and ignores unknown ones", () => {
  const params = new URLSearchParams({
    brand: "Sony",
    model: "XBR-65",
    category: "Television",
    result_id: "abc123",
    source: "decodemyitem",
    result_status: "resolved",
    serial_number: "SHOULD-NOT-APPEAR",
    claim_number: "SHOULD-NOT-APPEAR",
    email: "SHOULD-NOT-APPEAR"
  });

  const referral = AVShared.parseReferralParams(params);

  assert.equal(referral.brand, "Sony");
  assert.equal(referral.model, "XBR-65");
  assert.equal(referral.category, "Television");
  assert.equal(referral.resultId, "abc123");
  assert.equal(referral.source, "decodemyitem");
  assert.equal(referral.resultStatus, "resolved");
  assert.deepEqual(Object.keys(referral).sort(), ["brand", "category", "model", "resultId", "resultStatus", "source"]);
});

test("parseReferralParams rejects an invalid result_status enum value", () => {
  const params = new URLSearchParams({ result_status: "not_a_real_status" });
  const referral = AVShared.parseReferralParams(params);
  assert.equal(referral.resultStatus, "");
});

for (const status of AVShared.RESULT_STATUSES) {
  test(`parseReferralParams accepts valid result_status "${status}"`, () => {
    const params = new URLSearchParams({ result_status: status });
    assert.equal(AVShared.parseReferralParams(params).resultStatus, status);
  });
}

test("isDecodeMyItemReferral only matches source=decodemyitem", () => {
  assert.equal(AVShared.isDecodeMyItemReferral({ source: "decodemyitem" }), true);
  assert.equal(AVShared.isDecodeMyItemReferral({ source: "google" }), false);
  assert.equal(AVShared.isDecodeMyItemReferral({}), false);
  assert.equal(AVShared.isDecodeMyItemReferral(null), false);
});

test("getReferralIntroCopy returns the correct copy per status and empty string otherwise", () => {
  assert.match(AVShared.getReferralIntroCopy("resolved"), /automated age estimate/);
  assert.match(AVShared.getReferralIntroCopy("ambiguous"), /multiple possible manufacture years/);
  assert.match(AVShared.getReferralIntroCopy("no_match"), /could not confirm/);
  assert.equal(AVShared.getReferralIntroCopy(""), "");
  assert.equal(AVShared.getReferralIntroCopy("bogus"), "");
});

test("isProfessionalCustomerType classifies professional vs. consumer types", () => {
  assert.equal(AVShared.isProfessionalCustomerType("insurance_carrier"), true);
  assert.equal(AVShared.isProfessionalCustomerType("independent_adjuster"), true);
  assert.equal(AVShared.isProfessionalCustomerType("homeowner_or_consumer"), false);
  assert.equal(AVShared.isProfessionalCustomerType("other"), false);
});

test("generateRequestId produces the IAV-YYYYMMDD-XXXXXXXX shape", () => {
  const id = AVShared.generateRequestId(new Date("2026-01-05T12:00:00Z"), "abcdef1234");
  assert.equal(id, "IAV-20260105-ABCDEF12");
  assert.match(id, /^IAV-\d{8}-[0-9A-F]{8}$/);
});
