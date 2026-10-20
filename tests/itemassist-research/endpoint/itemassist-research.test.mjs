import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import {
  ENGINE_TOKEN, ENGINE_URL, ENV, QUERY, VISITOR_A, VISITOR_B, answering, buildFixture, createFakeBurst, createFakeFetch, createFakeReq, createFakeRedis, createHandler,
  engineCached, engineError, engineGuidance, engineResearch, invoke, jsonResponse, post, used, validBody
} from "../helpers.mjs";

const require = createRequire(import.meta.url);
const defaultExport = require("../../../api/itemassist-research.js");

const NEVER_FETCH = () => createFakeFetch(() => { throw new Error("the engine must not be called"); });
const freshFetch = () => createFakeFetch(() => jsonResponse(200, engineResearch()));
const idle = (fx) => assert.deepEqual([fx.engine.calls.length, fx.burstLimiter.calls.length, fx.redis.calls.length], [0, 0, 0]);
const fromIp = (n) => ({ "x-forwarded-for": `198.51.100.${n}` });

// ---- feature flag and status ---------------------------------------------------------------------------------------------

test("the endpoint is OFF by default: the shipped handler refuses, and a disabled flag does zero limiter, store and engine work", async () => {
  for (const flag of [undefined, "", "false", "1", "TRUE", "yes"]) {
    const fx = buildFixture({ env: { ...ENV, ITEMASSIST_RESEARCH_ENABLED: flag }, fetchImpl: NEVER_FETCH() });
    const res = await invoke(fx.handler, post());
    assert.equal(res.statusCode, 503, String(flag));
    assert.deepEqual([res.json.status, res.json.errorCode, res.json.kind], ["ERROR", "API_DISABLED", "ITEMASSIST_RESEARCH"]);
    idle(fx);
  }
  const shipped = await invoke(defaultExport, post());
  assert.equal(shipped.statusCode, 503);
  assert.equal(shipped.json.errorCode, "API_DISABLED");
});

test("the v1 flag does not enable research", async () => {
  const fx = buildFixture({ env: { ...ENV, ITEMASSIST_RESEARCH_ENABLED: undefined, REPLACEMENT_FINDER_ENABLED: "true" }, fetchImpl: NEVER_FETCH() });
  assert.equal((await invoke(fx.handler, post())).json.errorCode, "API_DISABLED");
  idle(fx);
});

test("GET reports availability and the daily limit from the environment only: no engine, limiter or store call", async () => {
  const on = buildFixture({ fetchImpl: NEVER_FETCH() });
  const res = await invoke(on.handler, createFakeReq({ method: "GET" }));
  assert.deepEqual([res.statusCode, res.json], [200, { enabled: true, dailyLimit: 5 }]);
  idle(on);
  const off = buildFixture({ env: {}, fetchImpl: NEVER_FETCH() });
  assert.deepEqual((await invoke(off.handler, createFakeReq({ method: "GET" }))).json, { enabled: false, dailyLimit: 5 });
  idle(off);
  for (const method of ["PUT", "DELETE", "PATCH"]) {
    const refused = await invoke(buildFixture().handler, createFakeReq({ method }));
    assert.equal(refused.statusCode, 405);
    assert.equal(refused.headers.allow, "GET, POST");
  }
  assert.equal(res.headers["cache-control"], "no-store");
});

// ---- input validation ----------------------------------------------------------------------------------------------------

test("malformed input is rejected before any limiter, store or engine activity", async () => {
  const empty = buildFixture({ fetchImpl: NEVER_FETCH() });
  assert.equal((await invoke(empty.handler, createFakeReq({ body: undefined, headers: { "x-visitor-id": VISITOR_A } }))).statusCode, 400, "no body at all");
  idle(empty);
  const bodies = [null, "", "not json", "[]", [], 42, {}, { query: "" }, { query: "   " }, { query: 42 }, { query: ["LG"] }, { query: null },
    { query: "x".repeat(161) }, { Query: QUERY }, { query: QUERY, model: "QN55Q80C" }, { query: QUERY, fixture: "ok" }, { query: QUERY, skipBudget: true }, { query: QUERY, notes: "n" }];
  for (const body of bodies) {
    const fx = buildFixture({ fetchImpl: NEVER_FETCH() });
    const res = await invoke(fx.handler, post(body));
    assert.equal(res.statusCode, 400, JSON.stringify(body)?.slice(0, 50));
    assert.deepEqual([res.json.status, res.json.errorCode], ["ERROR", "INVALID_REQUEST"]);
    idle(fx);
  }
  const fx = buildFixture({ fetchImpl: NEVER_FETCH() });
  assert.equal((await invoke(fx.handler, createFakeReq({ body: validBody(), headers: { "content-type": "text/plain" } }))).statusCode, 415);
  assert.equal((await invoke(fx.handler, post(validBody(), { "content-length": "99999" }))).statusCode, 413);
  assert.equal((await invoke(fx.handler, post({ query: QUERY, pad: "p".repeat(3000) }))).statusCode, 413);
  idle(fx);
});

