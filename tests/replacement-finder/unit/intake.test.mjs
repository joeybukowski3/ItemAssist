import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const RF = require("../../../assets/js/rf-shared.js");
const Intake = require("../../../assets/js/rf-intake.js");

const say = (text, state = Intake.initialState()) => Intake.receive(state, text);
const lookupOf = (text, state) => {
  const result = say(text, state);
  assert.equal(result.action.type, "lookup", `"${text}" should start a lookup, got ${result.action.type}`);
  return result;
};

// ---- direct model recognition (auto-run) ----------------------------------------------------------------------------------

const AUTO_RUN = [
  ["Samsung QN55Q80C", "television", "Samsung", "QN55Q80C"],
  ["QN55Q80C", "television", "Samsung", "QN55Q80C"],
  ["qn55q80c", "television", "Samsung", "QN55Q80C"],
  ["Find a replacement for my Samsung QN55Q80C", "television", "Samsung", "QN55Q80C"],
  ["Need an LKQ for QN55Q80C", "television", "Samsung", "QN55Q80C"],
  ["LG LRFCS25D3S", "refrigerator", "LG", "LRFCS25D3S"],
  ["LRFCS25D3S", "refrigerator", "LG", "LRFCS25D3S"],
  ["What replaces my LG LRFCS25D3S?", "refrigerator", "LG", "LRFCS25D3S"],
  ["  lg   lrfcs25d3s  ", "refrigerator", "LG", "LRFCS25D3S"]
];
for (const [input, category, brand, model] of AUTO_RUN) {
  test(`auto-run: "${input}" resolves to ${brand} ${model} (${category}) with no question`, () => {
    const { state, action } = lookupOf(input);
    assert.deepEqual(action.payload, { category, brand, model, notes: "", website: "" });
    assert.equal(state.status, Intake.STATUS.READY);
    assert.equal(action.message, `I found ${brand} ${model}. Researching the current replacement now.`);
  });
}

test("auto-run: the payload is exactly what the structured form would send, so the proxy validation is unchanged", () => {
  for (const [input] of AUTO_RUN) {
    const { action } = lookupOf(input);
    const checked = RF.validateLookup(action.payload);
    assert.equal(checked.ok, true);
    assert.deepEqual(checked.value, action.payload);
  }
});

test("model recognition: a Samsung full model number with a retailer suffix is still a television", () => {
  assert.equal(lookupOf("QN55Q80CAFXZA").action.payload.category, "television");
  assert.equal(lookupOf("Samsung UN55CU7000").action.payload.category, "television");
});

test("model recognition: other LG refrigerator families are recognised", () => {
  for (const model of ["LRMVS3006S", "LFXS26973S", "LMXS28626S", "LSXS26366S", "LTCS24223S"]) {
    assert.equal(Intake.inferCategory(model), "refrigerator", model);
  }
});

test("model recognition: other LG products and arbitrary strings do not infer a supported category", () => {
  for (const model of ["OLED55C3PUA", "LDFN4542S", "WM4000HWA", "QN90C", "XYZ123", "LG", "55INCH"]) {
    assert.equal(Intake.inferCategory(model), null, model);
  }
});

test("support rules stay in one place: every supported category has an intake pattern and its example resolves to itself", () => {
  for (const key of Object.keys(RF.SUPPORT)) {
    assert.ok(Intake.FAMILIES[key], `${key} has no intake family`);
    assert.equal(Intake.inferCategory(RF.SUPPORT[key].example), key);
    assert.equal(Intake.detectBrand(RF.SUPPORT[key].brand + " anything").includes(key), true);
  }
  for (const key of Object.keys(Intake.FAMILIES)) assert.ok(RF.SUPPORT[key], `${key} is not a supported category`);
});

test("brand detection only recognises supported brands", () => {
  assert.deepEqual(Intake.detectBrand("my Samsung QN55Q80C"), ["television"]);
  assert.deepEqual(Intake.detectBrand("LG's fridge"), ["refrigerator"]);
  assert.deepEqual(Intake.detectBrand("Sony KD55X80K"), []);
  assert.deepEqual(Intake.detectBrand("Samsungite"), []);
});

// ---- notes ----------------------------------------------------------------------------------------------------------------

