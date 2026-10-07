import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { ENGINE_TOKEN, ENGINE_URL, createFakeFetch, jsonResponse, engineComplete, engineError } from "../endpoint/helpers.mjs";

const require = createRequire(import.meta.url);
const { callEngine, mapEngineFailure, resolveEngineUrl, ENGINE_PATH } = require("../../../api/lib/replacement-finder/engine-client.js");
const { checkRateLimit, RATELIMIT_PREFIX, RATELIMIT_REQUESTS, RATELIMIT_WINDOW } = require("../../../api/lib/replacement-finder/ratelimit.js");

const payload = { category: "television", brand: "Samsung", model: "QN55Q80C", notes: "" };

// ---- 9-11 RATE LIMIT --------------------------------------------------------------------------------------------------

test("9: an allowed request passes the limiter, keyed by the identifier it was given", async () => {
  const calls = [];
  const ratelimit = { limit: async (id) => { calls.push(id); return { success: true, remaining: 4 }; } };
  assert.deepEqual(await checkRateLimit("203.0.113.7", { ratelimit }), { success: true, unavailable: false });
  assert.deepEqual(calls, ["203.0.113.7"]);
});

test("10: a limited request is reported as not successful, and not as a storage failure", async () => {
  const ratelimit = { limit: async () => ({ success: false, remaining: 0 }) };
  assert.deepEqual(await checkRateLimit("203.0.113.7", { ratelimit }), { success: false, unavailable: false });
});

test("11: limiter failure fails closed: a throwing, empty or malformed limiter never grants access", async () => {
  for (const limit of [async () => { throw new Error("redis down"); }, async () => undefined, async () => null, async () => ({}), async () => ({ success: "true" })]) {
    const result = await checkRateLimit("203.0.113.7", { ratelimit: { limit } });
    assert.equal(result.success, false);
  }
  assert.equal((await checkRateLimit("x", { ratelimit: { limit: async () => { throw new Error("down"); } } })).unavailable, true);
  assert.equal((await checkRateLimit("x")).success, false, "with no Redis configured at all, access is refused");
});

test("rate limit policy is 5 requests per 10 minutes under the replacement-finder prefix", () => {
  assert.deepEqual([RATELIMIT_REQUESTS, RATELIMIT_WINDOW], [5, "10 m"]);
  assert.equal(RATELIMIT_PREFIX, "itemassist:ratelimit:replacement-finder");
});

// ---- 13-17 ENGINE CLIENT ----------------------------------------------------------------------------------------------

test("13: the engine call is POST to the fixed route with the bearer token in the Authorization header only", async () => {
  const fetchImpl = createFakeFetch(() => jsonResponse(200, engineComplete()));
  const result = await callEngine({ baseUrl: `${ENGINE_URL}/some/ignored/path?x=1`, token: ENGINE_TOKEN, payload, fetchImpl });
  assert.equal(result.kind, "response");
  const [{ url, init }] = fetchImpl.calls;
  assert.equal(url, `${ENGINE_URL}${ENGINE_PATH}`);
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "manual", "redirects are refused so the token cannot be forwarded elsewhere");
  assert.equal(init.headers.Authorization, `Bearer ${ENGINE_TOKEN}`);
  assert.deepEqual(JSON.parse(init.body), payload);
  assert.equal(url.includes(ENGINE_TOKEN) || init.body.includes(ENGINE_TOKEN), false, "the token is in the header and nowhere else");
});

test("14: the token is never part of any value the client resolves with", async () => {
  for (const respond of [() => jsonResponse(200, engineComplete()), () => jsonResponse(500, { errorCode: "ENGINE_ERROR" }), () => jsonResponse(200, "not json"), () => { throw new Error(`boom ${ENGINE_TOKEN}`); }]) {
    const result = await callEngine({ baseUrl: ENGINE_URL, token: ENGINE_TOKEN, payload, fetchImpl: createFakeFetch(respond) });
    assert.equal(JSON.stringify(result).includes(ENGINE_TOKEN), false);
  }
});

test("15: a timeout aborts the request and is reported as a timeout, not a crash", async () => {
  const fetchImpl = createFakeFetch((_url, init) => new Promise((_resolve, reject) => { init.signal.addEventListener("abort", () => reject(new Error("aborted"))); }));
  const started = Date.now();
  const result = await callEngine({ baseUrl: ENGINE_URL, token: ENGINE_TOKEN, payload, fetchImpl, timeoutMs: 40 });
  assert.equal(result.kind, "timeout");
  assert.ok(Date.now() - started < 1500);
  assert.deepEqual(mapEngineFailure(result), { code: "ENGINE_TIMEOUT", status: 504 });
  assert.equal(fetchImpl.calls.length, 1);

  const stalledBody = createFakeFetch((_url, init) => ({ status: 200, headers: { get: () => null }, text: () => new Promise((_r, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))) }));
  assert.equal((await callEngine({ baseUrl: ENGINE_URL, token: ENGINE_TOKEN, payload, fetchImpl: stalledBody, timeoutMs: 40 })).kind, "timeout", "a stalled body read is also bounded");
});