test("a query of exactly 160 characters is accepted; whitespace and control characters are normalised before the engine sees it", async () => {
  const exact = "a".repeat(160);
  const fx = buildFixture();
  assert.equal((await invoke(fx.handler, post({ query: exact }))).statusCode, 200);
  assert.equal(JSON.parse(fx.engine.calls[0].init.body).query, exact);
  const messy = buildFixture();
  await invoke(messy.handler, post({ query: "  LG\u0000  C3\n\tOLED  " }));
  assert.deepEqual(JSON.parse(messy.engine.calls[0].init.body), { query: "LG C3 OLED" });
});

test("a filled honeypot gets a neutral reply and causes zero limiter, store and engine activity", async () => {
  const fx = buildFixture({ fetchImpl: NEVER_FETCH() });
  const res = await invoke(fx.handler, post(validBody({ website: "https://spam.example" })));
  assert.deepEqual([res.statusCode, res.json], [200, { ok: true, message: "Request received." }]);
  assert.deepEqual((await invoke(fx.handler, post({ website: "x", query: 5 }))).json, { ok: true, message: "Request received." });
  idle(fx);
  assert.equal(fx.logs.length, 0);
});

// ---- server-only engine authentication -----------------------------------------------------------------------------------

test("the engine call is one server-to-server POST to the research route with the bearer token and only the cleaned query", async () => {
  const fx = buildFixture();
  const res = await invoke(fx.handler, post(validBody(), { cookie: "session=secret", "x-forwarded-for": "203.0.113.7" }));
  assert.equal(res.statusCode, 200);
  assert.equal(fx.engine.calls.length, 1);
  const { url, init } = fx.engine.calls[0];
  assert.equal(url, `${ENGINE_URL}/api/itemassist-research`);
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "manual");
  assert.equal(init.headers.Authorization, `Bearer ${ENGINE_TOKEN}`);
  assert.deepEqual(JSON.parse(init.body), { query: QUERY });
  const forwarded = JSON.stringify(init.headers).toLowerCase();
  for (const leak of ["cookie", "x-visitor-id", "203.0.113.7", VISITOR_A]) assert.equal(forwarded.includes(leak.toLowerCase()), false, leak);
});

test("the token, engine URL, visitor ID and client IP never appear in a response or a log line, on success or failure", async () => {
  const outcomes = [buildFixture(), buildFixture({ fetchImpl: answering(401, engineError("UNAUTHORIZED")) }), buildFixture({ fetchImpl: answering(500, "boom") }),
    buildFixture({ burstLimiter: createFakeBurst({ fail: true }) }), buildFixture({ redis: createFakeRedis({ failEval: true }) })];
  for (const fx of outcomes) {
    const res = await invoke(fx.handler, post(validBody(), fromIp(9)));
    const everything = `${res.body}\n${fx.logs.join("\n")}`;
    for (const secret of [ENGINE_TOKEN, "engine.example.test", VISITOR_A, "198.51.100.9", "upstash", "secret.upstash", QUERY, "engine text must never"]) {
      assert.equal(everything.includes(secret), false, secret);
    }
  }
});

test("a missing token or engine URL, or an insecure engine URL, is a calm 503 and gives any reserved unit back", async () => {
  for (const env of [{ ...ENV, ITEMASSIST_REPLACEMENT_API_TOKEN: undefined }, { ...ENV, ITEMASSIST_REPLACEMENT_ENGINE_URL: undefined }]) {
    const fx = buildFixture({ env, fetchImpl: NEVER_FETCH() });
    const res = await invoke(fx.handler, post());
    assert.deepEqual([res.statusCode, res.json.errorCode], [503, "SERVICE_UNAVAILABLE"]);
    idle(fx);
  }
  for (const url of ["http://engine.example.test", "https://user:pw@engine.example.test", "not a url"]) {
    const fx = buildFixture({ env: { ...ENV, ITEMASSIST_REPLACEMENT_ENGINE_URL: url }, fetchImpl: NEVER_FETCH() });
    const res = await invoke(fx.handler, post());
    assert.deepEqual([res.statusCode, res.json.errorCode], [503, "SERVICE_UNAVAILABLE"], url);
    assert.equal(fx.engine.calls.length, 0);
    assert.deepEqual(used(fx.redis, "visitor"), [0]);
  }
});

// ---- rate limits and the five-per-day quota -------------------------------------------------------------------------------

test("a burst-limited client gets 429 RATE_LIMITED with no engine call and no quota use; the limiter is keyed by the first forwarded IP", async () => {
  const fx = buildFixture({ burstLimiter: createFakeBurst({ allow: false }), fetchImpl: NEVER_FETCH() });
  const res = await invoke(fx.handler, post(validBody(), { "x-forwarded-for": "203.0.113.7, 10.0.0.1" }));
  assert.deepEqual([res.statusCode, res.json.errorCode], [429, "RATE_LIMITED"]);
  assert.deepEqual(fx.burstLimiter.calls, ["203.0.113.7"]);
  assert.deepEqual([fx.engine.calls.length, fx.redis.calls.length], [0, 0]);
});

