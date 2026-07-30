import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const AVShared = require("../../../assets/js/av-shared.js");

test("toggling a single concrete service selects it alone", () => {
  const result = AVShared.toggleRequestedService([], "age_verification");
  assert.deepEqual(result, ["age_verification"]);
});

test("toggling multiple concrete services selects all of them", () => {
  let selected = AVShared.toggleRequestedService([], "age_verification");
  selected = AVShared.toggleRequestedService(selected, "item_pricing_valuation");
  assert.deepEqual(selected.sort(), ["age_verification", "item_pricing_valuation"]);
});

test("toggling a selected concrete service off removes only that value", () => {
  let selected = ["age_verification", "item_pricing_valuation"];
  selected = AVShared.toggleRequestedService(selected, "age_verification");
  assert.deepEqual(selected, ["item_pricing_valuation"]);
});

test("selecting unsure clears every concrete service", () => {
  const selected = AVShared.toggleRequestedService(["age_verification", "item_list_collection"], "unsure");
  assert.deepEqual(selected, ["unsure"]);
});

test("selecting a concrete service clears unsure", () => {
  const selected = AVShared.toggleRequestedService(["unsure"], "item_pricing_valuation");
  assert.deepEqual(selected, ["item_pricing_valuation"]);
});

test('"All of the Above" selects exactly the three concrete services and clears unsure, never storing "all_of_the_above"', () => {
  const selected = AVShared.toggleRequestedService(["unsure"], "all");
  assert.deepEqual(selected.sort(), ["age_verification", "item_list_collection", "item_pricing_valuation"].sort());
  assert.ok(selected.indexOf("all_of_the_above") === -1);
  assert.ok(selected.indexOf("all") === -1);
});

test('toggling "All of the Above" again while all three are selected deselects all three', () => {
  const allSelected = AVShared.toggleRequestedService([], "all");
  const deselected = AVShared.toggleRequestedService(allSelected, "all");
  assert.deepEqual(deselected, []);
});

test("manually deselecting one concrete service after selecting all makes isAllOfTheAboveSelected false", () => {
  const allSelected = AVShared.toggleRequestedService([], "all");
  assert.equal(AVShared.isAllOfTheAboveSelected(allSelected), true);

  const oneRemoved = AVShared.toggleRequestedService(allSelected, "item_list_collection");
  assert.equal(AVShared.isAllOfTheAboveSelected(oneRemoved), false);
});

test("no services selected is a valid (empty) state for the reducer itself", () => {
  assert.deepEqual(AVShared.toggleRequestedService([], "unsure"), ["unsure"]);
  const selected = AVShared.toggleRequestedService(["unsure"], "unsure");
  assert.deepEqual(selected, []);
});

test("requiresAgeVerificationLimitationsAck is true only for Age Verification without Item Pricing / Valuation", () => {
  assert.equal(AVShared.requiresAgeVerificationLimitationsAck(["age_verification"]), true);
  assert.equal(AVShared.requiresAgeVerificationLimitationsAck(["age_verification", "item_pricing_valuation"]), false);
  assert.equal(AVShared.requiresAgeVerificationLimitationsAck(["item_pricing_valuation"]), false);
  assert.equal(AVShared.requiresAgeVerificationLimitationsAck(["item_list_collection"]), false);
  assert.equal(AVShared.requiresAgeVerificationLimitationsAck([]), false);
});

test("REQUESTED_SERVICE_VALUES never includes an all_of_the_above literal", () => {
  assert.ok(AVShared.REQUESTED_SERVICE_VALUES.indexOf("all_of_the_above") === -1);
  assert.ok(AVShared.REQUESTED_SERVICE_VALUES.indexOf("all") === -1);
  assert.deepEqual(AVShared.REQUESTED_SERVICE_VALUES.sort(), ["age_verification", "item_list_collection", "item_pricing_valuation", "unsure"].sort());
});

test("INFORMATION_METHODS exposes exactly the three supported methods", () => {
  assert.deepEqual(AVShared.INFORMATION_METHODS, ["enter_items_now", "upload_or_paste_list", "list_needs_collection"]);
});
