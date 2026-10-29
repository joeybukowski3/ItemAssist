/** Offline doubles for the ItemAssist Research proxy tests. Nothing here can reach the network. */
import { createRequire } from "node:module";
import { ENGINE_TOKEN, ENGINE_URL, createFakeFetch, createFakeReq, invoke, jsonResponse } from "../replacement-finder/endpoint/helpers.mjs";

const require = createRequire(import.meta.url);
const { createHandler } = require("../../api/itemassist-research.js");

export { ENGINE_TOKEN, ENGINE_URL, createFakeFetch, createFakeReq, invoke, jsonResponse, createHandler };

export const VISITOR_A = "visitor-aaaaaaaaaaaaaaaa";
export const VISITOR_B = "visitor-bbbbbbbbbbbbbbbb";
export const QUERY = "LG C3 OLED TV";

export const ENV = Object.freeze({
  ITEMASSIST_RESEARCH_ENABLED: "true",
  ITEMASSIST_REPLACEMENT_ENGINE_URL: ENGINE_URL,
  ITEMASSIST_REPLACEMENT_API_TOKEN: ENGINE_TOKEN
});

export const validBody = (overrides = {}) => ({ query: QUERY, website: "", ...overrides });
export const post = (body = validBody(), headers = {}) => createFakeReq({ body, headers: { "x-visitor-id": VISITOR_A, ...headers } });

const DISCLOSURE = "AI estimate from general product knowledge. Specifications, model numbers, availability and pricing have not been verified and may be out of date.";

/** A research contract exactly as the engine's public response shapes it (research.1). */
export function engineResearch(overrides = {}) {
  return {
    contractVersion: "research.1",
    kind: "ITEMASSIST_RESEARCH",
    status: "OK",
    category: "tv",
    original: {
      identity: "LG C3 series 4K OLED smart TV", confidence: "HIGH",
      characteristics: ["OLED panel", "4K resolution", "120 Hz"], uncertainty: "Screen size was not given"
    },
    requirements: ["Same screen size class", "OLED or better panel", "4K resolution", "At least 4 HDMI 2.1 ports", "Similar smart TV platform"],
    requirementsSource: "AI_ESTIMATE",
    successor: {
      name: "LG C-series OLED, next generation", why: "Direct successor line with the same panel type.", differences: "Brighter panel, newer processor",
      concern: "Fewer HDMI 2.1 ports in some sizes", confidence: "HIGH", standing: "CONDITIONAL", verified: false
    },
    suggestions: [
      { name: "Samsung S90 series QD-OLED", why: "Comparable premium OLED-class picture.", differences: "Different smart platform.", confidence: "MEDIUM", verified: false },
      { name: "Sony Bravia 8 OLED", why: "Similar tier with strong processing.", differences: "Fewer gaming features on some sizes.", confidence: "MEDIUM", verified: false }
    ],
    clarify: ["Which screen size do you have?"],
    disclosure: DISCLOSURE,
    warnings: ["SUCCESSOR_CONDITIONAL"],
    meta: { requestId: "engine-req-1", elapsedMs: 900, cached: false, answerSource: "AI_ESTIMATE" },
    ...overrides
  };
}
export const engineCached = () => engineResearch({ meta: { requestId: "engine-req-2", elapsedMs: 12, cached: true, answerSource: "AI_ESTIMATE" } });
export const engineGuidance = () => engineResearch({
  status: "UNAVAILABLE", original: { identity: null, confidence: "LOW", characteristics: [], uncertainty: "This product could not be identified from the description." },
  requirementsSource: "CATEGORY_GUIDANCE", successor: null, suggestions: [], warnings: ["PROVIDER_UNAVAILABLE", "PRODUCT_NOT_IDENTIFIED", "REQUIREMENTS_FROM_CATEGORY_GUIDANCE"],
  meta: { requestId: "engine-req-3", elapsedMs: 5400, cached: false, answerSource: "CATEGORY_GUIDANCE" }
});
export const engineError = (errorCode) => ({ contractVersion: "research.1", kind: "ITEMASSIST_RESEARCH", status: "ERROR", errorCode, message: "engine text must never be shown", requestId: "engine-req-9" });

/** In-memory stand-in for Upstash: the reserve / release scripts and an `evalCalls` log. `failEval` makes every call throw. */
export function createFakeRedis({ failEval = false } = {}) {
  const store = new Map();
  const calls = [];
  return {
    store, calls,
    async eval(script, keys, args) {
      calls.push([script.includes("DECR") ? "release" : "reserve", keys[0]]);
      if (failEval) throw new Error("redis down: https://secret.upstash.example/token");
      const current = Number(store.get(keys[0]) || 0);
      if (script.includes("DECR")) { if (current <= 0) return 0; store.set(keys[0], current - 1); return current - 1; }
      if (current >= Number(args[0])) return [0, current];
      store.set(keys[0], current + 1);
      return [1, current + 1];
    }
  };
}

export function createFakeBurst({ allow = true, fail = false } = {}) {
  return {
    calls: [],
    async limit(identifier) {
      this.calls.push(identifier);
      if (fail) throw new Error("redis down: https://secret.upstash.example/token");
      return { success: allow, limit: 10, remaining: allow ? 9 : 0, reset: Date.now() + 600000 };
    }
  };
}

export function buildFixture({ env = ENV, fetchImpl, burstLimiter = createFakeBurst(), redis = createFakeRedis(), ...rest } = {}) {
  const logs = [];
  const logger = { info: (line) => logs.push(String(line)) };
  const engine = fetchImpl || createFakeFetch(() => jsonResponse(200, engineResearch()));
  const handler = createHandler({ env, fetchImpl: engine, burstLimiter, redis, logger, requestIdFactory: () => "proxy-req-1", ...rest });
  return { handler, engine, burstLimiter, redis, logs };
}

export const answering = (status, body) => createFakeFetch(() => jsonResponse(status, body));
export const used = (redis, kind = "visitor") => [...redis.store.entries()].filter(([key]) => key.includes(`:${kind}:`)).map(([, value]) => value);