test("burst-limiter storage failure fails closed: 503, no engine call", async () => {
  const fx = buildFixture({ burstLimiter: createFakeBurst({ fail: true }), fetchImpl: NEVER_FETCH() });
  const res = await invoke(fx.handler, post());
  assert.deepEqual([res.statusCode, res.json.errorCode], [503, "SERVICE_UNAVAILABLE"]);
  assert.equal(fx.engine.calls.length, 0);
});

test("a visitor gets exactly 5 fresh AI answers a day: the 6th is 429 QUOTA_EXCEEDED with no engine call", async () => {
  const fx = buildFixture({ fetchImpl: freshFetch() });
  const remaining = [];
  for (let n = 1; n <= 5; n += 1) {
    const res = await invoke(fx.handler, post(validBody({ query: `LG OLED model ${n}` }), fromIp(n)));
    assert.equal(res.statusCode, 200, `request ${n}`);
    assert.equal(res.json.quota.charged, true);
    remaining.push(res.json.quota.remaining);
  }
  assert.deepEqual(remaining, [4, 3, 2, 1, 0]);
  const sixth = await invoke(fx.handler, post(validBody({ query: "LG OLED model 6" }), fromIp(6)));
  assert.deepEqual([sixth.statusCode, sixth.json.status, sixth.json.errorCode], [429, "ERROR", "QUOTA_EXCEEDED"]);
  assert.deepEqual(sixth.json.quota, { limit: 5, remaining: 0, charged: false });
  assert.equal(fx.engine.calls.length, 5);
  assert.match(sixth.json.message, /tomorrow/);
});

test("the daily window is per UTC day: a new day starts a new count", async () => {
  let clock = Date.UTC(2026, 9, 20, 23, 59, 0);
  const fx = buildFixture({ now: () => clock, fetchImpl: freshFetch(), env: { ...ENV, ITEMASSIST_RESEARCH_VISITOR_DAILY_LIMIT: "1" } });
  assert.equal((await invoke(fx.handler, post())).statusCode, 200);
  assert.equal((await invoke(fx.handler, post())).statusCode, 429);
  clock = Date.UTC(2026, 9, 21, 0, 1, 0);
  assert.equal((await invoke(fx.handler, post())).statusCode, 200);
});

test("per-IP protection is independent: rotating or forging visitor IDs from one IP cannot beat the IP limit", async () => {
  const fx = buildFixture({ fetchImpl: freshFetch(), env: { ...ENV, ITEMASSIST_RESEARCH_IP_DAILY_LIMIT: "3" } });
  for (let n = 0; n < 3; n += 1) {
    const id = `rotating-visitor-id-${String(n).padStart(4, "0")}`;
    assert.equal((await invoke(fx.handler, post(validBody(), { "x-visitor-id": id, ...fromIp(50) }))).statusCode, 200);
  }
  const fourth = await invoke(fx.handler, post(validBody(), { "x-visitor-id": "rotating-visitor-id-9999", ...fromIp(50) }));
  assert.deepEqual([fourth.statusCode, fourth.json.errorCode], [429, "RATE_LIMITED"]);
  assert.equal(fx.engine.calls.length, 3);
  assert.deepEqual(used(fx.redis, "visitor").sort(), [0, 1, 1, 1], 'the denied visitor reservation was given back');
  assert.equal((await invoke(fx.handler, post(validBody(), { "x-visitor-id": VISITOR_A, ...fromIp(51) }))).statusCode, 200, 'another IP is unaffected');
});

test("a missing or malformed visitor ID falls back to a per-IP subject, so it cannot reset or dodge the 5-a-day limit", async () => {
  for (const header of [{}, { "x-visitor-id": "short" }, { "x-visitor-id": "has spaces and !!! symbols 123456" }, { "x-visitor-id": ["a", "b"] }]) {
    const fx = buildFixture({ fetchImpl: freshFetch() });
    const send = () => invoke(fx.handler, createFakeReq({ body: validBody(), headers: { ...header, ...fromIp(60) } }));
    for (let n = 0; n < 5; n += 1) assert.equal((await send()).statusCode, 200);
    assert.equal((await send()).json.errorCode, "QUOTA_EXCEEDED", JSON.stringify(header));
  }
});

