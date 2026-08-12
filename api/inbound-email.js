const { Resend } = require("resend");

const SUPPORT_ADDRESS = "support@itemassist.com";
const FORWARD_TO_ADDRESS = "joeybuk03@gmail.com";
const MAX_WEBHOOK_BYTES = 1024 * 1024;

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.end(JSON.stringify(payload));
}

function header(req, name) {
  const value = req.headers && req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function normalizeAddress(value) {
  if (typeof value !== "string") return "";

  const bracketed = value.match(/<([^<>]+)>/);
  return (bracketed ? bracketed[1] : value).trim().toLowerCase();
}

function includesAddress(values, expected) {
  return Array.isArray(values) && values.some((value) => normalizeAddress(value) === expected);
}

async function readRawBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;

    if (size > MAX_WEBHOOK_BYTES) {
      const error = new Error("Webhook payload is too large.");
      error.code = "PAYLOAD_TOO_LARGE";
      throw error;
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function createHandler(overrides = {}) {
  const logError = overrides.logError || ((...args) => console.error(...args));

  return async function handler(req, res) {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return json(res, 405, { ok: false, error: "Method not allowed." });
    }

    const apiKey = overrides.apiKey || process.env.RESEND_INBOUND_API_KEY;
    const webhookSecret = overrides.webhookSecret || process.env.RESEND_WEBHOOK_SECRET;
    const resend = overrides.resend || (apiKey ? new Resend(apiKey) : null);

    if (!resend || !webhookSecret) {
      return json(res, 500, { ok: false, error: "Inbound email is not configured." });
    }

    let payload;
    try {
      payload = await readRawBody(req);
    } catch (error) {
      if (error && error.code === "PAYLOAD_TOO_LARGE") {
        return json(res, 413, { ok: false, error: error.message });
      }
      logError("Unable to read Resend webhook body", error);
      return json(res, 500, { ok: false, error: "Unable to read webhook." });
    }

    const svixId = header(req, "svix-id");
    const svixTimestamp = header(req, "svix-timestamp");
    const svixSignature = header(req, "svix-signature");

    if (!svixId || !svixTimestamp || !svixSignature) {
      return json(res, 400, { ok: false, error: "Missing webhook signature headers." });
    }

    let event;
    try {
      event = resend.webhooks.verify({
        payload,
        headers: {
          id: svixId,
          timestamp: svixTimestamp,
          signature: svixSignature
        },
        webhookSecret
      });
    } catch (_error) {
      return json(res, 400, { ok: false, error: "Invalid webhook signature." });
    }

    if (event.type !== "email.received") {
      return json(res, 200, { ok: true, ignored: true });
    }

    const email = event.data || {};
    if (!includesAddress(email.to, SUPPORT_ADDRESS)) {
      return json(res, 200, { ok: true, ignored: true });
    }

    const sender = normalizeAddress(email.from);
    if (sender === SUPPORT_ADDRESS || sender === FORWARD_TO_ADDRESS) {
      return json(res, 200, { ok: true, ignored: true, reason: "forwarding-loop" });
    }

    if (!email.email_id) {
      return json(res, 400, { ok: false, error: "Received email event is missing an email ID." });
    }

    try {
      const { data, error } = await resend.emails.receiving.forward(
        {
          emailId: email.email_id,
          from: SUPPORT_ADDRESS,
          to: FORWARD_TO_ADDRESS,
          passthrough: true
        },
        { idempotencyKey: `itemassist-inbound-${svixId}` }
      );

      if (error) {
        logError("Resend inbound forwarding failed", error);
        return json(res, 502, { ok: false, error: "Unable to forward inbound email." });
      }

      return json(res, 200, { ok: true, forwarded: true, id: data && data.id });
    } catch (error) {
      logError("Resend inbound forwarding failed", error);
      return json(res, 502, { ok: false, error: "Unable to forward inbound email." });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.config = { api: { bodyParser: false } };

