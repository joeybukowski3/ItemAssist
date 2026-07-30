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
  requestedServices: ["age_verification"],
  informationMethod: "enter_items_now",
  workOrderDescription: "Need an age estimate for a claim.",
  universalAck: true,
  ageVerificationLimitationsAck: true
});

test("validateContactFields passes for a fully valid consumer submission", () => {
  assert.deepEqual(validation.validateContactFields(validContact()), []);
});

test("validateContactFields passes with only universal required fields (email, no phone, no customer type)", () => {
  const fields = {
    fullName: "Jane Smith",
    email: "jane@example.com",
    phone: "",
    customerType: "",
    preferredContactMethod: "",
    company: "",
    requestedServices: ["age_verification"],
    informationMethod: "enter_items_now",
    workOrderDescription: "Need an age estimate.",
    universalAck: true,
    ageVerificationLimitationsAck: true
  };
  assert.deepEqual(validation.validateContactFields(fields), []);
});

test("validateContactFields passes with only phone and no email", () => {
  const fields = { ...validContact(), email: "", phone: "555-555-5555" };
  assert.deepEqual(validation.validateContactFields(fields), []);
});

test("validateContactFields rejects when both email and phone are missing", () => {
  const errors = validation.validateContactFields({ ...validContact(), email: "", phone: "" });
  assert.ok(errors.some((e) => /email address or a phone number/.test(e)));
});