test("different visitors on different IPs have separate allowances, and Redis keys hold only salted hashes", async () => {
  const fx = buildFixture({ fetchImpl: freshFetch(), env: { ...ENV, ITEMASSIST_RESEARCH_VISITOR_DAILY_LIMIT: "1" } });
  assert.equal((await invoke(fx.handler, post(validBody(), { "x-visitor-id": VISITOR_A, ...fromIp(70) }))).statusCode, 200);
  assert.equal((await invoke(fx.handler, post(validBody(), { "x-visitor-id": VISITOR_A, ...fromIp(71) }))).statusCode, 429);
  assert.equal((await invoke(fx.handler, post(validBody(), { "x-visitor-id": VISITOR_B, ...fromIp(72) }))).statusCode, 200);
  const keys = [...fx.redis.store.keys()].join("\n");
  for (const raw of [VISITOR_A, VISITOR_B, "198.51.100"]) assert.equal(keys.includes(raw), false, raw);
});

test("concurrent requests cannot exceed the limit: 8 parallel requests, limit 5, exactly 5 engine calls", async () => {
  const fx = buildFixture({ fetchImpl: freshFetch() });
  const results = await Promise.all(Array.from({ length: 8 }, (_, n) => invoke(fx.handler, post(validBody({ query: `LG OLED model ${n}` }), fromIp(80)))));
  assert.equal(fx.engine.calls.length, 5);
  assert.equal(results.filter((res) => res.statusCode === 429).length, 3);
  assert.deepEqual(used(fx.redis, "visitor"), [5]);
});

test("quota storage failure, a missing store or an unusable answer fails closed: 503 and no engine call", async () => {
  const garbage = createFakeRedis();
  garbage.eval = async () => "OK";
  for (const redis of [createFakeRedis({ failEval: true }), null, garbage]) {
    const fx = buildFixture({ redis, fetchImpl: NEVER_FETCH() });
    const res = await invoke(fx.handler, post());
    assert.deepEqual([res.statusCode, res.json.errorCode], [503, "SERVICE_UNAVAILABLE"]);
    assert.equal(fx.engine.calls.length, 0);
  }
  const throwing = buildFixture({ redis: () => { throw new Error("cannot connect"); }, fetchImpl: NEVER_FETCH() });
  assert.equal((await invoke(throwing.handler, post())).statusCode, 503);
});

// ---- cache responses and what is charged ---------------------------------------------------------------------------------

test("a response served from the engine cache is NOT charged: the allowance is unchanged and unlimited cached reads are possible", async () => {
  const fx = buildFixture({ fetchImpl: createFakeFetch(() => jsonResponse(200, engineCached())) });
  for (let n = 0; n < 12; n += 1) {
    const res = await invoke(fx.handler, post(validBody(), fromIp(90)));
    assert.equal(res.statusCode, 200, `request ${n}`);
    assert.deepEqual([res.json.meta.cached, res.json.quota], [true, { limit: 5, remaining: 5, charged: false }]);
  }
  assert.deepEqual(used(fx.redis, "visitor"), [0]);
  assert.deepEqual(used(fx.redis, "ip"), [0]);
  assert.equal(fx.logs.every((line) => JSON.parse(line).charged === false), true);
});

test("a fresh answer is charged once; a following cached answer is not", async () => {
  let n = 0;
  const fx = buildFixture({ fetchImpl: createFakeFetch(() => jsonResponse(200, (n += 1) === 1 ? engineResearch() : engineCached())) });
  assert.deepEqual((await invoke(fx.handler, post())).json.quota, { limit: 5, remaining: 4, charged: true });
  assert.deepEqual((await invoke(fx.handler, post())).json.quota, { limit: 5, remaining: 4, charged: false });
});

test("provider-failure guidance is returned to the visitor but is NOT charged", async () => {
  const fx = buildFixture({ fetchImpl: createFakeFetch(() => jsonResponse(200, engineGuidance())) });
  const res = await invoke(fx.handler, post());
  assert.equal(res.statusCode, 200);
  assert.deepEqual([res.json.status, res.json.meta.answerSource, res.json.quota.charged, res.json.quota.remaining], ["UNAVAILABLE", "CATEGORY_GUIDANCE", false, 5]);
  assert.ok(res.json.warnings.includes("PROVIDER_UNAVAILABLE"));
  assert.deepEqual(used(fx.redis, "visitor"), [0]);
});

// ---- engine failures ------------------------------------------------------------------------------------------------------

