const RF = require("../../../assets/js/rf-shared.js");

const HONEYPOT_FIELD = "website";

function invalid(status, code) {
  return { ok: false, status, code };
}

/**
 * Reads the request body without ever throwing. JSON only, size capped, plain object only. `req.body` is read inside a
 * try/catch because the platform's lazy body getter throws on malformed JSON.
 */
function readBody(req) {
  const contentType = String((req.headers && req.headers["content-type"]) || "").toLowerCase();
  if (!contentType.startsWith("application/json")) return invalid(415, "INVALID_REQUEST");
  const declared = Number(req.headers && req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > RF.MAX_BODY_BYTES) return invalid(413, "INVALID_REQUEST");

  let body;
  try {
    body = req.body;
  } catch (error) {
    return invalid(400, "INVALID_REQUEST");
  }
  if (Buffer.isBuffer(body)) body = body.toString("utf8");
  if (typeof body === "string") {
    if (Buffer.byteLength(body) > RF.MAX_BODY_BYTES) return invalid(413, "INVALID_REQUEST");
    try {
      body = JSON.parse(body);
    } catch (error) {
      return invalid(400, "INVALID_REQUEST");
    }
  }
  const plain = body !== null && typeof body === "object" && !Array.isArray(body) && [Object.prototype, null].includes(Object.getPrototypeOf(body));
  if (!plain) return invalid(400, "INVALID_REQUEST");
  if (Buffer.byteLength(JSON.stringify(body)) > RF.MAX_BODY_BYTES) return invalid(413, "INVALID_REQUEST");
  return { ok: true, value: body };
}

/** A filled honeypot is detected on the raw body, before any field is trusted. */
function isHoneypotFilled(body) {
  return typeof body[HONEYPOT_FIELD] === "string" && body[HONEYPOT_FIELD].trim() !== "";
}

/**
 * Authoritative validation. An unrecognised category is UNSUPPORTED (a calm, expected outcome); everything else that
 * fails is INVALID_REQUEST. Returns only the four fields the engine accepts: the honeypot never leaves this layer.
 */
function validateRequest(body) {
  const checked = RF.validateLookup(body);
  if (checked.ok) {
    const { category, brand, model, notes } = checked.value;
    return { ok: true, value: { category, brand, model, notes } };
  }
  const unsupportedCategory = checked.errors.category && !checked.errors.form && typeof body.category === "string" && body.category.trim() !== "";
  return unsupportedCategory ? invalid(422, "UNSUPPORTED") : invalid(400, "INVALID_REQUEST");
}

module.exports = { readBody, isHoneypotFilled, validateRequest, HONEYPOT_FIELD };
