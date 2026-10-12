const RATELIMIT_PREFIX = "itemassist:ratelimit:replacement-finder";
const RATELIMIT_REQUESTS = 5;
const RATELIMIT_WINDOW = "10 m";

let cachedRatelimit = null;

/**
 * Proof-of-concept protection for a paid-provider endpoint: 5 lookups per 10-minute sliding window per client IP.
 * The Upstash packages are required lazily so unit tests can inject a fake limiter without them.
 */
function getRatelimiter() {
  if (cachedRatelimit) return cachedRatelimit;
  const { Ratelimit } = require("@upstash/ratelimit");
  const { getRedisClient } = require("../age-verification/redis-client");
  cachedRatelimit = new Ratelimit({
    redis: getRedisClient(),
    limiter: Ratelimit.slidingWindow(RATELIMIT_REQUESTS, RATELIMIT_WINDOW),
    prefix: RATELIMIT_PREFIX
  });
  return cachedRatelimit;
}

/**
 * Fails CLOSED. A missing, slow or erroring limiter store is reported as `unavailable` with success=false, so paid
 * provider access is never granted while the limiter state is unknown.
 *
 * @param {string} identifier typically the client IP
 * @param {{ratelimit?: {limit: Function}}} [options] inject a fake limiter in tests
 * @returns {Promise<{success: boolean, unavailable: boolean}>}
 */
async function checkRateLimit(identifier, options = {}) {
  try {
    const limiter = options.ratelimit || getRatelimiter();
    const result = await limiter.limit(identifier);
    return { success: Boolean(result) && result.success === true, unavailable: false };
  } catch (error) {
    return { success: false, unavailable: true };
  }
}

module.exports = { checkRateLimit, getRatelimiter, RATELIMIT_PREFIX, RATELIMIT_REQUESTS, RATELIMIT_WINDOW };