test("engine failures map to fixed, non-sensitive responses and are never charged or retried", async () => {
  const cases = [
    [answering(429, engineError("BUDGET_EXHAUSTED")), 503, "CAPACITY_REACHED"],
    [answering(503, engineError("API_DISABLED")), 503, "SERVICE_UNAVAILABLE"],
    [answering(401, engineError("UNAUTHORIZED")), 503, "SERVICE_UNAVAILABLE"],
    [answering(503, engineError("BUDGET_UNAVAILABLE")), 503, "SERVICE_UNAVAILABLE"],
    [answering(503, engineError("PROVIDER_UNAVAILABLE")), 503, "SERVICE_UNAVAILABLE"],
    [answering(400, engineError("INVALID_REQUEST")), 502, "ENGINE_ERROR"],
    [answering(502, engineError("ENGINE_ERROR")), 502, "ENGINE_ERROR"],
    [answering(500, "<html>stack trace</html>"), 502, "ENGINE_ERROR"],
    [answering(302, ""), 502, "ENGINE_ERROR"],
    [answering(200, "not json"), 502, "ENGINE_ERROR"],
    [answering(200, { ...engineResearch(), contractVersion: "1" }), 502, "ENGINE_ERROR"],
    [answering(200, { ...engineResearch(), kind: "REPLACEMENT" }), 502, "ENGINE_ERROR"],
    [answering(200, { ...engineResearch(), status: "COMPLETE" }), 502, "ENGINE_ERROR"],
    [answering(200, engineError("BUDGET_EXHAUSTED")), 502, "ENGINE_ERROR"],
    [createFakeFetch(() => { throw new Error("socket hang up secret"); }), 502, "ENGINE_ERROR"]
  ];
  for (const [engine, status, code] of cases) {
    const fx = buildFixture({ fetchImpl: engine });
    const res = await invoke(fx.handler, post());
    assert.deepEqual([res.statusCode, res.json.status, res.json.errorCode], [status, "ERROR", code], code);
    assert.equal(fx.engine.calls.length, 1, 'never retried');
    assert.deepEqual(used(fx.redis, "visitor"), [0], 'not charged');
    assert.deepEqual(used(fx.redis, "ip"), [0]);
    assert.equal(/stack trace|socket hang|secret|engine text/.test(res.body), false);
  }
});

test("an engine timeout is a calm 504, makes one request and is not charged", async () => {
  const hang = createFakeFetch((_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))));
  const fx = buildFixture({ fetchImpl: hang, engineTimeoutMs: 40 });
  const res = await invoke(fx.handler, post());
  assert.deepEqual([res.statusCode, res.json.errorCode], [504, "ENGINE_TIMEOUT"]);
  assert.equal(hang.calls.length, 1);
  assert.deepEqual(used(fx.redis, "visitor"), [0]);
});

test("an unexpected exception is contained as a fixed 502 with no detail", async () => {
  const fx = buildFixture({ now: () => { throw new TypeError("secret internal detail"); }, fetchImpl: NEVER_FETCH() });
  const res = await invoke(fx.handler, post());
  assert.deepEqual([res.statusCode, res.json.errorCode], [502, "ENGINE_ERROR"]);
  assert.equal(`${res.body}\n${fx.logs.join("\n")}`.includes("secret"), false);
  assert.equal(fx.engine.calls.length, 0);
});

// ---- projection through the handler ---------------------------------------------------------------------------------------

const ALLOWED_KEYS = new Set(["contractVersion", "kind", "status", "category", "original", "identity", "confidence", "characteristics", "uncertainty", "requirements", "requirementsSource",
  "successor", "name", "why", "differences", "concern", "standing", "verified", "suggestions", "clarify", "disclosure", "warnings", "meta", "requestId", "elapsedMs", "cached", "answerSource",
  "quota", "limit", "remaining", "charged"]);
const deepKeys = (value, keys = new Set()) => {
  if (Array.isArray(value)) value.forEach((item) => deepKeys(item, keys));
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) { keys.add(key); deepKeys(item, keys); }
  return keys;
};

test("the response preserves identity, characteristics, requirements, successor, differences, concerns, clarification, warnings and the disclosure", async () => {
  const res = await invoke(buildFixture().handler, post());
  const body = res.json;
  assert.deepEqual([body.contractVersion, body.kind, body.status, body.category], ["research.1", "ITEMASSIST_RESEARCH", "OK", "tv"]);
  assert.deepEqual(body.original, { identity: "LG C3 series 4K OLED smart TV", confidence: "HIGH", characteristics: ["OLED panel", "4K resolution", "120 Hz"], uncertainty: "Screen size was not given" });
  assert.equal(body.requirements.length, 5);
  assert.deepEqual(body.successor, { name: "LG C-series OLED, next generation", why: "Direct successor line with the same panel type.", differences: "Brighter panel, newer processor",
    concern: "Fewer HDMI 2.1 ports in some sizes", confidence: "HIGH", standing: "CONDITIONAL", verified: false });
  assert.equal(body.suggestions.length, 2);
  assert.equal(body.suggestions[0].differences, "Different smart platform.");
  assert.deepEqual(body.clarify, ["Which screen size do you have?"]);
  assert.deepEqual(body.warnings, ["SUCCESSOR_CONDITIONAL"]);
  assert.match(body.disclosure, /AI estimate/);
  assert.match(body.disclosure, /not been verified/);
  assert.deepEqual([body.meta.requestId, body.meta.cached, body.meta.answerSource], ["proxy-req-1", false, "AI_ESTIMATE"]);
  assert.equal(res.headers["cache-control"], "no-store");
});

