import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const AVShared = require("../../../assets/js/av-shared.js");

test("mapDecodeMyItemCategory maps electronics to the closest available option", () => {
  assert.equal(AVShared.mapDecodeMyItemCategory("electronics"), "Television / Home Electronics");
});

test("mapDecodeMyItemCategory maps appliances to Major Household Appliance", () => {
  assert.equal(AVShared.mapDecodeMyItemCategory("appliances"), "Major Household Appliance");
});

test("mapDecodeMyItemCategory maps hvac to its dedicated HVAC Equipment option", () => {
  assert.equal(AVShared.mapDecodeMyItemCategory("hvac"), "HVAC Equipment");
});

test("mapDecodeMyItemCategory maps waterHeaters to its dedicated Water Heater option", () => {
  assert.equal(AVShared.mapDecodeMyItemCategory("waterHeaters"), "Water Heater");
});

test("mapDecodeMyItemCategory returns empty string for an unknown key instead of forcing a value", () => {
  assert.equal(AVShared.mapDecodeMyItemCategory("furniture"), "");
  assert.equal(AVShared.mapDecodeMyItemCategory("bogus-key"), "");
});

test("mapDecodeMyItemCategory returns empty string for an empty/nullish value", () => {
  assert.equal(AVShared.mapDecodeMyItemCategory(""), "");
  assert.equal(AVShared.mapDecodeMyItemCategory(undefined), "");
  assert.equal(AVShared.mapDecodeMyItemCategory(null), "");
});

test("mapDecodeMyItemCategory passes through a value that already exactly matches a valid CATEGORY_OPTIONS label", () => {
  assert.equal(AVShared.mapDecodeMyItemCategory("Major Household Appliance"), "Major Household Appliance");
  assert.equal(AVShared.mapDecodeMyItemCategory("HVAC Equipment"), "HVAC Equipment");
  assert.equal(AVShared.mapDecodeMyItemCategory("Water Heater"), "Water Heater");
  assert.equal(AVShared.mapDecodeMyItemCategory("Furniture / Household Goods"), "Furniture / Household Goods");
});

test("every mapped DecodeMyItem key value exists in CATEGORY_OPTIONS", () => {
  for (const key of ["electronics", "appliances", "hvac", "waterHeaters"]) {
    const mapped = AVShared.mapDecodeMyItemCategory(key);
    assert.ok(
      AVShared.CATEGORY_OPTIONS.includes(mapped),
      `mapDecodeMyItemCategory("${key}") returned "${mapped}", which is not in CATEGORY_OPTIONS`
    );
  }
});

test("CATEGORY_OPTIONS includes the dedicated HVAC Equipment and Water Heater options", () => {
  assert.ok(AVShared.CATEGORY_OPTIONS.includes("HVAC Equipment"));
  assert.ok(AVShared.CATEGORY_OPTIONS.includes("Water Heater"));
});

test("mapDecodeMyItemCategory is only meaningful behind isDecodeMyItemReferral -- confirms the gating contract", () => {
  // The mapping function itself is a pure lookup with no source-checking of
  // its own; request-age-verification.js only calls it inside `if
  // (isReferral)`. This test documents that contract so a future refactor
  // that calls it unconditionally doesn't accidentally start applying the
  // mapping to direct-visitor category values that happen to collide with a
  // DecodeMyItem key (e.g. a manually typed "hvac").
  assert.equal(AVShared.isDecodeMyItemReferral({ source: "direct", category: "hvac" }), false);
  assert.equal(AVShared.isDecodeMyItemReferral({ source: undefined, category: "hvac" }), false);
});

test("isDecodeMyItemReferral is false when there is no referral source at all", () => {
  assert.equal(AVShared.isDecodeMyItemReferral(undefined), false);
  assert.equal(AVShared.isDecodeMyItemReferral({}), false);
  assert.equal(AVShared.isDecodeMyItemReferral({ source: "" }), false);
});
