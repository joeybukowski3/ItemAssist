const { getRedisClient } = require("./redis-client");

const REQUEST_KEY_PREFIX = "itemassist:request:";
const REQUEST_INDEX_KEY = "itemassist:requests:index";

function requestKey(requestId) {
  return REQUEST_KEY_PREFIX + requestId;
}

/**
 * Persists one structured request record and adds it to the
 * timestamp-sorted index. Throws on any failure — callers must treat a
 * thrown error as "the submission was not durably stored" and must not
 * report success or send the customer confirmation email.
 *
 * @param {object} record must include requestId and createdAt (ISO string)
 * @param {{redis?: import("@upstash/redis").Redis}} [options] inject a fake client in tests
 * @returns {Promise<object>} the stored record
 */
async function saveRequestRecord(record, options = {}) {
  const redis = options.redis || getRedisClient();
  const score = new Date(record.createdAt).getTime();

  await redis.set(requestKey(record.requestId), record);
  await redis.zadd(REQUEST_INDEX_KEY, { score, member: record.requestId });

  return record;
}

/**
 * @param {string} requestId
 * @param {{redis?: import("@upstash/redis").Redis}} [options]
 * @returns {Promise<object|null>}
 */
async function getRequestRecord(requestId, options = {}) {
  const redis = options.redis || getRedisClient();
  return redis.get(requestKey(requestId));
}

module.exports = {
  REQUEST_KEY_PREFIX,
  REQUEST_INDEX_KEY,
  requestKey,
  saveRequestRecord,
  getRequestRecord
};
