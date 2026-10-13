/** Offline doubles for the Replacement Finder proxy tests. Nothing here can reach the network. */

export const ENGINE_URL = "https://engine.example.test";
export const ENGINE_TOKEN = "engine-token-0123456789-abcdefghijklmnop";

export const ENV = Object.freeze({
  REPLACEMENT_FINDER_ENABLED: "true",
  ITEMASSIST_REPLACEMENT_ENGINE_URL: ENGINE_URL,
  ITEMASSIST_REPLACEMENT_API_TOKEN: ENGINE_TOKEN
});

export function createFakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    send(payload) { this.body = payload; return this; },
    get json() { return this.body === undefined ? undefined : JSON.parse(this.body); }
  };
}

export function createFakeReq({ method = "POST", body, headers = {} } = {}) {
  return { method, body, headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7, 10.0.0.1", ...headers } };
}

export const validBody = (overrides = {}) => ({ category: "television", brand: "Samsung", model: "QN55Q80C", notes: "", website: "", ...overrides });

export function createFakeRatelimit({ allow = true, fail = false } = {}) {
  return {
    calls: [],
    async limit(identifier) {
      this.calls.push(identifier);
      if (fail) throw new Error("redis down: https://secret.upstash.example/token");
      return { success: allow, limit: 5, remaining: allow ? 4 : 0, reset: Date.now() + 600000 };
    }
  };
}

/** A fetch double that records every call and answers with `respond(url, init)`. */
export function createFakeFetch(respond) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return respond(url, init, calls.length);
  };
  fn.calls = calls;
  return fn;
}

export const jsonResponse = (status, body, headers = {}) => ({
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  async text() { return typeof body === "string" ? body : JSON.stringify(body); }
});

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const contracts = require("../fixtures/contracts.js");
export const { engineComplete, enginePartial, engineBestAvailable, engineBestAvailableUnconfirmed, engineNoRetailReplacement, engineNoResult, engineError, retail } = contracts;

export function buildHandlerFixture(createHandler, { env = ENV, fetchImpl, ratelimit = createFakeRatelimit(), ...rest } = {}) {
  const logs = [];
  const logger = { info: (line) => logs.push(String(line)) };
  const engine = fetchImpl || createFakeFetch(() => jsonResponse(200, engineComplete()));
  const handler = createHandler({ env, fetchImpl: engine, ratelimit, logger, requestIdFactory: () => "proxy-req-1", ...rest });
  return { handler, engine, ratelimit, logs };
}

export async function invoke(handler, request) {
  const res = createFakeRes();
  await handler(request, res);
  return res;
}

export const deepKeys = (value, keys = new Set()) => {
  if (Array.isArray(value)) value.forEach((item) => deepKeys(item, keys));
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) { keys.add(key); deepKeys(item, keys); }
  return keys;
};
