import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const validation = require("../../../api/lib/age-verification/validation.js");

const validContact = () => ({
  fullName: "Jane Smith",
  email: "jane@example.com",
  phone: "555-555-5555",
  customerType: "homeowner_or_consumer",
  preferredContactMethod: "email",
  company: "",
  requestedService: "age_verification",
  reasonForRequest: "Need an age estimate for a claim.",
  authorizationAck: true,
  limitationsAck: true
});

test("validateContactFields passes for a fully valid consumer submission", () => {
  assert.deepEqual(validation.validateContactFields(validContact()), []);
});

test("validateContactFields requires company for professional customer types", () => {
  const fields = { ...validContact(), customerType: "insurance_adjuster", company: "" };
  const errors = validation.validateContactFields(fields);
  assert.ok(errors.some((e) => /Company or organization is required/.test(e)));
});

test("validateContactFields does not require company for homeowner/consumer", () => {
  const fields = { ...validContact(), customerType: "homeowner_or_consumer", company: "" };
  const errors = validation.validateContactFields(fields);
  assert.ok(!errors.some((e) => /Company or organization is required/.test(e)));
});

test("validateContactFields rejects an invalid email", () => {
  const errors = validation.validateContactFields({ ...validContact(), email: "not-an-email" });
  assert.ok(errors.some((e) => /valid email/.test(e)));
});

test("validateContactFields rejects an unknown customerType/requestedService enum value", () => {
  const errors1 = validation.validateContactFields({ ...validContact(), customerType: "bogus" });
  assert.ok(errors1.some((e) => /describes you/.test(e)));

  const errors2 = validation.validateContactFields({ ...validContact(), requestedService: "bogus" });
  assert.ok(errors2.some((e) => /requested service/.test(e)));
});

test("validateContactFields requires both authorization and limitations acknowledgements", () => {
  const errors = validation.validateContactFields({ ...validContact(), authorizationAck: false, limitationsAck: false });
  assert.ok(errors.some((e) => /authorization statement/.test(e)));
  assert.ok(errors.some((e) => /service-limitations statement/.test(e)));
});

test("validateItems requires at least one item", () => {
  assert.deepEqual(validation.validateItems([]), ["At least one item is required."]);
});

test("validateItem requires a category", () => {
  const errors = validation.validateItem({ category: "", serial: "SN123" });
  assert.ok(errors.some((e) => /needs a category/.test(e)));
});

test("validateItem allows a missing serial only when noSerial is checked", () => {
  const withoutEither = validation.validateItem({ category: "Television", serial: "", noSerial: false });
  assert.ok(withoutEither.some((e) => /no readable serial/.test(e)));

  const withNoSerialChecked = validation.validateItem({ category: "Television", serial: "", noSerial: true });
  assert.deepEqual(withNoSerialChecked, []);

  const withSerial = validation.validateItem({ category: "Television", serial: "SN123", noSerial: false });
  assert.deepEqual(withSerial, []);
});

test("validateItems reports per-item, 1-indexed error messages", () => {
  const errors = validation.validateItems([
    { category: "Television", serial: "SN1" },
    { category: "", serial: "" }
  ]);
  assert.ok(errors.some((e) => e.startsWith("Item 2:")));
  assert.ok(!errors.some((e) => e.startsWith("Item 1:")));
});

test("isValidResultStatus accepts empty string and the three enum values, rejects anything else", () => {
  assert.equal(validation.isValidResultStatus(""), true);
  assert.equal(validation.isValidResultStatus("resolved"), true);
  assert.equal(validation.isValidResultStatus("ambiguous"), true);
  assert.equal(validation.isValidResultStatus("no_match"), true);
  assert.equal(validation.isValidResultStatus("bogus"), false);
});
