const { Ratelimit } = require("@upstash/ratelimit");
const { getRedisClient } = require("../age-verification/redis-client");

const RATELIMIT_PREFIX = "itemassist:ratelimit:consultation-request";

let cachedRatelimit = null;

/**
 * Three inquiries per 10-minute sliding window per client IP. A real lead
 * sends one, so this leaves room for a correction or a retry after an error
 * while keeping a script from flooding the notification inbox.
 */
function getRatelimiter() {
  if (cachedRatelimit) {
    return cachedRatelimit;
  }

  cachedRatelimit = new Ratelimit({
    redis: getRedisClient(),
    limiter: Ratelimit.slidingWindow(3, "10 m"),
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
