const Busboy = require("busboy");
const { Resend } = require("resend");

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const contactFromEmail = process.env.CONTACT_FROM_EMAIL || "";

const REQUIRED_FIELDS = ["adjuster_name", "email_phone", "claim_number", "scope_of_assignment"];
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const MAX_FILE_COUNT = 5;
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".xlsx",
  ".xls",
  ".csv",
  ".doc",
  ".docx",
  ".txt",
  ".jpg",
  ".jpeg",
  ".png",
  ".heic",
  ".zip"
]);
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "application/zip",
  "application/x-zip-compressed",
  "multipart/x-zip"
]);

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

function getExtension(filename) {
  const value = String(filename || "").trim().toLowerCase();
  const index = value.lastIndexOf(".");
  return index >= 0 ? value.slice(index) : "";
}

function sanitizeFilename(filename) {
  const cleaned = String(filename || "attachment")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || "attachment";
}

function isAllowedAttachment(filename, mimeType) {
  const extension = getExtension(filename);
  const normalizedMimeType = String(mimeType || "").toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return false;
  }

  if (!normalizedMimeType || normalizedMimeType === "application/octet-stream") {
    return true;
  }

  return ALLOWED_MIME_TYPES.has(normalizedMimeType);
}

function getContentType(req) {
  return String(req.headers["content-type"] || "").toLowerCase();
}

function buildFieldRows(fields, attachments) {
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

  const rows = Object.entries(labels)
    .map(([key, label]) => {
      const value = normalizeField(fields[key]);
      if (!value) {
        return "";
      }

      return `<tr><td style="padding:8px 12px;font-weight:700;vertical-align:top;border:1px solid #dbe4f0;">${escapeHtml(label)}</td><td style="padding:8px 12px;vertical-align:top;border:1px solid #dbe4f0;">${escapeHtml(value).replace(/\n/g, "<br>")}</td></tr>`;
    })
    .filter(Boolean);

  if (attachments.length > 0) {
    rows.push(
      `<tr><td style="padding:8px 12px;font-weight:700;vertical-align:top;border:1px solid #dbe4f0;">Attachments</td><td style="padding:8px 12px;vertical-align:top;border:1px solid #dbe4f0;">${attachments.map((file) => escapeHtml(file.filename)).join("<br>")}</td></tr>`
    );
  }

  return rows.join("");
}

function buildTextBody(fields, attachments) {
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

  const lines = pairs
    .filter(([, value]) => normalizeField(value))
    .map(([label, value]) => `${label}: ${normalizeField(value)}`);

  if (attachments.length > 0) {
    lines.push(`Attachments: ${attachments.map((file) => file.filename).join(", ")}`);
  }

  return lines.join("\n");
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

function parseJsonBody(body) {
  return {
    fields: {
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
    },
    attachments: []
  };
}

function parseMultipartForm(req) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const attachments = [];
    let totalAttachmentBytes = 0;
    let parseError = null;

    const busboy = Busboy({
      headers: req.headers,
      limits: {
        files: MAX_FILE_COUNT,
        fileSize: MAX_FILE_SIZE_BYTES,
        fields: 25
      }
    });

    busboy.on("field", (name, value) => {
      fields[name] = normalizeField(value);
    });

    busboy.on("file", (name, stream, info) => {
      const filename = sanitizeFilename(info && info.filename ? info.filename : "");
      const mimeType = String(info && info.mimeType ? info.mimeType : "").toLowerCase();
      const extension = getExtension(filename);
      const chunks = [];
      let fileSize = 0;

      if (name !== "attachments") {
        stream.resume();
        return;
      }

      if (!filename || !extension) {
        stream.resume();
        return;
      }

      if (!isAllowedAttachment(filename, mimeType)) {
        parseError = "One or more files use an unsupported format.";
      }

      stream.on("limit", () => {
        parseError = `Each file must be ${Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024))}MB or smaller.`;
      });

      stream.on("data", (chunk) => {
        fileSize += chunk.length;
        totalAttachmentBytes += chunk.length;

        if (!parseError && totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
          parseError = `Total attachment size must be ${Math.round(MAX_TOTAL_ATTACHMENT_BYTES / (1024 * 1024))}MB or smaller.`;
        }

        if (!parseError) {
          chunks.push(chunk);
        }
      });

      stream.on("end", () => {
        if (parseError) {
          return;
        }

        attachments.push({
          filename,
          mimeType: mimeType || "application/octet-stream",
          size: fileSize,
          buffer: Buffer.concat(chunks)
        });
      });
    });

    busboy.on("filesLimit", () => {
      parseError = `Please attach no more than ${MAX_FILE_COUNT} files.`;
    });

    busboy.on("error", (error) => {
      reject(error);
    });

    busboy.on("close", () => {
      if (parseError) {
        reject(new Error(parseError));
        return;
      }

      resolve({
        fields: {
          adjuster_name: normalizeField(fields.adjuster_name),
          email_phone: normalizeField(fields.email_phone),
          claim_number: normalizeField(fields.claim_number),
          company: normalizeField(fields.company),
          line_items: normalizeField(fields.line_items),
          assignment_type: normalizeField(fields.assignment_type),
          rush_request: normalizeField(fields.rush_request),
          custom_assignment_type: normalizeField(fields.custom_assignment_type),
          scope_of_assignment: normalizeField(fields.scope_of_assignment),
          notes: normalizeField(fields.notes),
          subject: normalizeField(fields.subject) || "New Contents List Submission - ItemAssist",
          website: normalizeField(fields.website),
          turnstileToken: normalizeField(fields.turnstileToken)
        },
        attachments
      });
    });

    req.pipe(busboy);
  });
}

async function parseRequest(req) {
  const contentType = getContentType(req);

  if (contentType.includes("multipart/form-data")) {
    return parseMultipartForm(req);
  }

  const body = typeof req.body === "object" && req.body !== null ? req.body : {};
  return parseJsonBody(body);
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

  let parsedRequest;

  try {
    parsedRequest = await parseRequest(req);
  } catch (error) {
    return json(res, 400, { ok: false, error: error.message || "One or more attachments could not be processed." });
  }

  const { fields, attachments } = parsedRequest;
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
        <table style="border-collapse:collapse;width:100%;max-width:720px;">${buildFieldRows(fields, attachments)}</table>
      </div>
    `;

    const internalText = buildTextBody(fields, attachments);

    await resend.emails.send({
      from: contactFromEmail,
      to: [process.env.CONTACT_TO_EMAIL],
      replyTo: submitterEmail || undefined,
      subject: fields.subject,
      html: internalHtml,
      text: internalText,
      attachments: attachments.map((file) => ({
        filename: file.filename,
        content: file.buffer.toString("base64")
      }))
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
