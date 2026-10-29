import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ENV, VISITOR_A, answering, buildFixture, createFakeReq, engineError, engineResearch, invoke, post, used, validBody
} from "../helpers.mjs";

// OFFLINE ONLY. The engine marks canned Preview answers with meta.fixture === true. The proxy may pass that on as the one fixed
// indicator, but only on a Vercel Preview, only for the literal true, and never from anything the browser sent.
const PREVIEW_ENV = Object.freeze({ ...ENV, VERCEL_ENV: "preview" });
const marked = (extra = {}) => engineResearch({ meta: { requestId: "engine-req-1", elapsedMs: 5, cached: false, answerSource: "AI_ESTIMATE", fixture: true, ...extra } });
const hasFixtureKey = (value) => /"fixture"/.test(JSON.stringify(value));
const ask = async (env, body, request = post()) => {
  const fx = buildFixture({ env, fetchImpl: answering(200, body) });
  return { fx, res: await invoke(fx.handler, request) };
};

test("on a Preview the engine's meta.fixture === true becomes the single fixed meta.fixture indicator, and quota is still charged", async () => {
  const { fx, res } = await ask(PREVIEW_ENV, marked());
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.meta.fixture, true);
  assert.deepEqual(Object.keys(res.json.meta).sort(), ["answerSource", "cached", "elapsedMs", "fixture", "requestId"]);
  assert.equal(hasFixtureKey({ ...res.json, meta: { ...res.json.meta, fixture: undefined } }), false, "only meta.fixture may name it");
  // Not a bypass: the same limits, the same fresh-answer charge.
  assert.equal(res.json.quota.charged, true);
  assert.deepEqual(used(fx.redis, "visitor"), [1]);
  assert.equal(fx.burstLimiter.calls.length, 1);
});

test("outside a Preview (production, development, unset, odd casing) the indicator is dropped: production responses never contain it", async () => {
  for (const vercelEnv of ["production", "development", undefined, "", "Preview", "PREVIEW", " preview", "previews"]) {
    const env = { ...ENV, ...(vercelEnv === undefined ? {} : { VERCEL_ENV: vercelEnv }) };
    const { res } = await ask(env, marked());
    assert.equal(res.statusCode, 200, String(vercelEnv));
    assert.equal(hasFixtureKey(res.json), false, String(vercelEnv));
    assert.equal(res.json.status, "OK");
  }
});

test("only the literal boolean true passes on a Preview: every forged spelling is dropped", async () => {
  for (const forged of [false, "true", "TRUE", 1, "yes", "Demo research data", {}, [], [true], null, 0]) {
    const { res } = await ask(PREVIEW_ENV, marked({ fixture: forged }));
    assert.equal(res.statusCode, 200, JSON.stringify(forged));
    assert.equal(hasFixtureKey(res.json), false, JSON.stringify(forged));
  }
});

test("a fixture-looking field anywhere else in the engine body is never relayed, on a Preview or in production", async () => {
  const body = { ...marked({ fixture: undefined }), fixture: true, demo: true, original: { ...marked().original, fixture: true }, successor: { ...marked().successor, fixture: true } };
  for (const env of [PREVIEW_ENV, ENV]) {
    const { res } = await ask(env, body);
    assert.equal(res.statusCode, 200);
    assert.equal(hasFixtureKey(res.json), false);
    assert.equal(JSON.stringify(res.json).includes("demo"), false);
  }
});

test("the browser cannot influence the indicator: a body key is refused, and headers, cookies and the query string never reach the engine or the response", async () => {
  const forgedBody = await ask(PREVIEW_ENV, engineResearch(), post(validBody({ fixture: true })));
  assert.equal(forgedBody.res.statusCode, 400);
  assert.equal(forgedBody.fx.engine.calls.length, 0);

  const request = post(validBody(), { "x-fixture": "1", "x-itemassist-research-mode": "fixture", cookie: "fixture=1" });
  request.query = { fixture: "1" };
  const { fx, res } = await ask(PREVIEW_ENV, engineResearch(), request);
  assert.equal(res.statusCode, 200);
  assert.equal(hasFixtureKey(res.json), false, "the engine did not mark it, so nothing is marked");
  const [call] = fx.engine.calls;
  assert.deepEqual(JSON.parse(call.init.body), { query: "LG C3 OLED TV" });
  assert.deepEqual(Object.keys(call.init.headers).sort(), ["Accept", "Authorization", "Content-Type"]);
  assert.equal(call.url.includes("fixture"), false);
});

test("cached and guidance answers follow the same rule, and error responses never carry the indicator", async () => {
  const cached = await ask(PREVIEW_ENV, marked({ cached: true }));
  assert.equal(cached.res.json.meta.cached, true);
  assert.equal(cached.res.json.meta.fixture, true);
  const guidance = await ask(PREVIEW_ENV, marked({ answerSource: "CATEGORY_GUIDANCE", fixture: true }));
  assert.equal(guidance.res.json.meta.fixture, true);
  assert.equal(guidance.res.json.quota.charged, false);

  for (const [status, body] of [[503, { ...engineError("API_DISABLED"), fixture: true }], [200, { ...marked(), kind: "OTHER" }], [502, { fixture: true }]]) {
    const fx = buildFixture({ env: PREVIEW_ENV, fetchImpl: answering(status, body) });
    const res = await invoke(fx.handler, post());
    assert.notEqual(res.statusCode, 200);
    assert.equal(hasFixtureKey(res.json), false);
  }
  const disabled = buildFixture({ env: { ...PREVIEW_ENV, ITEMASSIST_RESEARCH_ENABLED: "false" } });
  assert.equal(hasFixtureKey((await invoke(disabled.handler, post())).json), false);
  const status = await invoke(buildFixture({ env: PREVIEW_ENV }).handler, createFakeReq({ method: "GET", headers: {} }));
  assert.deepEqual(status.json, { enabled: true, dailyLimit: 5 });
});

test("the proxy never reads a fixture variable, and the visitor ID cannot carry it; the label text is fixed in the UI, not in any response", () => {
  const proxy = readFileSync("api/itemassist-research.js", "utf8");
  assert.equal(/FIXTURE_MODE/.test(proxy), false, "the proxy has no fixture switch of its own");
  assert.equal((proxy.match(/VERCEL_ENV/g) || []).length, 1);
  const projection = readFileSync("api/_lib/itemassist-research/projection.js", "utf8");
  assert.equal(projection.includes("Demo research data"), false);
  assert.equal(projection.includes("process.env"), false);
  assert.equal(readFileSync("assets/js/rf-research.js", "utf8").includes('"Demo research data"'), true);
  assert.equal(readFileSync("assets/js/rf-research-view.js", "utf8").includes("Demo research data"), false, "the view uses the fixed constant only");
  assert.equal(VISITOR_A.includes("fixture"), false);
});
