import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  ENGINE_TOKEN, ENGINE_URL, ENV, buildHandlerFixture, createFakeFetch, createFakeRatelimit, createFakeReq, deepKeys, engineBestAvailable, engineComplete,
  engineError, engineNoResult, enginePartial, invoke, jsonResponse, validBody
} from "./helpers.mjs";

const require = createRequire(import.meta.url);
const { createHandler } = require("../../../api/replacement-finder.js");
const defaultExport = require("../../../api/replacement-finder.js");

const post = (body = validBody(), headers) => createFakeReq({ body, headers });
const fixture = (options) => buildHandlerFixture(createHandler, options);
const answering = (status, body) => createFakeFetch(() => jsonResponse(status, body));

// ---- 23 FLAG -----------------------------------------------------------------------------------------------------------

test("23: with the flag off (default) the endpoint is disabled with zero limiter and engine activity", async () => {
  for (const flag of [undefined, "", "false", "1", "TRUE", "yes"]) {
    const { handler, engine, ratelimit } = fixture({ env: { ...ENV, REPLACEMENT_FINDER_ENABLED: flag } });
    const res = await invoke(handler, post());
    assert.equal(res.statusCode, 503, String(flag));
    assert.deepEqual([res.json.status, res.json.errorCode], ["ERROR", "API_DISABLED"]);
    assert.equal(engine.calls.length, 0);
    assert.equal(ratelimit.calls.length, 0);
  }
  const res = await invoke(fixture({ env: {} }).handler, post());
  assert.equal(res.statusCode, 503);
});

test("GET reports availability only, and other methods are refused", async () => {
  const on = await invoke(fixture().handler, createFakeReq({ method: "GET" }));
  assert.deepEqual([on.statusCode, on.json], [200, { enabled: true }]);
  const off = await invoke(fixture({ env: {} }).handler, createFakeReq({ method: "GET" }));
  assert.deepEqual(off.json, { enabled: false });
  for (const method of ["PUT", "DELETE", "PATCH"]) {
    const res = await invoke(fixture().handler, createFakeReq({ method }));
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, "GET, POST");
  }
});

// ---- 24 INVALID -------------------------------------------------------------------------------------------------------

test("24: an invalid request is rejected before the limiter or engine is touched", async () => {
  const { handler, engine, ratelimit } = fixture();
  for (const body of [validBody({ model: "<script>" }), validBody({ brand: "LG" }), validBody({ notes: "x".repeat(301) }), validBody({ model: 5 }), { category: "television" }, "{bad", [], null]) {
    const res = await invoke(handler, post(body));
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.equal(res.json.errorCode, "INVALID_REQUEST");
  }
  assert.equal((await invoke(handler, post(validBody(), { "content-type": "text/plain" }))).statusCode, 415);
  assert.equal((await invoke(handler, post(JSON.stringify(validBody({ notes: "x".repeat(5000) }))))).statusCode, 413);
  assert.equal(engine.calls.length, 0);
  assert.equal(ratelimit.calls.length, 0);
});

// ---- 12 HONEYPOT ------------------------------------------------------------------------------------------------------

test("12: a filled honeypot gets a neutral reply and causes zero engine and zero limiter calls", async () => {
  const { handler, engine, ratelimit, logs } = fixture();
  const res = await invoke(handler, post(validBody({ website: "https://spam.example" })));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json, { ok: true, message: "Request received." });
  assert.equal(engine.calls.length, 0);
  assert.equal(ratelimit.calls.length, 0);
  assert.equal(JSON.stringify(res.json).toLowerCase().includes("honeypot"), false);
  assert.equal(logs.length, 0);
  // Even a request that would otherwise be invalid looks the same to a bot.
  assert.deepEqual((await invoke(handler, post({ website: "x", model: 5 }))).json, { ok: true, message: "Request received." });
});

// ---- 25 RATE LIMIT ----------------------------------------------------------------------------------------------------

test("25: an over-limit client gets 429 RATE_LIMITED and no engine call; the limiter is keyed by the first forwarded IP", async () => {
  const { handler, engine, ratelimit } = fixture({ ratelimit: createFakeRatelimit({ allow: false }) });
  const res = await invoke(handler, post());
  assert.equal(res.statusCode, 429);
  assert.deepEqual([res.json.status, res.json.errorCode], ["ERROR", "RATE_LIMITED"]);
  assert.equal(engine.calls.length, 0);
  assert.deepEqual(ratelimit.calls, ["203.0.113.7"]);
});

