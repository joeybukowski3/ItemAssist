const { Ratelimit } = require("@upstash/ratelimit");
const { getRedisClient } = require("./redis-client");

const RATELIMIT_PREFIX = "itemassist:ratelimit:age-verification-request";

let cachedRatelimit = null;

/**
 * Conservative limit for a professional intake form: 5 submissions per
 * 10-minute sliding window per identifier (typically client IP).
 */
function getRatelimiter() {
  if (cachedRatelimit) {
    return cachedRatelimit;
  }

  cachedRatelimit = new Ratelimit({
    redis: getRedisClient(),
    limiter: Ratelimit.slidingWindow(5, "10 m"),
    prefix: RATELIMIT_PREFIX
  });

  return cachedRatelimit;
}

/**
 * @param {string} identifier typically the client IP address
 * @param {{ratelimit?: {limit: Function}}} [options] inject a fake limiter in tests
 * @returns {Promise<{success:boolean, limit:number, remaining:number, reset:number}>}
 */
async function checkRateLimit(identifier, options = {}) {
  const ratelimit = options.ratelimit || getRatelimiter();
  return ratelimit.limit(identifier);
}

module.exports = { checkRateLimit, getRatelimiter, RATELIMIT_PREFIX };