test("notes: reusing a wall mount becomes the supported note", () => {
  const { action } = lookupOf("Samsung QN55Q80C, reusing the existing wall mount");
  assert.equal(action.payload.model, "QN55Q80C");
  assert.equal(action.payload.notes, "Reusing existing wall mount");
  assert.match(action.message, /I'll note: Reusing existing wall mount\./);
});

test("notes: a fit-the-opening constraint becomes the supported note", () => {
  assert.equal(lookupOf("LG LRFCS25D3S must fit the same opening").action.payload.notes, "Must fit existing opening");
  assert.equal(lookupOf("LG LRFCS25D3S must fit the existing opening").action.payload.notes, "Must fit existing opening");
});

test("notes: both constraints are kept, in a fixed order", () => {
  const { action } = lookupOf("Samsung QN55Q80C reusing the wall mount and it has to fit the current opening");
  assert.equal(action.payload.notes, "Must fit existing opening; Reusing existing wall mount");
});

test("notes: preferences and negated constraints are not turned into requirements", () => {
  assert.equal(lookupOf("Samsung QN55Q80C, I want a brighter picture and better sound").action.payload.notes, "");
  assert.equal(lookupOf("Samsung QN55Q80C, can't reuse the wall mount").action.payload.notes, "");
  assert.equal(lookupOf("Samsung QN55Q80C, I mentioned a wall mount once").action.payload.notes, "");
  assert.deepEqual(Intake.extractSupportedNotes("hello"), []);
});

test("notes survive a clarification and are sent with the completed lookup", () => {
  const first = say("Samsung Q80C, reusing the existing wall mount");
  assert.equal(first.action.type, "clarify");
  const done = Intake.answer(first.state, { kind: "size", size: 65 });
  assert.equal(done.action.type, "lookup");
  assert.deepEqual(done.action.payload, { category: "television", brand: "Samsung", model: "QN65Q80C", notes: "Reusing existing wall mount", website: "" });
});

// ---- follow-up questions --------------------------------------------------------------------------------------------------

test("clarify: a series with no size asks for the size and never invents a SKU", () => {
  for (const input of ["Samsung Q80C", "Q80C"]) {
    const { state, action } = say(input);
    assert.equal(action.type, "clarify");
    assert.equal(action.field, "size");
    assert.equal(action.prompt, "What size is the TV?");
    assert.deepEqual(action.choices.map((choice) => choice.label), ['55"', '65"', '75"', "Other"]);
    assert.equal(action.payload, undefined);
    assert.equal(state.status, Intake.STATUS.NEEDS_CLARIFICATION);
  }
});

test("clarify: a tapped size completes the lookup and says it composed the model", () => {
  const first = say("Samsung Q80C");
  const done = Intake.answer(first.state, first.action.choices[0].value);
  assert.equal(done.action.type, "lookup");
  assert.equal(done.action.payload.model, "QN55Q80C");
  assert.equal(done.action.message, "I read that as Samsung QN55Q80C. Researching the current replacement now.");
  assert.equal(done.state.status, Intake.STATUS.READY);
});

test("clarify: a typed size completes it too, in any common spelling", () => {
  for (const answer of ['65"', "65", "65 inch", "65-inch", "65in", "a 65 inch one"]) {
    const asked = say("Q80C");
    const done = say(answer, asked.state);
    assert.equal(done.action.type, "lookup", answer);
    assert.equal(done.action.payload.model, "QN65Q80C", answer);
  }
});

test("clarify: the size is in the message when the user gives it up front", () => {
  for (const input of ["Samsung 55 inch Q80C", 'Samsung 55" Q80C', "Samsung Q80C 55-inch", "55 Q80C"]) {
    const { action } = lookupOf(input);
    assert.equal(action.payload.model, "QN55Q80C", input);
    assert.equal(action.composed, true);
  }
});

test("clarify: a size outside the real range is not accepted", () => {
  const asked = say("Q80C");
  const again = say("12 inch", asked.state);
  assert.equal(again.action.type, "clarify");
  assert.match(again.action.prompt, /^I didn't catch that\. What size is the TV\?/);
});

test("clarify: a brand and category without a model asks for the model number", () => {
  for (const [input, subject] of [["LG refrigerator", "LG refrigerator"], ["Samsung TV", "Samsung television"], ["my fridge", "LG refrigerator"]]) {
    const { action } = say(input);
    assert.equal(action.type, "clarify", input);
    assert.equal(action.field, "model");
    assert.equal(action.prompt, `What is the model number of the ${subject}?`);
    assert.deepEqual(action.choices.map((choice) => choice.label), [Intake.MANUAL_LABEL]);
  }
});

test("clarify: the model number typed as the answer completes the lookup without asking for the brand again", () => {
  const asked = say("LG refrigerator");
  const done = say("LRFCS25D3S", asked.state);
  assert.equal(done.action.type, "lookup");
  assert.deepEqual(done.action.payload, { category: "refrigerator", brand: "LG", model: "LRFCS25D3S", notes: "", website: "" });
});

test("clarify: a different complete request mid-question replaces the old one", () => {
  const asked = say("LG refrigerator");
  const done = say("Samsung QN55Q80C", asked.state);
  assert.equal(done.action.payload.model, "QN55Q80C");
  assert.equal(done.action.payload.brand, "Samsung");
});

test("clarify: an unrelated reply repeats the question instead of guessing, and keeps the state", () => {
  const asked = say("LG refrigerator");
  const again = say("hello", asked.state);
  assert.equal(again.action.type, "clarify");
  assert.match(again.action.prompt, /^I didn't catch that\. What is the model number/);
  assert.equal(again.state, asked.state);
});

test("clarify: cancelling returns to idle", () => {
  const asked = say("LG refrigerator");
  const done = say("never mind", asked.state);
  assert.equal(done.action.type, "say");
  assert.equal(done.state.status, Intake.STATUS.IDLE);
  assert.equal(done.state.draft, null);
});

test("clarify: two possible models offer both, plus the manual path", () => {
  const { action } = say("QN55Q80C or QN65Q80C");
  assert.equal(action.type, "clarify");
  assert.deepEqual(action.choices.map((choice) => choice.label), ["QN55Q80C", "QN65Q80C", Intake.MANUAL_LABEL]);
  const done = Intake.answer(say("QN55Q80C or QN65Q80C").state, action.choices[1].value);
  assert.equal(done.action.payload.model, "QN65Q80C");
});

test("clarify: a brand that contradicts the model asks which is right, and the answer is honoured", () => {
  const first = say("LG QN55Q80C");
  assert.equal(first.action.type, "clarify");
  assert.equal(first.action.field, "category");
  const television = Intake.answer(first.state, { kind: "category", category: "television" });
  assert.equal(television.action.type, "lookup");
  assert.equal(television.action.payload.brand, "Samsung");
  // Choosing the brand the user typed does not loop: the model is simply not recognised for it, so it asks before researching.
  const refrigerator = Intake.answer(first.state, { kind: "category", category: "refrigerator" });
  assert.equal(refrigerator.action.type, "clarify");
  assert.equal(refrigerator.action.field, "confirm");
});

test("clarify: a series belonging to the other category is dropped when the user picks, never reinterpreted", () => {
  const first = say("LG Q80C");
  const picked = Intake.answer(first.state, { kind: "category", category: "refrigerator" });
  assert.equal(picked.action.type, "clarify");
  assert.equal(picked.action.field, "model");
  assert.equal(picked.action.payload, undefined);
});

test("clarify: both brands named asks which one", () => {
  const { action } = say("Samsung LG QN55Q80C");
  assert.equal(action.type, "clarify");
  assert.equal(action.field, "category");
});

// ---- unsupported and out-of-scope input ------------------------------------------------------------------------------------

test("scope: greetings and general questions get the boundary message, no lookup and no form", () => {
  for (const input of ["hello", "what is the best phone?", "how are you", "", "   "]) {
    const { state, action } = say(input);
    assert.equal(action.type, "say", input);
    assert.equal(action.message, "I can currently help identify and research replacement models. Send me a brand and model number, or use Find Replacement.");
    assert.equal(state.status, Intake.STATUS.IDLE);
  }
});

test("scope: the old dead-end wording is gone", () => {
  const all = ["hello", "Samsung XYZ123", "Find a replacement"].map((input) => JSON.stringify(say(input).action)).join(" ");
  assert.doesNotMatch(all, /free-form/);
});

test("scope: a replacement request with nothing identifiable asks for a brand and model", () => {
  const { action } = say("Find a replacement");
  assert.equal(action.type, "say");
  assert.equal(action.message, "Which item should I research? Send a brand and model number, like Samsung QN55Q80C.");
});

test("unsupported: an unrecognised model with a supported brand is confirmed before it is sent, then the server decides", () => {
  const asked = say("Samsung XYZ123");
  assert.equal(asked.action.type, "clarify");
  assert.equal(asked.action.field, "confirm");
  assert.deepEqual(asked.action.choices.map((choice) => choice.label), ["Research XYZ123 anyway", Intake.MANUAL_LABEL]);
  const sent = Intake.answer(asked.state, asked.action.choices[0].value);
  assert.deepEqual(sent.action.payload, { category: "television", brand: "Samsung", model: "XYZ123", notes: "", website: "" });
});

test("unsupported: an unrecognised model with no supported brand goes to the manual form, with nothing invented", () => {
  const { state, action } = say("Sony KD55X80K");
  assert.equal(action.type, "manual");
  assert.match(action.message, /Samsung televisions and LG refrigerators/);
  assert.equal(action.prefill.model, "KD55X80K");
  assert.equal(action.prefill.category, undefined);
  assert.equal(action.payload, undefined);
  assert.equal(state.status, Intake.STATUS.IDLE);
});

test("unsupported: a supported brand with the wrong product type is a conflict question, not a lookup", () => {
  const { action } = say("Samsung refrigerator");
  assert.equal(action.type, "clarify");
  assert.equal(action.field, "category");
});

test("manual: the manual choice hands what is known to the structured form", () => {
  const asked = say("Samsung Q80C, reusing the existing wall mount");
  const manual = Intake.answer(asked.state, { kind: "manual" });
  assert.equal(manual.action.type, "manual");
  assert.deepEqual(manual.action.prefill, { category: "television", model: "", notes: "Reusing existing wall mount" });
  assert.equal(manual.state.status, Intake.STATUS.IDLE);
});

test("validation: an overlong model string is never sent as a model number", () => {
  const { action } = say("Samsung " + "QN55Q80C".repeat(6));
  assert.notEqual(action.type, "lookup");
});

// ---- state machine --------------------------------------------------------------------------------------------------------

test("state machine: the documented path IDLE -> NEEDS_CLARIFICATION -> READY -> RESEARCHING -> RESULT", () => {
  let state = Intake.initialState();
  assert.equal(state.status, "IDLE");
  const asked = say("Q80C", state);
  assert.equal(asked.state.status, "NEEDS_CLARIFICATION");
  const done = Intake.answer(asked.state, { kind: "size", size: 55 });
  assert.equal(done.state.status, "READY");
  state = Intake.markResearching(done.state);
  assert.equal(state.status, "RESEARCHING");
  assert.equal(Intake.markResult(state).status, "RESULT");
  assert.equal(Intake.markError(state).status, "ERROR");
});

test("state machine: an out-of-order event is ignored, never corrupting the flow", () => {
  const idle = Intake.initialState();
  assert.equal(Intake.markResult(idle), idle);
  assert.equal(Intake.markError(idle), idle);
  const ready = lookupOf("QN55Q80C").state;
  assert.equal(Intake.markResult(ready), ready);
  assert.equal(Intake.answer(idle, { kind: "size", size: 55 }).action, null);
});

test("state machine: the structured form can start a lookup straight from idle, and a settled state accepts a new message", () => {
  const researching = Intake.markResearching(Intake.initialState());
  assert.equal(researching.status, "RESEARCHING");
  const errored = Intake.markError(researching);
  const next = say("LG LRFCS25D3S", errored);
  assert.equal(next.action.type, "lookup");
  assert.equal(next.state.status, "READY");
  assert.equal(Intake.reset().status, "IDLE");
});

test("state machine: every transition in the table is between known statuses", () => {
  const known = Object.keys(Intake.STATUS);
  for (const [from, targets] of Object.entries(Intake.TRANSITIONS)) {
    assert.ok(known.includes(from));
    for (const target of targets) assert.ok(known.includes(target), `${from} -> ${target}`);
  }
  assert.equal(Intake.canTransition("IDLE", "RESULT"), false);
});

test("state is never mutated: states and drafts are frozen", () => {
  const asked = say("Samsung Q80C");
  assert.ok(Object.isFrozen(asked.state));
  assert.ok(Object.isFrozen(asked.state.draft));
  const before = JSON.stringify(asked.state.draft);
  Intake.answer(asked.state, { kind: "size", size: 65 });
  assert.equal(JSON.stringify(asked.state.draft), before);
});

test("pure helpers: normalize, size detection and missing fields", () => {
  assert.equal(Intake.normalizeText("  Samsung“55” \n Q80C\u0007 "), 'Samsung"55" Q80C');
  assert.equal(Intake.detectSize('55"', false), 55);
  assert.equal(Intake.detectSize("55", false), null);
  assert.equal(Intake.detectSize("55", true), 55);
  assert.equal(Intake.detectSize("200 inch", true), null);
  assert.deepEqual(Intake.detectModel("Samsung 55 inch Q80C QN55Q80C"), { full: ["QN55Q80C"], series: ["Q80C"], other: [] });
  assert.deepEqual(Intake.detectModel("55-inch 4K tv"), { full: [], series: [], other: [] });
  const draft = (extra) => Object.freeze(Object.assign({ explicit: [], candidates: [], series: [], size: null, notes: [], confirmed: false }, extra));
  assert.deepEqual(Intake.determineMissingFields(draft({})), ["category", "model"]);
  assert.deepEqual(Intake.determineMissingFields(draft({ explicit: ["refrigerator"] })), ["model"]);
  assert.deepEqual(Intake.determineMissingFields(draft({ series: ["Q80C"] })), ["size"]);
  assert.deepEqual(Intake.determineMissingFields(draft({ series: ["Q80C"], size: 55 })), []);
  assert.deepEqual(Intake.determineMissingFields(draft({ candidates: ["QN55Q80C"] })), []);
  assert.deepEqual(Intake.determineMissingFields(draft({ candidates: ["XYZ123"] })), ["category"]);
});
