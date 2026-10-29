const crypto = require("crypto");
const net = require("net");

/**
 * Per-visitor and per-IP limits for ItemAssist Research, in their own namespaces (nothing here shares a key with the v1
 * replacement limiter, the age-verification limiter or the engine's own budget).
 *
 * Two independent layers:
 *   1. Burst: an Upstash sliding window per client IP over EVERY request that would reach the engine (cache hits included).
 *   2. Fresh-answer quota: UTC-day counters per visitor (default 5) and per IP (default 20). A request RESERVES one unit
 *      atomically before the engine call, so concurrent requests can never exceed the limit, and the unit is GIVEN BACK when
 *      the answer turned out to be cached or the engine produced no fresh AI answer. Only a fresh AI answer is charged.
 *
 * Everything fails CLOSED: a missing, slow or erroring store reports `unavailable` and no engine call is made.
 */

const BURST_PREFIX = "itemassist:ratelimit:research";
const BURST_REQUESTS = 10;
const BURST_WINDOW = "10 m";
const QUOTA_PREFIX = "itemassist:research:quota:v1";
const DEFAULT_VISITOR_DAILY_LIMIT = 5;
const DEFAULT_IP_DAILY_LIMIT = 20;
const DEFAULT_HASH_SALT = "itemassist-research-v1";
const STORE_TIMEOUT_MS = 400;
const VISITOR_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const HASH_LENGTH = 24;
const DAY_MS = 24 * 60 * 60 * 1000;

const RESERVE_SCRIPT = `
local current = tonumber(redis.call("GET", KEYS[1]) or "0")
local limit = tonumber(ARGV[1])
if current >= limit then
  return {0, current}
end
current = redis.call("INCR", KEYS[1])
redis.call("EXPIRE", KEYS[1], tonumber(ARGV[2]))
return {1, current}
`;
const RELEASE_SCRIPT = `
local current = tonumber(redis.call("GET", KEYS[1]) or "0")
if current <= 0 then
  return 0
end
return redis.call("DECR", KEYS[1])
`;

const SETTLE = Object.freeze({ FRESH: "FRESH", IP_ONLY: "IP_ONLY", NONE: "NONE" });

let cachedBurstLimiter = null;

/** Lazily built so unit tests can inject fakes without the Upstash packages. */
function getBurstLimiter() {
  if (cachedBurstLimiter) return cachedBurstLimiter;
  const { Ratelimit } = require("@upstash/ratelimit");
  const { getRedisClient } = require("../age-verification/redis-client");
  cachedBurstLimiter = new Ratelimit({ redis: getRedisClient(), limiter: Ratelimit.slidingWindow(BURST_REQUESTS, BURST_WINDOW), prefix: BURST_PREFIX });
  return cachedBurstLimiter;
}

const positiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

function quotaConfig(env = process.env) {
  return {
    visitorDailyLimit: positiveInteger(env.ITEMASSIST_RESEARCH_VISITOR_DAILY_LIMIT, DEFAULT_VISITOR_DAILY_LIMIT),
    ipDailyLimit: positiveInteger(env.ITEMASSIST_RESEARCH_IP_DAILY_LIMIT, DEFAULT_IP_DAILY_LIMIT),
    hashSalt: typeof env.ITEMASSIST_RESEARCH_HASH_SALT === "string" && env.ITEMASSIST_RESEARCH_HASH_SALT ? env.ITEMASSIST_RESEARCH_HASH_SALT : DEFAULT_HASH_SALT
  };
}

const utcDay = (now) => new Date(now).toISOString().slice(0, 10);
const secondsUntilNextUtcDay = (now) => Math.max(1, Math.ceil((Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate()) + DAY_MS - now) / 1000));
const digest = (parts) => crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, HASH_LENGTH);

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("STORE_TIMEOUT")), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The visitor subject: a valid first-party random ID when the browser sent one, otherwise the hashed IP. The ID is only a
 * convenience for shared networks, never the sole control: the per-IP counter and the burst limiter apply regardless.
 */
function resolveSubject({ visitorId, ip, config, day }) {
  const valid = typeof visitorId === "string" && VISITOR_ID_PATTERN.test(visitorId);
  return {
    ipHash: digest([config.hashSalt, "ip", day, ip || "unknown"]),
    subjectHash: valid ? digest([config.hashSalt, "visitor", visitorId]) : digest([config.hashSalt, "ip-subject", day, ip || "unknown"])
  };
}

/** The /64 an IPv6 address belongs to ("2001:0db8:0000:0001::/64"), or the IPv4 address inside an IPv4-mapped one. */
function ipv6Bucket(ip) {
  let text = ip.split("%")[0].toLowerCase();
  const mapped = /^(?:0{1,4}:){5}ffff:(\d{1,3}(?:\.\d{1,3}){3})$|^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (mapped) return mapped[1] || mapped[2];
  const tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (tail) text = `${text.slice(0, tail.index)}${((+tail[1] << 8) | +tail[2]).toString(16)}:${((+tail[3] << 8) | +tail[4]).toString(16)}`;
  const [head, rest] = text.split("::");
  const front = head ? head.split(":") : [];
  const back = rest === undefined ? [] : (rest ? rest.split(":") : []);
  const groups = [...front, ...(rest === undefined ? [] : Array(8 - front.length - back.length).fill("0")), ...back];
  return `${groups.slice(0, 4).map((group) => group.padStart(4, "0")).join(":")}::/64`;
}

