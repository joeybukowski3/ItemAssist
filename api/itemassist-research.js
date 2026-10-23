const crypto = require("crypto");

const { readBody, isHoneypotFilled, validateResearchRequest } = require("./_lib/itemassist-research/validation");
const { createResearchQuota, checkBurst, normalizeClientIp, SETTLE, VISITOR_ID_PATTERN, quotaConfig } = require("./_lib/itemassist-research/limits");
const { callResearchEngine, mapResearchFailure, RESEARCH_TIMEOUT_MS } = require("./_lib/itemassist-research/engine-client");
const { projectResearch, projectError } = require("./_lib/itemassist-research/projection");

/*
 * Same-origin proxy for ItemAssist Research. The browser only ever calls this route; the engine URL and bearer token stay on
 * the server. Separate from the v1 replacement proxy: its own flag, rate-limit and quota namespaces, and its own engine route.
 *
 * GET  -> { enabled, dailyLimit }: environment only. No Redis, no engine call, no quota.
 * POST -> { query } (+ the shared honeypot). Order of checks: method, feature flag, JSON body, honeypot, validation, engine
 *   configuration, per-IP burst limit (fails closed), per-visitor and per-IP fresh-answer reservation (fails closed), one
 *   engine call (never retried), allowlist projection, then the charge: only a fresh AI answer keeps its reserved unit.
 *
 * Statuses: 400/413/415 INVALID_REQUEST, 429 RATE_LIMITED (burst or per-IP day) / QUOTA_EXCEEDED (visitor day),
 * 503 API_DISABLED / SERVICE_UNAVAILABLE / CAPACITY_REACHED, 504 ENGINE_TIMEOUT, 502 ENGINE_ERROR.
 */

const VISITOR_HEADER = "x-visitor-id";
// A fresh answer is real AI research that was neither served from the engine cache nor a provider-failure fallback.
const CHARGEABLE_STATUSES = Object.freeze(["OK", "PARTIAL", "GUIDANCE_ONLY"]);

function send(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.send(JSON.stringify(payload));
}

/**
 * The rate-limit subject for the caller. Vercel documents that it overwrites X-Forwarded-For with the client's public IP and does
 * not forward external values (to prevent spoofing), so the first entry is the platform's own observation when deployed there. It
 * is still only accepted if it is a real IP (never a free-form string a client could vary), IPv6 is bucketed by /64, and the
 * socket address is the fallback. Anything else shares one "unknown" bucket, which can only over-limit, never under-limit.
 */
function clientIp(req) {
  const forwarded = req.headers && req.headers["x-forwarded-for"];
  return normalizeClientIp(Array.isArray(forwarded) ? forwarded[0] : forwarded) || normalizeClientIp(req.socket && req.socket.remoteAddress) || "unknown";
}

