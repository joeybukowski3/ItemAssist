import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const RF = require("../../../assets/js/rf-shared.js");
const { readBody, isHoneypotFilled, validateRequest } = require("../../../api/_lib/replacement-finder/validation.js");

const valid = (overrides = {}) => ({ category: "television", brand: "Samsung", model: "QN55Q80C", notes: "", website: "", ...overrides });
const req = (body, headers = {}) => ({ headers: { "content-type": "application/json", ...headers }, body });

// ---- 1-8 VALIDATION -------------------------------------------------------------------------------------------------

test("1: a valid Samsung television request is accepted and normalized", () => {
  const result = validateRequest(valid({ model: " qn55q80c ", notes: "  Reusing   existing wall mount " }));
  assert.deepEqual(result, { ok: true, value: { category: "television", brand: "Samsung", model: "QN55Q80C", notes: "Reusing existing wall mount" } });
  assert.deepEqual(Object.keys(result.value).sort(), ["brand", "category", "model", "notes"], "the honeypot never leaves validation");
});

test("2: a valid LG refrigerator request is accepted, brand matched case-insensitively", () => {
  const result = validateRequest(valid({ category: "refrigerator", brand: "lg", model: "LRFCS25D3S" }));
  assert.deepEqual(result.value, { category: "refrigerator", brand: "LG", model: "LRFCS25D3S", notes: "" });
});

test("3: an unsupported category is UNSUPPORTED (422); a missing or blank one is INVALID_REQUEST", () => {
  for (const category of ["dishwasher", "washer", "TV", "Television", "__proto__"]) {
    const result = validateRequest(valid({ category }));
    assert.deepEqual([result.ok, result.status, result.code], [false, 422, "UNSUPPORTED"], category);
  }
  assert.deepEqual([validateRequest(valid({ category: "" })).status, validateRequest(valid({ category: "  " })).code], [400, "INVALID_REQUEST"]);
});

test("4: a brand that does not belong to the category is rejected", () => {
  for (const body of [valid({ brand: "LG" }), valid({ category: "refrigerator", brand: "Samsung" }), valid({ brand: "Sony" }), valid({ brand: "" })]) {
    const result = validateRequest(body);
    assert.deepEqual([result.ok, result.status, result.code], [false, 400, "INVALID_REQUEST"], JSON.stringify(body));
  }
});

test("5: malformed model numbers are rejected", () => {
  for (const model of ["", "  ", "QN", "<script>alert(1)</script>", "QN55Q80C; DROP TABLE", "../../etc/passwd", "${jndi:x}", "-QN55", "Q".repeat(41), "QN55Q80Cé"]) {
    const result = validateRequest(valid({ model }));
    assert.equal(result.ok, false, JSON.stringify(model));
    assert.equal(result.code, "INVALID_REQUEST");
  }
  assert.equal(validateRequest(valid({ model: "Q".repeat(40) })).ok, true, "40 characters is the limit");
});

test("6: notes longer than 300 characters are rejected; 300 is accepted", () => {
  assert.equal(validateRequest(valid({ notes: "n".repeat(301) })).ok, false);
  assert.equal(validateRequest(valid({ notes: "n".repeat(300) })).ok, true);
});

test("7: non-string values, unknown keys and non-objects are rejected", () => {
  const bad = [valid({ category: 1 }), valid({ brand: null }), valid({ model: ["QN55Q80C"] }), valid({ notes: 5 }), valid({ notes: { a: 1 } }), valid({ website: 7 }),
    { ...valid(), extra: "x" }, { ...valid(), isAdmin: true }, { category: "television" }, "text", 42, null, []];
  for (const body of bad) assert.equal(validateRequest(body).ok, false, JSON.stringify(body));
});

