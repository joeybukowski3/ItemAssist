const RF = require("../../../assets/js/rf-shared.js");
const { readBody, isHoneypotFilled, HONEYPOT_FIELD } = require("../replacement-finder/validation");

// Matches the engine's Fast Answer limit; the engine re-validates, this layer just refuses early.
const MAX_QUERY_CHARS = 160;
const ALLOWED_KEYS = Object.freeze(["query", HONEYPOT_FIELD]);

const invalid = (status = 400) => ({ ok: false, status, code: "INVALID_REQUEST" });

/**
 * Authoritative validation. The browser sends `{ query }` (plus the shared honeypot). Anything else is refused, and the
 * honeypot never leaves this layer: the engine only ever receives the cleaned query.
 */
function validateResearchRequest(body) {
  if (Object.keys(body).some((key) => !ALLOWED_KEYS.includes(key)) || typeof body.query !== "string") return invalid();
  const query = RF.clean(body.query);
  return query && query.length <= MAX_QUERY_CHARS ? { ok: true, value: { query } } : invalid();
}

module.exports = { readBody, isHoneypotFilled, validateResearchRequest, MAX_QUERY_CHARS };
