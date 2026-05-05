const { Resend } = require("resend");

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const contactFromEmail = process.env.CONTACT_FROM_EMAIL || "";

const REQUIRED_FIELDS = ["adjuster_name", "email_phone", "claim_number", "scope_of_assignment"];
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

function json(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.send(JSON.stringify(payload));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeField(value) {
  return String(value || "").trim();
}

function extractEmailFromEmailPhone(emailPhoneString) {
  const value = normalizeField(emailPhoneString);
  const match = value.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);

  if (!match) {
    return null;
  }

  const email = match[0].trim();
  return EMAIL_PATTERN.test(email) ? email : null;
}

function buildFieldRows(fields) {
  const labels = {
    adjuster_name: "Adjuster name",
    email_phone: "Email / phone",
    claim_number: "Claim number",
    company: "Company",
    line_items: "Estimated line items",
    assignment_type: "Assignment type",
    rush_request: "Rush request",
    custom_assignment_type: "Custom assignment type",
    scope_of_assignment: "Scope of assignment",
    notes: "Notes"
  };

  return Object.entries(labels)
    .map(([key, label]) => {
      const value = normalizeField(fields[key]);
      if (!value) {
        return "";
      }

      return `<tr><td style="padding:8px 12px;font-weight:700;vertical-align:top;border:1px solid #dbe4f0;">${escapeHtml(label)}</td><td style="padding:8px 12px;vertical-align:top;border:1px solid #dbe4f0;">${escapeHtml(value).replace(/\n/g, "<br>")}</td></tr>`;
    })
    .filter(Boolean)
    .join("");
}

function buildTextBody(fields) {
  const pairs = [
    ["Adjuster name", fields.adjuster_name],
    ["Email / phone", fields.email_phone],
    ["Claim number", fields.claim_number],
    ["Company", fields.company],
    ["Estimated line items", fields.line_items],
    ["Assignment type", fields.assignment_type],
    ["Rush request", fields.rush_request],
    ["Custom assignment type", fields.custom_assignment_type],
    ["Scope of assignment", fields.scope_of_assignment],
    ["Notes", fields.notes]
  ];

  return pairs
    .filter(([, value]) => normalizeField(value))
    .map(([label, value]) => `${label}: ${normalizeField(value)}`)
    .join("\n");
}

async function verifyTurnstile(token, remoteIp) {
  const params = new URLSearchParams({
    secret: process.env.TURNSTILE_SECRET_KEY || "",
    response: token || ""
  });

  if (remoteIp) {
    params.set("remoteip", remoteIp);
  }

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params
  });

  return response.json();
}

module.exports = async (req, res) => {
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

  if (!resend || !process.env.CONTACT_TO_EMAIL || !contactFromEmail || !process.env.TURNSTILE_SECRET_KEY) {
    return json(res, 500, { ok: false, error: "Contact form is not configured yet." });
  }

  if (/(@|\.)gmail\.com$/i.test(contactFromEmail)) {
    return json(res, 500, { ok: false, error: "Contact form sender is misconfigured." });
  }

  const body = typeof req.body === "object" && req.body !== null ? req.body : {};
  const fields = {
    adjuster_name: normalizeField(body.adjuster_name),
    email_phone: normalizeField(body.email_phone),
    claim_number: normalizeField(body.claim_number),
    company: normalizeField(body.company),
    line_items: normalizeField(body.line_items),
    assignment_type: normalizeField(body.assignment_type),
    rush_request: normalizeField(body.rush_request),
    custom_assignment_type: normalizeField(body.custom_assignment_type),
    scope_of_assignment: normalizeField(body.scope_of_assignment),
    notes: normalizeField(body.notes),
    subject: normalizeField(body.subject) || "New Contents List Submission - ItemAssist",
    website: normalizeField(body.website),
    turnstileToken: normalizeField(body.turnstileToken)
  };
  const submitterEmail = extractEmailFromEmailPhone(fields.email_phone);

  if (fields.website) {
    return json(res, 200, { ok: true, message: "Submission received." });
  }

  const missingField = REQUIRED_FIELDS.find((field) => !fields[field]);
  if (missingField) {
    return json(res, 400, { ok: false, error: "Please complete all required fields." });
  }

  if (!fields.turnstileToken) {
    return json(res, 400, { ok: false, error: "Please complete the spam protection check." });
  }

  try {
    const turnstile = await verifyTurnstile(
      fields.turnstileToken,
      req.headers["x-forwarded-for"] || req.socket?.remoteAddress || ""
    );

    if (!turnstile.success) {
      return json(res, 400, { ok: false, error: "Spam protection verification failed. Please try again." });
    }

    const internalHtml = `
      <div style="font-family:Arial,sans-serif;color:#10243e;">
        <h2 style="margin-bottom:16px;">New Item Assist submission</h2>
        <table style="border-collapse:collapse;width:100%;max-width:720px;">${buildFieldRows(fields)}</table>
      </div>
    `;

    const internalText = buildTextBody(fields);

    await resend.emails.send({
      from: contactFromEmail,
      to: [process.env.CONTACT_TO_EMAIL],
      reply_to: submitterEmail || undefined,
      subject: fields.subject,
      html: internalHtml,
      text: internalText
    });

    if (submitterEmail) {
      try {
      await resend.emails.send({
        from: contactFromEmail,
        to: [submitterEmail],
        subject: "We received your Item Assist request",
        html: `
          <div style="font-family:Arial,sans-serif;color:#10243e;line-height:1.6;">
            <p>We received your Item Assist request and will review it shortly.</p>
            <p>Claim number: <strong>${escapeHtml(fields.claim_number)}</strong></p>
            <p>If we need attachments or clarification, we'll follow up using the contact details you provided.</p>
          </div>
        `,
        text: `We received your Item Assist request and will review it shortly.\n\nClaim number: ${fields.claim_number}\n\nIf we need attachments or clarification, we'll follow up using the contact details you provided.`
      });
      } catch (error) {
        console.error("Auto-reply email failed", error);
      }
    }

    return json(res, 200, { ok: true, message: "Request sent successfully." });
  } catch (error) {
    return json(res, 500, { ok: false, error: "We couldn't send your request. Please try again." });
  }
};
