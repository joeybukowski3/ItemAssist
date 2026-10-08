const { Redis } = require("@upstash/redis");

let cachedClient = null;

/**
 * Lazily constructs a singleton Upstash Redis REST client from env vars.
 * Callers that need a fake client for tests should pass one in explicitly
 * rather than calling this function.
 *
 * @returns {import("@upstash/redis").Redis}
 */
function getRedisClient() {
  if (cachedClient) {
    return cachedClient;
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error("Redis is not configured.");
  }

  cachedClient = new Redis({ url, token });
  return cachedClient;
}

module.exports = { getRedisClient };