test("only allowlisted fields reach the browser; every candidate is forced to verified:false; lists are capped", async () => {
  const noisy = engineResearch({
    apiKey: "AIza-secret", price: "$499", sources: ["https://x.example"], internalNotes: "leak", rawText: "leak",
    original: { ...engineResearch().original, debug: "leak" },
    requirements: Array.from({ length: 12 }, (_, n) => `Requirement number ${n}`),
    clarify: ["Which screen size?", "Which color?", "Which year?"],
    warnings: ["SUCCESSOR_CONDITIONAL", "MADE_UP_CODE", "UNSAFE_CLAIMS_REMOVED"],
    successor: { ...engineResearch().successor, verified: true, sku: "ABC123", url: "https://x.example" },
    suggestions: Array.from({ length: 6 }, (_, n) => ({ name: `Model family ${n}`, why: "Similar tier", differences: "Different platform", confidence: "high", verified: true, classification: "LKQ", retailer: "Best Buy" }))
  });
  const res = await invoke(buildFixture({ fetchImpl: answering(200, noisy) }).handler, post());
  assert.equal(res.statusCode, 200);
  for (const key of deepKeys(res.json)) assert.equal(ALLOWED_KEYS.has(key), true, `unexpected key ${key}`);
  assert.equal(res.json.suggestions.length, 3);
  assert.equal(res.json.requirements.length, 6);
  assert.equal(res.json.clarify.length, 2);
  assert.deepEqual(res.json.warnings, ["SUCCESSOR_CONDITIONAL", "UNSAFE_CLAIMS_REMOVED"]);
  assert.equal([res.json.successor, ...res.json.suggestions].every((item) => item.verified === false), true);
  for (const leak of ["AIza", "x.example", "leak", "Best Buy", "499", "ABC123", "MADE_UP"]) assert.equal(res.body.includes(leak), false, leak);
});

test("claims of links, prices, availability, LKQ, equivalence or guarantees are withheld even if the engine relayed them; honest uncertainty is kept", async () => {
  const claims = engineResearch({
    original: { identity: "LG C3 OLED TV", confidence: "HIGH", characteristics: ["OLED panel", "Only $899 right now", "VERIFIED_LKQ equivalent"], uncertainty: "Specifications are not verified" },
    requirements: ["Same size class", "See https://www.lg.com/us/tvs", "Current retail availability", "Price guaranteed", "4K resolution"],
    successor: { name: "LG C5 OLED", why: "Confirmed equivalence with your TV", differences: "Priced at $1,299", concern: null, confidence: "HIGH", standing: "RECOMMENDED", verified: false },
    suggestions: [
      { name: "Sony A95L", why: "A certified like kind and quality match", differences: "Brighter", confidence: "HIGH" },
      { name: "Panasonic Z95A", why: "Strong OLED panel with a good processor", differences: "Not a verified match for your exact model", confidence: "MEDIUM" }
    ]
  });
  const res = await invoke(buildFixture({ fetchImpl: answering(200, claims) }).handler, post());
  for (const forbidden of [/\$\s?\d/, /https?:/i, /lkq/i, /like[-\s]kind/i, /equivalence/i, /retail availability/i, /guarantee/i, /priced?\b/i]) assert.equal(forbidden.test(res.body), false, String(forbidden));
  assert.equal(res.json.original.uncertainty, "Specifications are not verified");
  assert.deepEqual(res.json.suggestions.map((item) => item.name), ["Panasonic Z95A"]);
  assert.equal(res.json.suggestions[0].differences, "Not a verified match for your exact model");
  assert.equal(res.json.successor, null);
  assert.deepEqual(res.json.requirements, ["Same size class", "4K resolution"]);
});

test("a withheld concern never upgrades the successor, a withheld difference is flagged, and a withheld identification gives guidance only", async () => {
  const concern = engineResearch({ successor: { ...engineResearch().successor, concern: "Certified like kind and quality shortfall", standing: "RECOMMENDED", differences: "Verified LKQ difference" } });
  const first = (await invoke(buildFixture({ fetchImpl: answering(200, concern) }).handler, post())).json;
  assert.deepEqual([first.successor.concern, first.successor.differences, first.successor.standing], [null, null, "CONDITIONAL"]);
  assert.ok(first.warnings.includes("DIFFERENCES_MISSING"));
  const unidentified = engineResearch({ original: { identity: "Certified like kind and quality TV", confidence: "HIGH", characteristics: [], uncertainty: null } });
  const second = (await invoke(buildFixture({ fetchImpl: answering(200, unidentified) }).handler, post())).json;
  assert.deepEqual([second.status, second.successor, second.suggestions, second.original.identity], ["GUIDANCE_ONLY", null, [], null]);
  assert.ok(second.warnings.includes("PRODUCT_NOT_IDENTIFIED"));
});

// ---- isolation ------------------------------------------------------------------------------------------------------------

