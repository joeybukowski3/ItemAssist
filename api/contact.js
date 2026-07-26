const Busboy = require("busboy");
const { Resend } = require("resend");

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const contactFromEmail = process.env.CONTACT_FROM_EMAIL || "";

const REQUIRED_FIELDS = ["name", "email", "assignment_notes"];
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

function extractValidEmail(emailString) {
  const value = normalizeField(emailString);
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
    name: "Name",
    company: "Company",
    email: "Email",
    phone: "Phone",
    client_reference: "Client or claim reference",
    item_count: "Number of items",
    output_format: "Desired output format",
    requested_turnaround: "Requested turnaround",
    assignment_notes: "Assignment notes"
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
    ["Name", fields.name],
    ["Company", fields.company],
    ["Email", fields.email],
    ["Phone", fields.phone],
    ["Client or claim reference", fields.client_reference],
    ["Number of items", fields.item_count],
    ["Desired output format", fields.output_format],
    ["Requested turnaround", fields.requested_turnaround],
    ["Assignment notes", fields.assignment_notes]
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
      name: normalizeField(body.name || body.adjuster_name),
      company: normalizeField(body.company),
      email: normalizeField(body.email || body.email_phone),
      phone: normalizeField(body.phone),
      client_reference: normalizeField(body.client_reference || body.claim_number),
      item_count: normalizeField(body.item_count || body.line_items),
      output_format: normalizeField(body.output_format),
      requested_turnaround: normalizeField(body.requested_turnaround || body.rush_request),
      assignment_notes: normalizeField(body.assignment_notes || body.scope_of_assignment || body.notes),
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
          name: normalizeField(fields.name || fields.adjuster_name),
          company: normalizeField(fields.company),
          email: normalizeField(fields.email || fields.email_phone),
          phone: normalizeField(fields.phone),
          client_reference: normalizeField(fields.client_reference || fields.claim_number),
          item_count: normalizeField(fields.item_count || fields.line_items),
          output_format: normalizeField(fields.output_format),
          requested_turnaround: normalizeField(fields.requested_turnaround || fields.rush_request),
          assignment_notes: normalizeField(fields.assignment_notes || fields.scope_of_assignment || fields.notes),
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
  const submitterEmail = extractValidEmail(fields.email);

  if (fields.website) {
    return json(res, 200, { ok: true, message: "Submission received." });
  }

  const missingField = REQUIRED_FIELDS.find((field) => !fields[field]);
  if (missingField) {
    return json(res, 400, { ok: false, error: "Please complete all required fields." });
  }

  if (!submitterEmail) {
    return json(res, 400, { ok: false, error: "Please enter a valid email address." });
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
      const referenceHtml = fields.client_reference
        ? `<p>Client or claim reference: <strong>${escapeHtml(fields.client_reference)}</strong></p>`
        : "";
      const referenceText = fields.client_reference
        ? `\n\nClient or claim reference: ${fields.client_reference}`
        : "";

      try {
        await resend.emails.send({
          from: contactFromEmail,
          to: [submitterEmail],
          subject: "We received your Item Assist request",
          html: `
            <div style="font-family:Arial,sans-serif;color:#10243e;line-height:1.6;">
              <p>We received your Item Assist contents list and will review the scope shortly.</p>
              ${referenceHtml}
              <p>We will confirm the accepted items, expected turnaround, and any additional charge before research begins.</p>
            </div>
          `,
          text: `We received your Item Assist contents list and will review the scope shortly.${referenceText}\n\nWe will confirm the accepted items, expected turnaround, and any additional charge before research begins.`
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