test("25b: limiter storage failure fails closed: 503, no engine call, and the storage error text is not exposed", async () => {
  const { handler, engine, logs } = fixture({ ratelimit: createFakeRatelimit({ fail: true }) });
  const res = await invoke(handler, post());
  assert.equal(res.statusCode, 503);
  assert.equal(res.json.errorCode, "SERVICE_UNAVAILABLE");
  assert.equal(engine.calls.length, 0);
  const text = `${res.body}\n${logs.join("\n")}`;
  assert.equal(text.includes("upstash"), false);
  assert.equal(text.includes("secret"), false);
});

// ---- 26 UNSUPPORTED ---------------------------------------------------------------------------------------------------

test("26: UNSUPPORTED comes from validation (category) and from the engine (model), and both are calm 422s", async () => {
  const category = await invoke(fixture().handler, post(validBody({ category: "dishwasher" })));
  assert.deepEqual([category.statusCode, category.json.status, category.json.errorCode], [422, "UNSUPPORTED", "UNSUPPORTED"]);

  const { handler, engine } = fixture({ fetchImpl: answering(422, engineError("UNSUPPORTED")) });
  const res = await invoke(handler, post(validBody({ model: "QN55Q60B" })));
  assert.deepEqual([res.statusCode, res.json.status, res.json.errorCode], [422, "UNSUPPORTED", "UNSUPPORTED"]);
  assert.equal(engine.calls.length, 1);
  assert.equal(res.body.includes("engine text"), false);
});

// ---- 27-29 RESULTS ----------------------------------------------------------------------------------------------------

test("27: a COMPLETE result is projected and returned, calling the engine exactly once with the token server-side", async () => {
  const { handler, engine, ratelimit } = fixture();
  const res = await invoke(handler, post(validBody({ notes: "Reusing existing wall mount" })));
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.status, "COMPLETE");
  assert.equal(res.json.primary.model, "QN55Q80D");
  assert.equal(res.json.comparison.length, 6);
  assert.equal(engine.calls.length, 1);
  assert.equal(ratelimit.calls.length, 1);
  const [{ url, init }] = engine.calls;
  assert.equal(url, `${ENGINE_URL}/api/itemassist-replacement`);
  assert.equal(init.headers.Authorization, `Bearer ${ENGINE_TOKEN}`);
  assert.deepEqual(JSON.parse(init.body), { category: "television", brand: "Samsung", model: "QN55Q80C", notes: "Reusing existing wall mount" }, "only the four engine fields, never the honeypot");
  assert.equal(res.body.includes(ENGINE_TOKEN), false);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(res.headers["x-robots-tag"], "noindex, nofollow");
  assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
});

test("27b: engine fields outside the allowlist never reach the browser", async () => {
  const leaky = { ...engineComplete(), diagnostics: { queries: ["q"] }, cacheKey: "replacement-finder:result:v1", evidenceRefs: ["ev"], SERPER_API_KEY: "abc" };
  const res = await invoke(fixture({ fetchImpl: answering(200, leaky) }).handler, post());
  for (const key of ["diagnostics", "cacheKey", "evidenceRefs", "SERPER_API_KEY"]) assert.equal(deepKeys(res.json).has(key), false, key);
  assert.equal(res.body.includes("replacement-finder:result"), false);
});

test("28: a PARTIAL result passes through whole, with its comparison and warnings intact", async () => {
  const res = await invoke(fixture({ fetchImpl: answering(200, enginePartial()) }).handler, post());
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.status, "PARTIAL");
  assert.ok(res.json.primary && res.json.comparison.length > 0);
  assert.equal(res.json.warnings[0].code, "DEADLINE_REACHED");
  assert.equal(res.json.needsVerification[0].reason, "PARTIAL_DEADLINE");
});

test("28b: a best-available primary keeps its flag, so the page can render it differently", async () => {
  const res = await invoke(fixture({ fetchImpl: answering(200, engineBestAvailable()) }).handler, post());
  assert.equal(res.json.primary.isBestAvailableOnly, true);
  assert.equal(res.json.primary.classification, "NOT_LKQ");
});

test("29: NO_RESULT is a normal 200 with no primary and no comparison", async () => {
  const res = await invoke(fixture({ fetchImpl: answering(200, engineNoResult()) }).handler, post());
  assert.equal(res.statusCode, 200);
  assert.deepEqual([res.json.status, res.json.primary, res.json.comparison], ["NO_RESULT", null, []]);
});

// ---- 30-31 FAILURES ---------------------------------------------------------------------------------------------------

test("30: an engine timeout is 504 ENGINE_TIMEOUT after exactly one attempt", async () => {
  const stalled = createFakeFetch((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))));
  const { handler, engine } = fixture({ fetchImpl: stalled, engineTimeoutMs: 40 });
  const res = await invoke(handler, post());
  assert.deepEqual([res.statusCode, res.json.errorCode], [504, "ENGINE_TIMEOUT"]);
  assert.equal(engine.calls.length, 1, "no automatic retry");
});