test("16: engine failures map to the fixed proxy vocabulary and never expose engine text", () => {
  const cases = [
    [{ kind: "response", status: 422, body: engineError("UNSUPPORTED") }, "UNSUPPORTED", 422],
    [{ kind: "response", status: 429, body: engineError("BUDGET_EXHAUSTED") }, "CAPACITY_REACHED", 503],
    [{ kind: "response", status: 503, body: engineError("API_DISABLED") }, "SERVICE_UNAVAILABLE", 503],
    [{ kind: "response", status: 401, body: engineError("UNAUTHORIZED") }, "SERVICE_UNAVAILABLE", 503],
    [{ kind: "response", status: 503, body: engineError("PROVIDER_UNAVAILABLE") }, "SERVICE_UNAVAILABLE", 503],
    [{ kind: "response", status: 503, body: engineError("BUDGET_UNAVAILABLE") }, "SERVICE_UNAVAILABLE", 503],
    [{ kind: "response", status: 504, body: engineError("ENGINE_TIMEOUT") }, "ENGINE_TIMEOUT", 504],
    [{ kind: "response", status: 502, body: engineError("ENGINE_ERROR") }, "ENGINE_ERROR", 502],
    [{ kind: "response", status: 400, body: engineError("INVALID_REQUEST") }, "ENGINE_ERROR", 502],
    [{ kind: "response", status: 500, body: { errorCode: "SOMETHING_NEW" } }, "ENGINE_ERROR", 502],
    [{ kind: "response", status: 500, body: "stack trace at /srv/app.js" }, "ENGINE_ERROR", 502],
    [{ kind: "response", status: 500, body: { errorCode: "constructor" } }, "ENGINE_ERROR", 502],
    [{ kind: "network" }, "ENGINE_ERROR", 502],
    [{ kind: "bad_response" }, "ENGINE_ERROR", 502],
    [{ kind: "misconfigured" }, "SERVICE_UNAVAILABLE", 503]
  ];
  for (const [result, code, status] of cases) assert.deepEqual(mapEngineFailure(result), { code, status }, JSON.stringify(result));
});

test("17: there are no automatic retries, whatever the failure", async () => {
  for (const respond of [() => jsonResponse(503, engineError("PROVIDER_UNAVAILABLE")), () => jsonResponse(500, "oops"), () => { throw new Error("network"); }, () => jsonResponse(302, "", { location: "https://elsewhere.example/" })]) {
    const fetchImpl = createFakeFetch(respond);
    await callEngine({ baseUrl: ENGINE_URL, token: ENGINE_TOKEN, payload, fetchImpl });
    assert.equal(fetchImpl.calls.length, 1);
  }
});

test("engine client: redirects, oversized and non-JSON bodies are bad responses; bad configuration makes no call", async () => {
  const redirect = createFakeFetch(() => jsonResponse(302, "", { location: "https://evil.example/" }));
  assert.equal((await callEngine({ baseUrl: ENGINE_URL, token: ENGINE_TOKEN, payload, fetchImpl: redirect })).kind, "bad_response");
  const huge = createFakeFetch(() => jsonResponse(200, "x".repeat(300000)));
  assert.equal((await callEngine({ baseUrl: ENGINE_URL, token: ENGINE_TOKEN, payload, fetchImpl: huge })).kind, "bad_response");
  const declared = createFakeFetch(() => jsonResponse(200, engineComplete(), { "content-length": "999999" }));
  assert.equal((await callEngine({ baseUrl: ENGINE_URL, token: ENGINE_TOKEN, payload, fetchImpl: declared })).kind, "bad_response");

  for (const [baseUrl, token] of [["", ENGINE_TOKEN], ["not a url", ENGINE_TOKEN], ["ftp://engine.example", ENGINE_TOKEN], ["http://engine.example", ENGINE_TOKEN],
    ["https://user:pw@engine.example", ENGINE_TOKEN], [ENGINE_URL, ""], [ENGINE_URL, "   "], [ENGINE_URL, undefined]]) {
    const fetchImpl = createFakeFetch(() => jsonResponse(200, engineComplete()));
    assert.equal((await callEngine({ baseUrl, token, payload, fetchImpl })).kind, "misconfigured", `${baseUrl} / ${token}`);
    assert.equal(fetchImpl.calls.length, 0);
  }
  assert.equal(resolveEngineUrl("http://localhost:3000").href, "http://localhost:3000/api/itemassist-replacement", "plain http is allowed for local development only");
});