test("8: bodies must be JSON, plain objects, and under the size cap", () => {
  assert.equal(readBody(req(valid())).ok, true);
  assert.equal(readBody(req(JSON.stringify(valid()))).ok, true, "a raw JSON string body is parsed");
  assert.equal(readBody(req(Buffer.from(JSON.stringify(valid())))).ok, true);
  for (const body of ["{not json", "", "null", "[]", '"x"', "42", undefined, null, [], 5, Buffer.from("{bad")]) {
    const result = readBody(req(body));
    assert.deepEqual([result.ok, result.status], [false, 400], String(body));
  }
  assert.deepEqual([readBody(req(valid(), { "content-type": "text/plain" })).status, readBody({ headers: {}, body: valid() }).status], [415, 415]);
  assert.equal(readBody(req(JSON.stringify(valid({ notes: "x".repeat(RF.MAX_BODY_BYTES) })))).status, 413);
  assert.equal(readBody(req(valid({ notes: "x".repeat(RF.MAX_BODY_BYTES) }))).status, 413);
  assert.equal(readBody(req(valid(), { "content-length": String(RF.MAX_BODY_BYTES + 1) })).status, 413);
  const throwing = { headers: { "content-type": "application/json" }, get body() { throw new Error("Invalid JSON"); } };
  assert.equal(readBody(throwing).status, 400, "a throwing body getter is handled");
  assert.equal(readBody(req(Object.create({ inherited: 1 }))).ok, false);
  assert.equal(readBody(req(JSON.parse('{"category":"television","__proto__":{"x":1}}'))).ok, true, "own __proto__ key parses, then fails the key allowlist");
  assert.equal(validateRequest(JSON.parse('{"category":"television","brand":"Samsung","model":"QN55Q80C","__proto__":{"x":1}}')).ok, false);
});

test("honeypot detection only fires for a non-blank string", () => {
  assert.equal(isHoneypotFilled({ website: "http://spam.example" }), true);
  for (const website of ["", "   ", undefined, null, 0, false, []]) assert.equal(isHoneypotFilled({ website }), false);
});

// ---- shared presentation helpers --------------------------------------------------------------------------------------

test("shared: match summary counts come only from the contract rows", () => {
  const rows = [
    { importance: "REQUIRED", assessment: { code: "MATCH" } }, { importance: "REQUIRED", assessment: { code: "EXCEEDS" } }, { importance: "REQUIRED", assessment: { code: "VERIFY" } },
    { importance: "IMPORTANT", assessment: { code: "MATCH" } }, { importance: "IMPORTANT", assessment: { code: "DIFFERS" } }, { importance: "IMPORTANT", assessment: { code: "ASSUMED" } },
    { importance: "ADDITIONAL", assessment: { code: "FAIL" } }
  ];
  const summary = RF.summarizeComparison(rows, [{}, {}]);
  assert.deepEqual(summary.groups.map((g) => [g.label, g.met, g.total, g.unverified, g.unmet]), [["Required", 2, 3, 1, 0], ["Important", 1, 3, 1, 1], ["Additional", 0, 1, 0, 1]]);
  assert.equal(summary.needsVerificationCount, 2);
  assert.equal("percent" in summary || "score" in summary, false, "no fake overall percentage");
  assert.deepEqual(RF.summarizeComparison(undefined, undefined).groups.map((g) => g.total), [0, 0, 0]);
});

test("shared: source URLs must be https without credentials or port", () => {
  assert.equal(RF.isSafeSourceUrl("https://www.samsung.com/us/tvs/q80c/"), true);
  for (const url of ["http://samsung.com/x", "javascript:alert(1)", "https://u:p@samsung.com/", "https://samsung.com:8443/", "//samsung.com", "", null, 5, `https://samsung.com/${"a".repeat(300)}`]) {
    assert.equal(RF.isSafeSourceUrl(url), false, String(url));
  }
});

test("shared: error codes map to fixed user-safe text and unknown codes never echo raw input", () => {
  for (const code of Object.keys(RF.ERROR_MESSAGES)) assert.ok(RF.errorMessage(code).length > 10);
  assert.equal(RF.errorMessage("<img src=x onerror=alert(1)>"), RF.ERROR_MESSAGES.ENGINE_ERROR);
  assert.equal(RF.errorMessage("constructor"), RF.ERROR_MESSAGES.ENGINE_ERROR);
  assert.equal(RF.errorMessage(undefined), RF.ERROR_MESSAGES.ENGINE_ERROR);
  assert.equal(RF.FACT_STATUS_LABELS.PROVIDED, "Provided by you");
  assert.deepEqual(Object.values(RF.CLASSIFICATION_LABELS), ["Like-Kind & Quality", "Above LKQ", "Close Match", "Not LKQ", "Unconfirmed"]);
});