/**
 * The rate-limit subject for one client address: the address itself for IPv4, the /64 for IPv6 (one home connection owns a whole
 * /64, so a per-address key would be free to rotate), or null when the value is not an IP at all. Only a real IP ever becomes a
 * bucket, so a garbage header cannot mint a fresh limit for every request.
 */
function normalizeClientIp(value) {
  const candidate = String(value === undefined || value === null ? "" : value).split(",")[0].trim();
  const family = net.isIP(candidate);
  if (family === 4) return candidate;
  return family === 6 ? ipv6Bucket(candidate) : null;
}

/** Fails CLOSED. Same contract as the v1 helper: `unavailable` is never a pass. */
async function checkBurst(ip, { ratelimit } = {}) {
  try {
    const limiter = ratelimit || getBurstLimiter();
    const result = await limiter.limit(ip || "unknown");
    return { success: Boolean(result) && result.success === true, unavailable: false };
  } catch (error) {
    return { success: false, unavailable: true };
  }
}

/**
 * @param {{redis: {eval: Function}|null, env?: object, now?: () => number}} options
 */
function createResearchQuota({ redis, env = process.env, now = Date.now }) {
  const config = quotaConfig(env);

  async function run(script, key, args) {
    if (!redis || typeof redis.eval !== "function") return null;
    try { return await withTimeout(Promise.resolve(redis.eval(script, [key], args)), STORE_TIMEOUT_MS); } catch (error) { return null; }
  }

  async function take(key, limit, ttl) {
    const result = await run(RESERVE_SCRIPT, key, [String(limit), String(ttl)]);
    // Anything but the script's {0|1, count} pair is an unusable store answer and fails closed like an outage.
    if (!Array.isArray(result) || result.length < 2) return { status: "unavailable" };
    const [allowed, used] = result;
    if (allowed === 1 || allowed === "1") return { status: "allowed", used: Number(used) || 0, key };
    return allowed === 0 || allowed === "0" ? { status: "denied", used: Number(used) || 0 } : { status: "unavailable" };
  }

  const give = (key) => run(RELEASE_SCRIPT, key, []);

  /**
   * Atomically reserves one fresh-answer unit for the visitor and the IP.
   * @returns {Promise<{ok: true, reservation: object, limit: number, used: number}|{ok: false, reason: "quota"|"ip"|"unavailable", limit: number}>}
   */
  async function reserve({ visitorId, ip }) {
    const at = now();
    const day = utcDay(at);
    const ttl = secondsUntilNextUtcDay(at) + 60;
    const { ipHash, subjectHash } = resolveSubject({ visitorId, ip, config, day });
    const visitor = await take(`${QUOTA_PREFIX}:visitor:${day}:${subjectHash}`, config.visitorDailyLimit, ttl);
    if (visitor.status === "unavailable") return { ok: false, reason: "unavailable", limit: config.visitorDailyLimit };
    if (visitor.status === "denied") return { ok: false, reason: "quota", limit: config.visitorDailyLimit };
    const perIp = await take(`${QUOTA_PREFIX}:ip:${day}:${ipHash}`, config.ipDailyLimit, ttl);
    if (perIp.status !== "allowed") {
      await give(visitor.key);
      return { ok: false, reason: perIp.status === "denied" ? "ip" : "unavailable", limit: config.visitorDailyLimit };
    }
    return { ok: true, reservation: { visitorKey: visitor.key, ipKey: perIp.key }, limit: config.visitorDailyLimit, used: visitor.used };
  }

  /**
   * Settles a reservation. FRESH keeps both units (a fresh AI answer was produced). IP_ONLY keeps the IP unit and gives the
   * visitor's back: the engine was called (a provider failure or a timeout) but the visitor got no research, so the visitor is
   * not charged while the IP still pays, which bounds engine calls that never produce a fresh answer. NONE gives both back.
   * Returns the visitor's remaining allowance.
   */
  async function settle(granted, mode) {
    const { visitorKey, ipKey } = granted.reservation;
    const returns = mode === SETTLE.FRESH ? [] : mode === SETTLE.IP_ONLY ? [visitorKey] : [visitorKey, ipKey];
    await Promise.all(returns.map(give));
    const charged = mode === SETTLE.FRESH;
    const used = charged ? granted.used : Math.max(0, granted.used - 1);
    return { limit: granted.limit, remaining: Math.max(0, granted.limit - used), charged };
  }

  return { reserve, settle, config };
}

module.exports = {
  createResearchQuota, checkBurst, getBurstLimiter, quotaConfig, resolveSubject, normalizeClientIp, SETTLE,
  BURST_PREFIX, BURST_REQUESTS, BURST_WINDOW, QUOTA_PREFIX, DEFAULT_VISITOR_DAILY_LIMIT, DEFAULT_IP_DAILY_LIMIT, VISITOR_ID_PATTERN
};