test("31: engine failures become fixed, user-safe errors with no raw text, stack or secrets", async () => {
  const failures = [
    [() => jsonResponse(500, "TypeError: boom\n    at /srv/app/engine.js:10 SERPER_KEY_abc"), 502, "ENGINE_ERROR"],
    [() => jsonResponse(502, engineError("ENGINE_ERROR")), 502, "ENGINE_ERROR"],
    [() => { throw new Error(`connect ECONNREFUSED 10.0.0.1 ${ENGINE_TOKEN}`); }, 502, "ENGINE_ERROR"],
    [() => jsonResponse(200, "not json at all"), 502, "ENGINE_ERROR"],
    [() => jsonResponse(200, { contractVersion: "9", status: "COMPLETE" }), 502, "ENGINE_ERROR"],
    [() => jsonResponse(429, engineError("BUDGET_EXHAUSTED")), 503, "CAPACITY_REACHED"],
    [() => jsonResponse(503, engineError("PROVIDER_UNAVAILABLE")), 503, "SERVICE_UNAVAILABLE"],
    [() => jsonResponse(401, engineError("UNAUTHORIZED")), 503, "SERVICE_UNAVAILABLE"],
    [() => jsonResponse(302, "", { location: "https://evil.example/" }), 502, "ENGINE_ERROR"]
  ];
  for (const [respond, status, code] of failures) {
    const { handler, engine, logs } = fixture({ fetchImpl: createFakeFetch(respond) });
    const res = await invoke(handler, post());
    assert.deepEqual([res.statusCode, res.json.errorCode], [status, code]);
    assert.deepEqual(Object.keys(res.json).sort(), ["contractVersion", "errorCode", "message", "requestId", "status"]);
    const text = `${res.body}\n${logs.join("\n")}`;
    for (const leak of ["TypeError", "/srv/app", "SERPER_KEY", "ECONNREFUSED", ENGINE_TOKEN, "engine text", "10.0.0.1"]) assert.equal(text.includes(leak), false, leak);
    assert.equal(engine.calls.length, 1);
  }
});

// ---- configuration, logging --------------------------------------------------------------------------------------------

test("a missing or invalid engine configuration is a 503 with no limiter spend and no engine call", async () => {
  for (const env of [{ ...ENV, ITEMASSIST_REPLACEMENT_ENGINE_URL: undefined }, { ...ENV, ITEMASSIST_REPLACEMENT_API_TOKEN: undefined }, { ...ENV, ITEMASSIST_REPLACEMENT_ENGINE_URL: "not a url" },
    { ...ENV, ITEMASSIST_REPLACEMENT_ENGINE_URL: "http://engine.example" }]) {
    const { handler, engine, ratelimit } = fixture({ env });
    const res = await invoke(handler, post());
    assert.deepEqual([res.statusCode, res.json.errorCode], [503, "SERVICE_UNAVAILABLE"]);
    assert.equal(engine.calls.length, 0);
    if (env.ITEMASSIST_REPLACEMENT_ENGINE_URL === "not a url" || env.ITEMASSIST_REPLACEMENT_ENGINE_URL?.startsWith("http:")) {
      assert.equal(ratelimit.calls.length, 1, "a bad URL is only detected at call time, after the limiter");
    } else {
      assert.equal(ratelimit.calls.length, 0, "missing configuration is caught before the limiter");
    }
  }
});

test("logging: one structured line per request with identifiers only, never notes, IPs, tokens or engine text", async () => {
  const { handler, logs } = fixture();
  await invoke(handler, post(validBody({ notes: "Private note about my living room" })));
  assert.equal(logs.length, 1);
  const entry = JSON.parse(logs[0]);
  assert.deepEqual(Object.keys(entry).sort(), ["cached", "category", "elapsedMs", "event", "httpStatus", "outcome", "requestId"]);
  for (const leak of ["Private note", "living room", "203.0.113.7", ENGINE_TOKEN, ENGINE_URL, "QN55Q80C"]) assert.equal(logs.join("\n").includes(leak), false, leak);
});

test("the default export is a ready handler: disabled when no environment is configured", async () => {
  assert.equal(typeof defaultExport, "function");
  const saved = process.env.REPLACEMENT_FINDER_ENABLED;
  delete process.env.REPLACEMENT_FINDER_ENABLED;
  try {
    const res = await invoke(defaultExport, post());
    assert.equal(res.statusCode, 503);
  } finally {
    if (saved !== undefined) process.env.REPLACEMENT_FINDER_ENABLED = saved;
  }
});
