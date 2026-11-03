const crypto = require("crypto");
const { Resend } = require("resend");

const { validateConsultation } = require("./_lib/consultation/validation");
const { buildInternalNotification, profileFor, GENERIC_LEAD_TYPE } = require("./_lib/consultation/email");
const { checkRateLimit } = require("./_lib/consultation/ratelimit");
const { claimSubmission, releaseSubmission } = require("./_lib/consultation/dedupe");
const { verifyTurnstile } = require("./_lib/age-verification/turnstile");

function json(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(JSON.stringify(payload));
}

/**
 * PP-YYYYMMDD-XXXXXXXX: correlates the notification email with the log line without naming the visitor.
 * The prefix is fixed per request type (CI consultation, RR research request, EI exploring options).
 */
function generateLeadId(now, prefix = "CI") {
  const day = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `${prefix}-${day}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket?.remoteAddress || "unknown";
}

/**
 * Builds the homepage inquiry handler (free consultation, research request or
 * exploring options) with every external client
 * injectable, so tests exercise the whole request lifecycle against fakes
 * and never reach Resend, Turnstile or Redis.
 *
 * Marketing inquiries stay apart from the detailed /api/contact assignment
 * submissions, which are unchanged: their own endpoint, subject line, email tag
 * and log event. The request type picks the subject, tag and wording. Nothing is stored beyond
 * the notification email; the only Redis keys are the rate-limit counter and
 * a hashed double-submit guard.
 *
 * @param {object} [overrides]
 * @param {{emails:{send:Function}}} [overrides.resend]
 * @param {{limit: Function}} [overrides.ratelimit]
 * @param {Function} [overrides.verifyTurnstile]
 * @param {{set: Function, del: Function}} [overrides.redis]
 * @param {Function} [overrides.now]
 * @param {(event: object) => void} [overrides.logEvent]
 * @param {(...args:any[])=>void} [overrides.logError]
 */
function createHandler(overrides = {}) {
  const now = overrides.now || (() => new Date());
  const doVerifyTurnstile = overrides.verifyTurnstile || verifyTurnstile;
  const logError = overrides.logError || ((...args) => console.error(...args));
  const logEvent = overrides.logEvent || ((event) => console.info(JSON.stringify({ event: "itemassist_lead", leadType: GENERIC_LEAD_TYPE, ...event })));

  return async function handler(req, res) {
    if (req.method === "GET") {
      const siteKey = process.env.TURNSTILE_SITE_KEY;

      if (!siteKey) {
        return json(res, 500, { error: "Turnstile is not configured." });
      }

      return json(res, 200, { turnstileSiteKey: siteKey });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, error: "Method not allowed." });
    }

    const resend = overrides.resend || (process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null);
    const fromEmail = process.env.CONTACT_FROM_EMAIL || "";
    const toEmail = process.env.CONTACT_TO_EMAIL || "";
    const turnstileSecretKey = process.env.TURNSTILE_SECRET_KEY || "";

    if (!resend || !toEmail || !fromEmail || !turnstileSecretKey || /(@|\.)gmail\.com$/i.test(fromEmail)) {
      logEvent({ outcome: "not_configured" });
      return json(res, 500, { ok: false, error: "This form is not available right now. Please email submissions@itemassist.com instead." });
    }

    if (!String(req.headers["content-type"] || "").toLowerCase().includes("application/json")) {
      return json(res, 415, { ok: false, error: "Unsupported request." });
    }

    const { fields, errors } = validateConsultation(req.body);

    if (fields.website) {
      logEvent({ outcome: "honeypot" });
      return json(res, 200, { ok: true, message: "Request received." });
    }

    const remoteIp = clientIp(req);
    const rateLimit = await checkRateLimit(remoteIp, { ratelimit: overrides.ratelimit }).catch((error) => {
      logError("consultation-request rate limit check failed", error.message);
      return { success: true };
    });

    if (!rateLimit.success) {
      logEvent({ outcome: "rate_limited" });
      return json(res, 429, { ok: false, error: "Too many requests. Please try again in a few minutes." });
    }

    const errorFields = Object.keys(errors);
    if (errorFields.length > 0) {
      logEvent({ outcome: "invalid", invalidFields: errorFields });
      return json(res, 400, { ok: false, error: errors[errorFields[0]], errors });
    }

    if (!fields.turnstileToken) {
      return json(res, 400, { ok: false, error: "Please complete the spam protection check." });
    }

    let turnstileResult;
    try {
      turnstileResult = await doVerifyTurnstile(fields.turnstileToken, remoteIp, { secretKey: turnstileSecretKey });
    } catch (error) {
      logError("consultation-request turnstile verification error", error.message);
      return json(res, 500, { ok: false, error: "We couldn't verify spam protection. Please try again." });
    }

    if (!turnstileResult || !turnstileResult.success) {
      logEvent({ outcome: "turnstile_failed" });
      return json(res, 400, { ok: false, error: "Spam protection verification failed. Please try again." });
    }

    let claimed = false;
    if (fields.submissionId) {
      try {
        const owned = await claimSubmission(fields.submissionId, { redis: overrides.redis });
        if (!owned) {
          logEvent({ outcome: "duplicate" });
          return json(res, 200, { ok: true, message: "Request received.", duplicate: true });
        }
        claimed = true;
      } catch (error) {
        // The guard is a convenience: an unavailable store must not turn a real lead away.
        logError("consultation-request duplicate guard unavailable", error.message);
      }
    }

    const receivedAt = now().toISOString();
    const profile = profileFor(fields.reason);
    const leadId = generateLeadId(now(), profile.idPrefix);
    const notification = buildInternalNotification(fields, { leadId, receivedAt });

    try {
      const result = await resend.emails.send({
        from: fromEmail,
        to: [toEmail],
        replyTo: fields.email,
        subject: notification.subject,
        html: notification.html,
        text: notification.text,
        tags: notification.tags
      });

      if (result && result.error) {
        throw new Error(result.error.message || "email provider rejected the message");
      }
    } catch (error) {
      logError("consultation-request notification failed", leadId, error.message);
      logEvent({ outcome: "send_failed", leadId, leadType: profile.leadType, reason: fields.reason });
      if (claimed) {
        await releaseSubmission(fields.submissionId, { redis: overrides.redis }).catch(() => {});
      }
      return json(res, 502, { ok: false, error: "We couldn't send your request. Please try again, or email submissions@itemassist.com." });
    }

    logEvent({
      outcome: "submitted",
      leadId,
      leadType: profile.leadType,
      reason: fields.reason,
      hasCompany: Boolean(fields.company),
      hasPhone: Boolean(fields.phone),
      source: fields.source.source || null,
      medium: fields.source.medium || null,
      campaign: fields.source.campaign || null
    });

    return json(res, 200, { ok: true, message: "Request received.", leadId });
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.generateLeadId = generateLeadId;