function headerValue(req, name) {
  const value = req.headers && req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function defaultRedis() {
  const { getRedisClient } = require("./_lib/age-verification/redis-client");
  return getRedisClient();
}

/**
 * @param {object} [overrides] everything external is injectable so tests never touch the network
 * @param {object} [overrides.env] defaults to process.env, read at request time
 * @param {Function} [overrides.fetchImpl] engine transport
 * @param {{limit: Function}} [overrides.burstLimiter] per-IP burst limiter
 * @param {{eval: Function}|null} [overrides.redis] quota store (a function returning one is also accepted)
 * @param {number} [overrides.engineTimeoutMs]
 * @param {{info: Function}} [overrides.logger]
 * @param {() => string} [overrides.requestIdFactory]
 */
function createHandler(overrides = {}) {
  const logger = overrides.logger || console;
  const makeRequestId = overrides.requestIdFactory || (() => crypto.randomUUID());
  const timeoutMs = overrides.engineTimeoutMs || RESEARCH_TIMEOUT_MS;
  const now = overrides.now || Date.now;

  // Identifiers and counters only: never the query, the visitor ID, IP addresses, the token or engine text.
  const log = (fields) => {
    try {
      logger.info(JSON.stringify({ event: "itemassist_research", ...fields }));
    } catch (error) { /* logging must never affect a reply */ }
  };

  /** A store that cannot be created is the same as no store: the limits refuse (fail closed). */
  function openStore() {
    try {
      const candidate = overrides.redis === undefined ? defaultRedis : overrides.redis;
      return (typeof candidate === "function" ? candidate() : candidate) || null;
    } catch (error) {
      return null;
    }
  }

  async function handle(req, res, requestId, env, held) {
    const startedAt = now();
    const fail = (status, code, fields = {}, quota) => {
      log({ requestId, outcome: code, httpStatus: status, elapsedMs: now() - startedAt, ...fields });
      return send(res, status, projectError(code, requestId, quota));
    };
    const enabled = env.ITEMASSIST_RESEARCH_ENABLED === "true";

    if (req.method === "GET") return send(res, 200, { enabled, dailyLimit: quotaConfig(env).visitorDailyLimit });
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return fail(405, "INVALID_REQUEST");
    }
    if (!enabled) return fail(503, "API_DISABLED");

    const body = readBody(req);
    if (!body.ok) return fail(body.status, body.code);

    // A filled honeypot gets the same neutral reply the other ItemAssist forms give, and never reaches a limiter or the engine.
    if (isHoneypotFilled(body.value)) return send(res, 200, { ok: true, message: "Request received." });

    const request = validateResearchRequest(body.value);
    if (!request.ok) return fail(request.status, request.code);

    const baseUrl = env.ITEMASSIST_REPLACEMENT_ENGINE_URL;
    const token = env.ITEMASSIST_REPLACEMENT_API_TOKEN;
    if (!baseUrl || !token) return fail(503, "SERVICE_UNAVAILABLE", { reason: "engine_not_configured" });

    const ip = clientIp(req);
    const burst = await checkBurst(ip, { ratelimit: overrides.burstLimiter });
    if (burst.unavailable) return fail(503, "SERVICE_UNAVAILABLE", { reason: "rate_limit_unavailable" });
    if (!burst.success) return fail(429, "RATE_LIMITED", { reason: "burst" });

    const quota = createResearchQuota({ redis: openStore(), env, now });
    const visitorId = headerValue(req, VISITOR_HEADER);
    const granted = await quota.reserve({ visitorId: typeof visitorId === "string" && VISITOR_ID_PATTERN.test(visitorId) ? visitorId : null, ip });
    if (!granted.ok) {
      if (granted.reason === "unavailable") return fail(503, "SERVICE_UNAVAILABLE", { reason: "quota_unavailable" });
      return granted.reason === "quota"
        ? fail(429, "QUOTA_EXCEEDED", { reason: "visitor_daily" }, { limit: granted.limit, remaining: 0, charged: false })
        : fail(429, "RATE_LIMITED", { reason: "ip_daily" });
    }

    // From here until settlement a unit is held; `held` lets the outer handler give it back if anything unexpected is thrown.
    held.settle = (mode) => { held.settle = null; return quota.settle(granted, mode); };
    const result = await callResearchEngine({ baseUrl, token, query: request.value.query, timeoutMs, fetchImpl: overrides.fetchImpl });
    const succeeded = result.kind === "response" && result.status === 200;
    // The projection needs the quota block, which depends on the charge decision, which depends on the projection:
    // project once with a placeholder, decide, then fill in the real block.
    let projected = null;
    try {
      projected = succeeded ? projectResearch(result.body, { requestId, elapsedMs: now() - startedAt, quota: null, allowFixture: env.VERCEL_ENV === "preview", allowLive: env.ITEMASSIST_RESEARCH_LIVE_CONTRACT === "research.2" }) : null;
    } catch (error) { /* an unprojectable body is a failed call: the visitor is not charged */ }
    if (!projected) {
      // A timeout may still have cost a provider call, so the IP keeps its unit; every other failure gives both back.
      await held.settle(result.kind === "timeout" ? SETTLE.IP_ONLY : SETTLE.NONE);
      const failure = mapResearchFailure(succeeded ? { kind: "bad_response" } : result);
      return fail(failure.status, failure.code, { reason: `engine_${result.kind}`, charged: false });
    }

    // Only a fresh AI answer is charged to the visitor. A fallback to category guidance means the engine DID call the provider and
    // it failed: the visitor is not charged, but the IP is, so provider-failure traffic cannot bypass the per-IP bound.
    const { cached, answerSource } = projected.meta;
    const mode = cached ? SETTLE.NONE
      : answerSource === "AI_ESTIMATE" && CHARGEABLE_STATUSES.includes(projected.status) ? SETTLE.FRESH
        : SETTLE.IP_ONLY;
    const usage = await held.settle(mode);
    const response = { ...projected, quota: usage };
    log({ requestId, outcome: response.status, httpStatus: 200, elapsedMs: now() - startedAt, cached, charged: usage.charged, unitsKept: mode === SETTLE.FRESH ? 2 : mode === SETTLE.IP_ONLY ? 1 : 0, answerSource });
    return send(res, 200, response);
  }

  /** Last line of defence: nothing unexpected escapes as a stack trace or a hung request, and a held unit is given back. */
  return async function handler(req, res) {
    const env = overrides.env || process.env;
    const requestId = makeRequestId();
    const held = { settle: null };
    try {
      return await handle(req, res, requestId, env, held);
    } catch (error) {
      if (held.settle) { try { await held.settle(SETTLE.NONE); } catch (settleError) { /* best effort */ } }
      log({ requestId, outcome: "ENGINE_ERROR", httpStatus: 502, reason: "unexpected_exception" });
      return send(res, 502, projectError("ENGINE_ERROR", requestId));
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
