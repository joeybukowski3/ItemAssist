const crypto = require("crypto");

const { readBody, isHoneypotFilled, validateRequest } = require("./lib/replacement-finder/validation");
const { checkRateLimit } = require("./lib/replacement-finder/ratelimit");
const { callEngine, mapEngineFailure, DEFAULT_TIMEOUT_MS } = require("./lib/replacement-finder/engine-client");
const { projectResult, projectError } = require("./lib/replacement-finder/projection");

/*
 * Same-origin proxy for the Replacement Finder proof of concept. The browser only ever calls this route; the engine
 * bearer token and engine URL stay on the server.
 *
 * Order of checks: method, feature flag, JSON body, honeypot, validation, engine configuration, per-IP rate limit
 * (fails closed), engine call (one attempt, never retried), allowlist projection.
 *
 * Statuses: 400/413/415 INVALID_REQUEST, 422 UNSUPPORTED, 429 RATE_LIMITED (over the limit), 503 SERVICE_UNAVAILABLE
 * (flag off, engine not configured, limiter store unavailable, engine refusing), 503 CAPACITY_REACHED, 504 ENGINE_TIMEOUT,
 * 502 ENGINE_ERROR.
 */

function send(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.send(JSON.stringify(payload));
}

function clientIp(req) {
  const forwarded = req.headers && req.headers["x-forwarded-for"];
  const raw = forwarded || (req.socket && req.socket.remoteAddress) || "unknown";
  return String(raw).split(",")[0].trim() || "unknown";
}

/**
 * @param {object} [overrides] everything external is injectable so tests never touch the network
 * @param {object} [overrides.env] defaults to process.env, read at request time
 * @param {Function} [overrides.fetchImpl] engine transport
 * @param {{limit: Function}} [overrides.ratelimit]
 * @param {number} [overrides.engineTimeoutMs]
 * @param {{info: Function}} [overrides.logger]
 * @param {() => string} [overrides.requestIdFactory]
 */
function createHandler(overrides = {}) {
  const logger = overrides.logger || console;
  const makeRequestId = overrides.requestIdFactory || (() => crypto.randomUUID());
  const timeoutMs = overrides.engineTimeoutMs || DEFAULT_TIMEOUT_MS;
  const now = overrides.now || Date.now;

  // Identifiers and counters only: never notes, headers, IP addresses, the token or engine text.
  const log = (fields) => {
    try {
      logger.info(JSON.stringify({ event: "replacement_finder", ...fields }));
    } catch (error) { /* logging must never affect a reply */ }
  };

  return async function handler(req, res) {
    const env = overrides.env || process.env;
    const startedAt = now();
    const requestId = makeRequestId();
    const enabled = env.REPLACEMENT_FINDER_ENABLED === "true";
    const fail = (status, code, fields = {}) => {
      log({ requestId, outcome: code, httpStatus: status, elapsedMs: now() - startedAt, ...fields });
      return send(res, status, projectError(code, requestId));
    };

    if (req.method === "GET") return send(res, 200, { enabled });
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return fail(405, "INVALID_REQUEST");
    }
    if (!enabled) return fail(503, "API_DISABLED");

    const body = readBody(req);
    if (!body.ok) return fail(body.status, body.code);

    // A filled honeypot gets the same neutral reply the other ItemAssist forms give, and never reaches the engine.
    if (isHoneypotFilled(body.value)) return send(res, 200, { ok: true, message: "Request received." });

    const request = validateRequest(body.value);
    if (!request.ok) return fail(request.status, request.code);

    const baseUrl = env.ITEMASSIST_REPLACEMENT_ENGINE_URL;
    const token = env.ITEMASSIST_REPLACEMENT_API_TOKEN;
    const base = { category: request.value.category };
    if (!baseUrl || !token) return fail(503, "SERVICE_UNAVAILABLE", { ...base, reason: "engine_not_configured" });

    const limit = await checkRateLimit(clientIp(req), { ratelimit: overrides.ratelimit });
    if (limit.unavailable) return fail(503, "SERVICE_UNAVAILABLE", { ...base, reason: "rate_limit_unavailable" });
    if (!limit.success) return fail(429, "RATE_LIMITED", base);

    const result = await callEngine({ baseUrl, token, payload: request.value, timeoutMs, fetchImpl: overrides.fetchImpl });
    const succeeded = result.kind === "response" && result.status === 200;
    const projected = succeeded ? projectResult(result.body) : null;
    if (!projected) {
      const failure = mapEngineFailure(succeeded ? { kind: "bad_response" } : result);
      return fail(failure.status, failure.code, { ...base, reason: `engine_${result.kind}` });
    }

    log({ requestId, outcome: projected.status, httpStatus: 200, elapsedMs: now() - startedAt, ...base, cached: projected.meta.cached });
    return send(res, 200, projected);
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