test("research uses only its own limiter and quota namespaces, never the v1 replacement limiter or the engine's keys", async () => {
  const fx = buildFixture({ fetchImpl: freshFetch() });
  await invoke(fx.handler, post());
  await invoke(fx.handler, post(validBody({ query: "Samsung QN55Q80C" })));
  const touched = [...fx.redis.store.keys(), ...fx.redis.calls.map(([, key]) => key)];
  assert.ok(touched.length > 0);
  for (const key of touched) assert.match(key, /^itemassist:research:quota:v1:(?:visitor|ip):\d{4}-\d{2}-\d{2}:[0-9a-f]{24}$/, key);
  const { BURST_PREFIX, QUOTA_PREFIX } = require("../../../api/_lib/itemassist-research/limits.js");
  const { RATELIMIT_PREFIX } = require("../../../api/_lib/replacement-finder/ratelimit.js");
  assert.notEqual(BURST_PREFIX, RATELIMIT_PREFIX);
  assert.equal(BURST_PREFIX.startsWith(RATELIMIT_PREFIX), false);
  assert.equal(QUOTA_PREFIX.includes("replacement-finder"), false);
});

test("the v1 replacement proxy is untouched and does not know about research; research does not modify v1 modules", () => {
  const v1Files = ["api/replacement-finder.js", ...readdirSync("api/_lib/replacement-finder").map((file) => `api/_lib/replacement-finder/${file}`)];
  for (const file of v1Files) {
    const source = readFileSync(file, "utf8");
    assert.equal(/itemassist-research|ITEMASSIST_RESEARCH/.test(source), false, file);
  }
  assert.notEqual(defaultExport, require("../../../api/replacement-finder.js"));
  const researchFiles = ["api/itemassist-research.js", ...readdirSync("api/_lib/itemassist-research").map((file) => `api/_lib/itemassist-research/${file}`)];
  for (const file of researchFiles) {
    const source = readFileSync(file, "utf8");
    assert.equal(/REPLACEMENT_FINDER_ENABLED|replacement-finder:|itemassist:ratelimit:replacement-finder/.test(source), false, file);
  }
});

// ---- review additions: client IP, held-unit recovery, and engine calls that produce no fresh answer ------------------------

const { normalizeClientIp } = require("../../../api/_lib/itemassist-research/limits.js");
const { RESEARCH_TIMEOUT_MS } = require("../../../api/_lib/itemassist-research/engine-client.js");

test("client IP: only a real IP can become a rate-limit bucket; garbage, empty and spoofed free-form values cannot mint new buckets", async () => {
  assert.equal(normalizeClientIp("203.0.113.7, 10.0.0.1"), "203.0.113.7");
  for (const bad of ["garbage", "", "1.2.3", "999.1.1.1", "203.0.113.7:8080", "<script>", undefined, null]) assert.equal(normalizeClientIp(bad), null, String(bad));
  const fx = buildFixture({ fetchImpl: freshFetch() });
  // No visitor ID, so the subject is the IP bucket. Every request carries a different junk header; none may get a fresh allowance.
  const send = (n) => invoke(fx.handler, createFakeReq({ body: validBody(), headers: { "x-forwarded-for": `junk-header-${n}` } }));
  for (let n = 0; n < 5; n += 1) assert.equal((await send(n)).statusCode, 200);
  assert.equal((await send(99)).json.errorCode, "QUOTA_EXCEEDED");
  assert.deepEqual([...new Set(fx.burstLimiter.calls)], ["unknown"]);
});

