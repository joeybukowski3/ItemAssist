const crypto = require("crypto");
const AVShared = require("../../../assets/js/av-shared.js");

/**
 * Generates a request ID like IAV-20260729-9F3C1A2B.
 * The random suffix comes from crypto.randomBytes, so collisions are not
 * relied upon for correctness beyond "extremely unlikely within a day".
 *
 * @param {Date} [now]
 * @returns {string}
 */
function generateRequestId(now) {
  const randomHex = crypto.randomBytes(6).toString("hex");
  return AVShared.generateRequestId(now || new Date(), randomHex);
}

module.exports = { generateRequestId };
