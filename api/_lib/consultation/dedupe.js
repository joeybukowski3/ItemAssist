const crypto = require("crypto");
const { getRedisClient } = require("../age-verification/redis-client");

const DEDUPE_PREFIX = "itemassist:consultation:submission:";
const DEDUPE_TTL_SECONDS = 60 * 60;

/** The key holds only a hash of the browser-generated submission id: no name, email or text. */
function dedupeKey(submissionId) {
  return DEDUPE_PREFIX + crypto.createHash("sha256").update(submissionId).digest("hex").slice(0, 32);
}

/**
 * Claims a submission id so the same form submission cannot raise a second
 * notification (double-click, a retried request, a second tab). Resolves true
 * when this call owns the id and false when it was already claimed.
 *
 * @param {string} submissionId
 * @param {{redis?: {set: Function}}} [options] inject a fake client in tests
 */
async function claimSubmission(submissionId, options = {}) {
  const redis = options.redis || getRedisClient();
  const result = await redis.set(dedupeKey(submissionId), "1", { nx: true, ex: DEDUPE_TTL_SECONDS });
  return result === "OK";
}

/** Gives the id back after a failed send so the visitor's retry is not mistaken for a duplicate. */
async function releaseSubmission(submissionId, options = {}) {
  const redis = options.redis || getRedisClient();
  await redis.del(dedupeKey(submissionId));
}

module.exports = { DEDUPE_PREFIX, DEDUPE_TTL_SECONDS, dedupeKey, claimSubmission, releaseSubmission };