test("client IP: IPv6 is bucketed by /64 and IPv4-mapped IPv6 equals its IPv4, so rotating addresses cannot dodge a limit", async () => {
  assert.equal(normalizeClientIp("2001:db8:0:1:aaaa:bbbb:cccc:dddd"), normalizeClientIp("2001:db8:0:1::1"));
  assert.notEqual(normalizeClientIp("2001:db8:0:1::1"), normalizeClientIp("2001:db8:0:2::1"));
  assert.equal(normalizeClientIp("::ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(normalizeClientIp("0:0:0:0:0:ffff:203.0.113.7"), "203.0.113.7");
  const fx = buildFixture({ fetchImpl: freshFetch(), env: { ...ENV, ITEMASSIST_RESEARCH_IP_DAILY_LIMIT: "2" } });
  const hop = (suffix, n) => invoke(fx.handler, post(validBody(), { "x-visitor-id": `rotating-visitor-id-${String(n).padStart(4, "0")}`, "x-forwarded-for": `2001:db8:0:1::${suffix}` }));
  assert.equal((await hop("1", 1)).statusCode, 200);
  assert.equal((await hop("ffff", 2)).statusCode, 200);
  assert.equal((await hop("abcd", 3)).json.errorCode, "RATE_LIMITED");
  assert.equal(new Set(fx.burstLimiter.calls).size, 1);
});

test("client IP: the first X-Forwarded-For entry is used (Vercel overwrites the header); the socket address is only a fallback", async () => {
  const fx = buildFixture();
  await invoke(fx.handler, createFakeReq({ body: validBody(), headers: { "x-forwarded-for": "203.0.113.7, 198.51.100.1" } }));
  const fallback = buildFixture();
  const req = createFakeReq({ body: validBody(), headers: {} });
  delete req.headers["x-forwarded-for"];
  req.socket = { remoteAddress: "192.0.2.44" };
  await invoke(fallback.handler, req);
  assert.deepEqual([fx.burstLimiter.calls[0], fallback.burstLimiter.calls[0]], ["203.0.113.7", "192.0.2.44"]);
});

test("a unit held when something unexpected is thrown mid-request is given back, not left charged", async () => {
  const exploding = createFakeFetch(() => ({ status: 200, headers: { get() { throw new Error("secret transport detail"); } }, async text() { return "{}"; } }));
  const fx = buildFixture({ fetchImpl: exploding });
  const res = await invoke(fx.handler, post());
  assert.deepEqual([res.statusCode, res.json.errorCode], [502, "ENGINE_ERROR"]);
  assert.deepEqual(used(fx.redis, "visitor"), [0]);
  assert.deepEqual(used(fx.redis, "ip"), [0]);
  assert.equal(`${res.body}\n${fx.logs.join("\n")}`.includes("secret"), false);
});

test("a normal, unsettled-looking request settles exactly once: no double release even when the engine fails", async () => {
  const fx = buildFixture({ fetchImpl: answering(500, "boom") });
  await invoke(fx.handler, post());
  assert.equal(fx.redis.calls.filter(([op]) => op === "release").length, 2, "one release per counter, no more");
});

test("provider-failure guidance does not charge the visitor but DOES count against the IP, bounding engine calls that yield no fresh answer", async () => {
  const fx = buildFixture({ fetchImpl: createFakeFetch(() => jsonResponse(200, engineGuidance())), env: { ...ENV, ITEMASSIST_RESEARCH_IP_DAILY_LIMIT: "3" } });
  for (let n = 0; n < 3; n += 1) {
    const res = await invoke(fx.handler, post(validBody(), { "x-visitor-id": `failing-visitor-id-${String(n).padStart(4, "0")}`, ...fromIp(120) }));
    assert.deepEqual([res.statusCode, res.json.status, res.json.quota.charged, res.json.quota.remaining], [200, "UNAVAILABLE", false, 5]);
  }
  assert.deepEqual(used(fx.redis, "visitor"), [0, 0, 0]);
  assert.deepEqual(used(fx.redis, "ip"), [3]);
  const fourth = await invoke(fx.handler, post(validBody(), { "x-visitor-id": "failing-visitor-id-9999", ...fromIp(120) }));
  assert.deepEqual([fourth.statusCode, fourth.json.errorCode], [429, "RATE_LIMITED"]);
  assert.equal(fx.engine.calls.length, 3);
});

test("an engine timeout does not charge the visitor but the IP keeps its unit; cached answers and refused calls never touch the IP count", async () => {
  const hang = createFakeFetch((_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))));
  const slow = buildFixture({ fetchImpl: hang, engineTimeoutMs: 30 });
  assert.equal((await invoke(slow.handler, post())).statusCode, 504);
  assert.deepEqual([used(slow.redis, "visitor"), used(slow.redis, "ip")], [[0], [1]]);
  const cached = buildFixture({ fetchImpl: createFakeFetch(() => jsonResponse(200, engineCached())) });
  await invoke(cached.handler, post());
  assert.deepEqual([used(cached.redis, "visitor"), used(cached.redis, "ip")], [[0], [0]]);
  const refused = buildFixture({ fetchImpl: answering(503, engineError("BUDGET_EXHAUSTED")) });
  assert.equal((await invoke(refused.handler, post())).json.errorCode, "CAPACITY_REACHED");
  assert.deepEqual([used(refused.redis, "visitor"), used(refused.redis, "ip")], [[0], [0]]);
});

test("the engine timeout ends before a 10 s platform limit, so the proxy settles instead of being killed mid-request", () => {
  assert.ok(RESEARCH_TIMEOUT_MS <= 8000);
});

test("the Authorization header and bearer token never reach a response header, body or log line", async () => {
  const fx = buildFixture();
  const res = await invoke(fx.handler, post());
  const surface = `${res.body}\n${JSON.stringify(res.headers)}\n${fx.logs.join("\n")}`;
  assert.equal(/bearer/i.test(surface), false);
  assert.equal(surface.includes(ENGINE_TOKEN), false);
  assert.equal("authorization" in res.headers, false);
});

test("logs are structured and contain identifiers and counters only", async () => {
  const fx = buildFixture();
  await invoke(fx.handler, post());
  assert.ok(fx.logs.length > 0);
  for (const line of fx.logs) {
    const entry = JSON.parse(line);
    assert.equal(entry.event, "itemassist_research");
    assert.deepEqual(Object.keys(entry).filter((key) => /query|visitor|ip|token|body|text/i.test(key)), []);
  }
});