test("validateContactFields does not require customer type or company universally", () => {
  const errors = validation.validateContactFields({ ...validContact(), customerType: "", company: "" });
  assert.deepEqual(errors, []);
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

test("validateContactFields rejects an unknown information method", () => {
  const errors = validation.validateContactFields({ ...validContact(), informationMethod: "bogus" });
  assert.ok(errors.some((e) => /how you will provide the item information/.test(e)));
});

test("validateContactFields requires the universal acknowledgement", () => {
  const errors = validation.validateContactFields({ ...validContact(), universalAck: false });
  assert.ok(errors.some((e) => /authorization statement/.test(e)));
});

test("validateContactFields requires the AV limitations ack only when Age Verification is selected without Item Pricing / Valuation", () => {
  const avOnly = validation.validateContactFields({
    ...validContact(),
    requestedServices: ["age_verification"],
    ageVerificationLimitationsAck: false
  });
  assert.ok(avOnly.some((e) => /service-limitations statement/.test(e)));

  const avPlusPricing = validation.validateContactFields({
    ...validContact(),
    requestedServices: ["age_verification", "item_pricing_valuation"],
    ageVerificationLimitationsAck: false
  });
  assert.deepEqual(avPlusPricing, []);

  const pricingOnly = validation.validateContactFields({
    ...validContact(),
    requestedServices: ["item_pricing_valuation"],
    ageVerificationLimitationsAck: false
  });
  assert.deepEqual(pricingOnly, []);
});

test("validateContactFields requires at least one requested service", () => {
  const errors = validation.validateContactFields({ ...validContact(), requestedServices: [] });
  assert.ok(errors.some((e) => /at least one requested service/.test(e)));
});

test("validateContactFields rejects an unknown requested service value (never all_of_the_above)", () => {
  const errors = validation.validateContactFields({ ...validContact(), requestedServices: ["all_of_the_above"] });
  assert.ok(errors.some((e) => /not valid/.test(e)));
});

test("validateContactFields requires a work order description", () => {
  const errors = validation.validateContactFields({ ...validContact(), workOrderDescription: "" });
  assert.ok(errors.some((e) => /briefly describe the work order/.test(e)));
});

test("validateItem (enter items now) requires only a description", () => {
  const errors = validation.validateItem({ description: "", category: "Television" });
  assert.ok(errors.some((e) => /brief item description/.test(e)));

  const withDescription = validation.validateItem({ description: "Living room TV" });
  assert.deepEqual(withDescription, []);
});

test("validateItem does not require category, brand, model, or serial", () => {
  const errors = validation.validateItem({ description: "Living room TV", category: "", brand: "", model: "", serial: "" });
  assert.deepEqual(errors, []);
});

test("validateItems requires at least one item", () => {
  assert.deepEqual(validation.validateItems([]), ["At least one item is required."]);
});

test("validateItems reports per-item, 1-indexed error messages", () => {
  const errors = validation.validateItems([{ description: "Item one" }, { description: "" }]);
  assert.ok(errors.some((e) => e.startsWith("Item 2:")));
  assert.ok(!errors.some((e) => e.startsWith("Item 1:")));
});

test("validateItemList accepts a pasted list alone", () => {
  assert.deepEqual(validation.validateItemList({ pastedText: "TV, fridge, microwave" }), []);
});

test("validateItemList accepts an uploaded file alone", () => {
  assert.deepEqual(validation.validateItemList({ hasUploadedFile: true }), []);
});

test("validateItemList accepts willProvideLater alone", () => {
  assert.deepEqual(validation.validateItemList({ willProvideLater: true }), []);
});

test("validateItemList rejects when none of the three are provided", () => {
  const errors = validation.validateItemList({});
  assert.ok(errors.some((e) => /upload a file, paste your item list/.test(e)));
});

test('the "provide the full list after Item Assist contacts me" path remains available when a client\'s real files exceed the website upload limits', () => {
  // A client whose files are too large or numerous for MAX_FILE_SIZE_BYTES /
  // MAX_TOTAL_BYTES / MAX_FILE_COUNT can still submit a complete, valid work
  // order by declining to upload and selecting willProvideLater instead --
  // validateItemList has no dependency on file-size limits at all.
  assert.deepEqual(validation.validateItemList({ hasUploadedFile: false, pastedText: "", willProvideLater: true }), []);
});

test("validateThirdPartyCollection requires contact name, at least one contact method, and authorization", () => {
  const missingName = validation.validateThirdPartyCollection({ email: "a@b.com", authorizationAck: true });
  assert.ok(missingName.some((e) => /contact person or organization/.test(e)));

  const missingContactMethod = validation.validateThirdPartyCollection({ contactNameOrOrg: "Jane Doe", authorizationAck: true });
  assert.ok(missingContactMethod.some((e) => /email address or a phone number/.test(e)));

  const missingAuthorization = validation.validateThirdPartyCollection({
    contactNameOrOrg: "Jane Doe",
    email: "a@b.com",
    authorizationAck: false
  });
  assert.ok(missingAuthorization.some((e) => /authorized to provide this contact/.test(e)));

  const valid = validation.validateThirdPartyCollection({
    contactNameOrOrg: "Jane Doe",
    email: "a@b.com",
    authorizationAck: true
  });
  assert.deepEqual(valid, []);
});

test("validateThirdPartyCollection accepts phone-only contact", () => {
  const valid = validation.validateThirdPartyCollection({
    contactNameOrOrg: "Jane Doe",
    phone: "555-555-5555",
    authorizationAck: true
  });
  assert.deepEqual(valid, []);
});

test("validateInformationMethodPath dispatches to the correct conditional validator", () => {
  assert.deepEqual(
    validation.validateInformationMethodPath("enter_items_now", { items: [{ description: "TV" }] }),
    []
  );
  assert.deepEqual(
    validation.validateInformationMethodPath("upload_or_paste_list", { itemList: { pastedText: "TV" } }),
    []
  );
  assert.deepEqual(
    validation.validateInformationMethodPath("list_needs_collection", {
      thirdPartyCollection: { contactNameOrOrg: "Jane", email: "a@b.com", authorizationAck: true }
    }),
    []
  );
  assert.deepEqual(validation.validateInformationMethodPath("unknown_method", {}), []);
});

test("isValidResultStatus accepts empty string and the three enum values, rejects anything else", () => {
  assert.equal(validation.isValidResultStatus(""), true);
  assert.equal(validation.isValidResultStatus("resolved"), true);
  assert.equal(validation.isValidResultStatus("ambiguous"), true);
  assert.equal(validation.isValidResultStatus("no_match"), true);
  assert.equal(validation.isValidResultStatus("bogus"), false);
});
